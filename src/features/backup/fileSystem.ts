import {File, Paths, type PickSingleFileResult} from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {BackupFileError, BackupShareError} from './errors';

/**
 * Thin adapter over the Expo file APIs used by the Backup feature.
 *
 * Isolated in one module so the pure backup logic (CSV, serialization,
 * validation, restore) stays free of platform I/O and testable on
 * `node:sqlite`. Files are staged in the cache directory — a per-export
 * unique name prevents accidentally overwriting anything the user saved
 * earlier (spec §9).
 */

export interface StagedFile {
  /** Path usable by the Android share sheet. */
  uri: string;
  filename: string;
}

function splitExtension(filename: string): {base: string; ext: string} {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) {
    return {base: filename, ext: ''};
  }
  return {base: filename.slice(0, dot), ext: filename.slice(dot)};
}

/**
 * Picks `filename` in the cache directory, appending " (2)", " (3)"… when a
 * file with the same name already exists from an earlier export this session.
 */
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

/** Writes `contents` to a uniquely-named cache file and returns its handle. */
export function stageFile(filename: string, contents: string): StagedFile {
  try {
    const file = resolveUniqueCacheFile(filename);
    file.write(contents);
    return {uri: file.uri, filename};
  } catch (error) {
    throw new BackupFileError(
      'The export file could not be created on this device.',
      {cause: error},
    );
  }
}

/** Opens the Android share sheet for a staged file. */
export async function shareStagedFile(
  file: StagedFile,
  options: {mimeType: string; dialogTitle: string},
): Promise<void> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('sharing unavailable');
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: options.mimeType,
      dialogTitle: options.dialogTitle,
    });
  } catch (error) {
    throw new BackupShareError(
      'The file was created, but the share sheet could not open. You can find it in the app cache.',
      {cause: error},
    );
  }
}

/** Opens the system picker; resolves null when the user cancels. */
export async function pickBackupFile(): Promise<{
  content: string;
  filename: string | null;
} | null> {
  // Cancellation is reported via the result payload (`canceled: true`);
  // a throw means the picker itself failed and must surface as an error.
  // (Typed explicitly: ReturnType<> would resolve to the LEGACY overload.)
  let picked: PickSingleFileResult;
  try {
    picked = await File.pickFileAsync({
      // Some file managers report generic MIME types for .json downloads.
      mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'],
    });
  } catch (error) {
    throw new BackupFileError('The file picker could not be opened.', {
      cause: error,
    });
  }
  if (picked.canceled || picked.result === null) {
    return null;
  }
  try {
    return {content: await picked.result.text(), filename: picked.result.name};
  } catch (error) {
    throw new BackupFileError('The selected file could not be read.', {
      cause: error,
    });
  }
}

/**
 * CSV twin of `pickBackupFile` (Phase 10): same cancellation/error
 * contract, wider MIME set because file managers label CSVs
 * inconsistently (text/csv, plain text, or Excel's application MIME).
 */
export async function pickCsvFile(): Promise<{
  content: string;
  filename: string | null;
} | null> {
  let picked: PickSingleFileResult;
  try {
    picked = await File.pickFileAsync({
      mimeTypes: [
        'text/csv',
        'text/comma-separated-values',
        'text/plain',
        'application/csv',
        'application/vnd.ms-excel',
        'application/octet-stream',
      ],
    });
  } catch (error) {
    throw new BackupFileError('The file picker could not be opened.', {
      cause: error,
    });
  }
  if (picked.canceled || picked.result === null) {
    return null;
  }
  try {
    return {content: await picked.result.text(), filename: picked.result.name};
  } catch (error) {
    throw new BackupFileError('The selected file could not be read.', {
      cause: error,
    });
  }
}
