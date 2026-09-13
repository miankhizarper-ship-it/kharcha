import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

import type {RemoteRelease} from './types';

/**
 * Native I/O adapter for the update flow (isolated here, like the backup
 * feature's fileSystem.ts, so the hook logic stays thin):
 *
 *   startApkDownload()  → streams the APK into the app cache with progress
 *   installApk()        → hands the file to the Android package installer
 *
 * Android notes baked into this module:
 * - The APK is downloaded into the app's OWN cache directory — no storage
 *   permission is needed and the OS can reclaim it under pressure.
 * - Modern Android forbids passing raw file:// URIs across app boundaries
 *   (FileUriExposedException). getContentUriAsync() converts the file URI to
 *   the app FileProvider's content:// form, which the installer accepts.
 * - FLAG_GRANT_READ_URI_PERMISSION lets the installer read our content URI.
 * - The "install unknown apps" consent (Android 8+) is requested by the
 *   SYSTEM on first install — when the user returns without granting, the
 *   caller can simply retry; the finished APK is reused from cache.
 */

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const VIEW_INTENT_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** HTTP success window for the download result. */
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/**
 * Watchdog: if no bytes arrive for this long the download is considered
 * stuck and is cancelled (→ failed dialog → Retry). Guards against a hung
 * socket keeping the dialog open forever; big APKs on slow links are safe
 * because EVERY progress event re-arms the timer.
 */
const NO_PROGRESS_TIMEOUT_MS = 60_000;

function apkTargetUri(versionCode: number): string {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error('The app cache directory is unavailable.');
  }
  return `${cacheDirectory}kharcha-update-${versionCode}.apk`;
}

export interface ApkDownloadHandle {
  promise: Promise<string>;
  /** Aborts the in-flight download (watchdog or caller). */
  cancel: () => void;
}

/**
 * Starts downloading `release.apkUrl` into the app cache.
 *
 * - Progress is reported as a 0..1 fraction via `onProgress`.
 * - A COMPLETE apk from a previous attempt (same versionCode) is reused —
 *   this is what makes "user came back from the unknown-sources settings
 *   screen" a zero-re-download Retry.
 * - The download always writes to a `.part` file first; only a verified
 *   result is moved to the final name, so a corrupt partial download can
 *   never masquerade as a complete APK.
 */
export function startApkDownload(
  release: RemoteRelease,
  onProgress: (fraction: number) => void,
): ApkDownloadHandle {
  const targetUri = apkTargetUri(release.versionCode);
  const partUri = `${targetUri}.part`;

  const resumable = FileSystem.createDownloadResumable(
    release.apkUrl,
    partUri,
    {},
    (progress) => {
      const expected = progress.totalBytesExpectedToWrite;
      if (expected > 0) {
        onProgress(progress.totalBytesWritten / expected);
      }
    },
  );

  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const armWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog);
    }
    watchdog = setTimeout(() => {
      void resumable.cancelAsync().catch(() => {});
    }, NO_PROGRESS_TIMEOUT_MS);
  };

  const cancel = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    void resumable.cancelAsync().catch(() => {});
  };

  const promise = (async () => {
    // Reuse a fully downloaded APK from an earlier attempt.
    let existing: FileSystem.FileInfo;
    try {
      existing = await FileSystem.getInfoAsync(targetUri);
    } catch {
      existing = {exists: false} as FileSystem.FileInfo;
    }
    if (existing.exists && !existing.isDirectory && existing.size > 0) {
      return targetUri;
    }

    // Drop a stale partial from an interrupted attempt.
    await FileSystem.deleteAsync(partUri, {idempotent: true});

    armWatchdog();
    try {
      const result = await resumable.downloadAsync();
      if (!result || result.status < HTTP_OK_MIN || result.status > HTTP_OK_MAX) {
        throw new Error(
          `APK download failed (status ${result?.status ?? 'cancelled'}).`,
        );
      }
      await FileSystem.moveAsync({from: partUri, to: targetUri});
      return targetUri;
    } finally {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    }
  })();

  return {promise, cancel};
}

/**
 * Launches the Android package installer for the downloaded APK.
 * Resolves once the installer UI is up (or the user backed out of it —
 * deciding NOT to install is the user's choice, not an app error). Throws
 * only when the installer could not be opened at all.
 */
export async function installApk(fileUri: string): Promise<void> {
  let contentUri: string;
  try {
    // file:// → content:// through the app's FileProvider.
    contentUri = await FileSystem.getContentUriAsync(fileUri);
  } catch (error) {
    throw new Error('The downloaded APK could not be shared with the installer.', {
      cause: error,
    });
  }

  try {
    await IntentLauncher.startActivityAsync(VIEW_INTENT_ACTION, {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch (error) {
    // Typically ActivityNotFoundException — no installer on the device.
    throw new Error('The Android package installer could not be opened.', {
      cause: error,
    });
  }
}
