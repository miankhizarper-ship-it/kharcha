import Constants from 'expo-constants';
import * as Application from 'expo-application';
import {Platform} from 'react-native';

/**
 * Update-check configuration.
 *
 * The backend base URL deliberately lives in app.json → `expo.extra`
 * (build-time configuration read through expo-constants), NOT as a hardcoded
 * constant in feature code: swapping the backend URL never requires touching
 * the update logic. The APK download URL itself is NEVER known to the app —
 * it always comes from the GET /api/app-version response.
 */

const BASE_URL_EXTRA_KEY = 'updateApiBaseUrl';

/** Path appended to the configured base URL. */
export const APP_VERSION_API_PATH = '/api/app-version';

/** Fallback display name for the update dialog ("Kharcha 1.1.0 is now…"). */
export function getAppDisplayName(): string {
  return Constants.expoConfig?.name ?? 'Kharcha';
}

/**
 * Backend base URL from app.json extra, or "" when not configured (which
 * disables the check — the feature must never guess a production URL).
 */
export function getUpdateApiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as
    | Record<string, unknown>
    | undefined;
  const value = extra?.[BASE_URL_EXTRA_KEY];
  if (typeof value !== 'string' || !value.trim()) {
    if (__DEV__) {
      console.warn(
        `[update] app.json expo.extra.${BASE_URL_EXTRA_KEY} is not set — ` +
          'the in-app update check is disabled for this build.',
      );
    }
    return '';
  }
  return value.trim();
}

/**
 * The installed app's Android versionCode (expo-application's
 * nativeBuildVersion) — the authoritative value compared against the
 * server's versionCode.
 *
 * Returns null when it cannot be determined (non-Android, Expo Go quirks,
 * unexpected format). Callers fail SAFE on null: no update dialog, rather
 * than prompting on a guessed version.
 */
export function getInstalledVersionCode(): number | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const build = Application.nativeBuildVersion;
  if (!build) {
    return null;
  }
  const parsed = Number.parseInt(build, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
