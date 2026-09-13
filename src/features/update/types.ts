/**
 * Types for the in-app update system.
 *
 * `RemoteRelease` describes a server payload that has ALREADY passed
 * validation (see validation.ts) — every consumer can rely on its invariants:
 * non-empty version string, positive integer versionCode, HTTPS apkUrl.
 */

export interface RemoteRelease {
  /** Display version, e.g. "1.1.0". Never used for comparisons. */
  version: string;
  /** Android versionCode — the ONLY authoritative comparison value. */
  versionCode: number;
  /** Direct HTTPS download URL for the update APK. */
  apkUrl: string;
  /** Sanitized "What's new" bullets (may be empty). */
  releaseNotes: string[];
  /** True = the dialog cannot be dismissed until the update is installed. */
  mandatory: boolean;
}

/**
 * Dialog state machine driven by useAppUpdate:
 *
 *   idle → available → downloading → launching → idle
 *                          ↓            (installer took over)
 *                        failed ──(Retry)──→ downloading
 *                          └─(Cancel)──→ idle
 *
 * `idle` renders nothing; every other stage renders the update dialog.
 */
export type UpdatePhase =
  | {stage: 'idle'}
  | {stage: 'available'; release: RemoteRelease}
  | {stage: 'downloading'; release: RemoteRelease; progress: number}
  | {stage: 'launching'; release: RemoteRelease}
  | {stage: 'failed'; release: RemoteRelease};
