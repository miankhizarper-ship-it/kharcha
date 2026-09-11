import {File, Paths} from 'expo-file-system';
import * as Printing from 'expo-print';
import * as Sharing from 'expo-sharing';

import {ReportPdfExportError} from './errors';
import {buildReportHtml, buildReportPdfFilename} from './reportPdf';
import type {ReportSelection, ReportSnapshot} from './types';

/**
 * I/O adapter that turns a loaded report snapshot into a named PDF in the
 * app cache and opens the Android share sheet, where the user can download
 * it to storage, Drive, or any installed app.
 *
 * Rendering, staging and sharing are deliberately isolated from the pure
 * `reportPdf.ts` builder (same split as the backup feature's
 * `fileSystem.ts`), keeping the document itself unit-testable. Everything
 * stays on-device: `expo-print` renders locally, no network is involved
 * (offline-first, spec §9).
 */

export interface ExportReportPdfInput {
  snapshot: ReportSnapshot;
  selection: ReportSelection;
  currency: string;
  periodLabel: string;
  previousLabel?: string;
  /** Anchor for the "Generated on" stamp — pass the screen's mount-time now. */
  generatedAt: number;
}

function splitExtension(filename: string): {base: string; ext: string} {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) {
    return {base: filename, ext: ''};
  }
  return {base: filename.slice(0, dot), ext: filename.slice(dot)};
}

/** Appends " (2)", " (3)"… so repeated exports never overwrite each other. */
function resolveUniqueCacheFile(filename: string): File {
  const {base, ext} = splitExtension(filename);
  let candidate = new File(Paths.cache, filename);
  let counter = 2;
  while (candidate.exists) {
    candidate = new File(Paths.cache, `${base} (${counter})${ext}`);
    counter += 1;
  }
  return candidate;
}

/**
 * Renders the PDF, stages it under its human-readable name and opens the
 * share sheet. Resolves with the staged filename once the sheet is opened
 * (dismissal by the user is not an error — the file stays in cache).
 */
export async function exportReportPdf(
  input: ExportReportPdfInput,
): Promise<string> {
  const {
    snapshot,
    selection,
    currency,
    periodLabel,
    previousLabel,
    generatedAt,
  } = input;

  let printedUri: string;
  try {
    const printed = await Printing.printToFileAsync({
      html: buildReportHtml({
        snapshot,
        currency,
        periodLabel,
        previousLabel,
        generatedAt,
      }),
    });
    printedUri = printed.uri;
  } catch (error) {
    throw new ReportPdfExportError('The PDF could not be rendered.', {
      cause: error,
    });
  }

  // Give the file its human-readable name for the share sheet, using the
  // same unique-name staging strategy as the CSV backup export.
  let target: File;
  try {
    const filename = buildReportPdfFilename(selection, snapshot.period);
    target = resolveUniqueCacheFile(filename);
    const printed = new File(printedUri);
    target.write(await printed.bytes());
  } catch (error) {
    throw new ReportPdfExportError(
      'The PDF was rendered, but could not be staged on this device.',
      {cause: error},
    );
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('sharing unavailable');
    }
    await Sharing.shareAsync(target.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Export report as PDF',
      UTI: 'com.adobe.pdf',
    });
  } catch (error) {
    throw new ReportPdfExportError(
      'The PDF was created, but the share sheet could not open. You can find it in the app cache.',
      {cause: error},
    );
  }

  return target.name;
}
