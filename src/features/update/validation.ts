import type {RemoteRelease} from './types';

const MAX_VERSION_LENGTH = 32;
const MAX_APK_URL_LENGTH = 2048;
const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 200;
/** Android versionCode is a signed 32-bit int; Play caps it at 2100000000. */
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

/**
 * Validates an untrusted GET /api/app-version payload.
 *
 * Returns null for ANY violation — callers must treat null as "no update
 * information" and silently continue. Nothing here ever throws.
 *
 * Strictness is split by field role:
 * - behavioral fields (version, versionCode, apkUrl, mandatory) are STRICT —
 *   a violation rejects the whole payload, because the update flow depends
 *   on them being exactly what the types promise;
 * - releaseNotes is COSMETIC and sanitized leniently (non-strings dropped,
 *   trimmed, capped) so one malformed bullet can never block an update.
 *
 * Unknown extra fields are ignored — the backend can grow its response
 * without breaking older clients.
 */
export function validateRemoteRelease(payload: unknown): RemoteRelease | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const raw = payload as Record<string, unknown>;

  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!version || version.length > MAX_VERSION_LENGTH) {
    return null;
  }

  if (
    typeof raw.versionCode !== 'number' ||
    !Number.isSafeInteger(raw.versionCode) ||
    raw.versionCode <= 0 ||
    raw.versionCode > MAX_ANDROID_VERSION_CODE
  ) {
    return null;
  }

  if (typeof raw.apkUrl !== 'string') {
    return null;
  }
  const apkUrl = raw.apkUrl.trim();
  if (!apkUrl || apkUrl.length > MAX_APK_URL_LENGTH) {
    return null;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apkUrl);
  } catch {
    return null;
  }
  // HTTPS only: this URL is downloaded and handed to the package installer.
  if (parsedUrl.protocol !== 'https:') {
    return null;
  }

  let releaseNotes: string[] = [];
  if (raw.releaseNotes !== undefined && raw.releaseNotes !== null) {
    if (!Array.isArray(raw.releaseNotes)) {
      return null;
    }
    releaseNotes = raw.releaseNotes
      .filter((note): note is string => typeof note === 'string')
      .map((note) => note.trim())
      .filter(Boolean)
      .slice(0, MAX_NOTES)
      .map((note) => note.slice(0, MAX_NOTE_LENGTH));
  }

  return {
    version,
    versionCode: raw.versionCode,
    apkUrl,
    releaseNotes,
    mandatory: raw.mandatory === true,
  };
}
