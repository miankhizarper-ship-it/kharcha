import {useCallback, useEffect, useRef, useState} from 'react';
import {Platform} from 'react-native';

import {fetchLatestRelease, hasInternetConnection} from './api';
import {getInstalledVersionCode, getUpdateApiBaseUrl} from './config';
import {installApk, startApkDownload} from './installer';
import type {RemoteRelease, UpdatePhase} from './types';

/**
 * useAppUpdate — orchestrates the whole in-app update flow.
 *
 * Guarantees (spec):
 * - The check runs ONCE per app launch/session: a module-level flag survives
 *   component remounts, a ref guards against double-fires in the same tree.
 * - The check is silently skipped when: not Android, no internet connection,
 *   the backend is unreachable/slow, the response is invalid, no newer
 *   versionCode exists, or the installed versionCode is unknown. NONE of
 *   these surfaces an error — the app simply opens normally.
 * - Only a strictly newer server versionCode (compared as integers) opens
 *   the dialog. Semantic version strings are display-only.
 * - Download/install failures land in a 'failed' stage with Retry/Cancel;
 *   nothing in this module can throw into the React tree.
 */

/** Module scope: true once a check has STARTED this app session. */
let updateCheckStartedThisSession = false;

/**
 * Small delay so the check never competes with app startup (database open,
 * first render, navigation mount). The user notices nothing either way.
 */
const CHECK_DELAY_MS = 2_500;

/**
 * Progress state is only committed when the integer percent changes — the
 * native progress callback can fire many times per second.
 */
const PROGRESS_PERCENT_STEP = 1;

/**
 * Runs the actual check; resolves null unless a NEWER release is available.
 * All branches are silent by design — this is a launch-time side quest, not
 * a feature the user is waiting for.
 */
async function checkForUpdate(): Promise<RemoteRelease | null> {
  try {
    if (Platform.OS !== 'android') {
      return null;
    }
    // Offline launch: skip entirely, no dialog, no error, no retry loop.
    if (!(await hasInternetConnection())) {
      return null;
    }
    const release = await fetchLatestRelease(getUpdateApiBaseUrl());
    if (!release) {
      // API unavailable / timeout / 4xx / 5xx / invalid payload.
      return null;
    }
    const installedVersionCode = getInstalledVersionCode();
    if (installedVersionCode === null) {
      // Cannot determine the installed version — fail safe, prompt nobody.
      return null;
    }
    // versionCode is the authoritative comparison; equal or lower → nothing.
    if (release.versionCode <= installedVersionCode) {
      return null;
    }
    return release;
  } catch {
    // Absolute last resort — the check may never break the app.
    return null;
  }
}

export interface UseAppUpdateResult {
  phase: UpdatePhase;
  /** "Update" — downloads the APK, then opens the Android installer. */
  update: (release: RemoteRelease) => void;
  /** "Retry" after a failed download/install attempt. */
  retry: (release: RemoteRelease) => void;
  /** "Later" / "Cancel" / backdrop tap — closes the dialog for this launch. */
  dismiss: () => void;
}

export function useAppUpdate(): UseAppUpdateResult {
  const [phase, setPhase] = useState<UpdatePhase>({stage: 'idle'});
  const busyRef = useRef(false);
  const lastPercentRef = useRef(0);

  useEffect(() => {
    if (updateCheckStartedThisSession) {
      return;
    }
    const timer = setTimeout(() => {
      // Flag is set INSIDE the callback: React 18/19 StrictMode's dev-only
      // mount → unmount → mount cycle cancels the first timer, and the
      // second mount still gets exactly one check per session.
      updateCheckStartedThisSession = true;
      checkForUpdate()
        .then((release) => {
          if (release) {
            setPhase({stage: 'available', release});
          }
        })
        .catch(() => {
          // checkForUpdate cannot reject — belt and braces.
        });
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const startDownload = useCallback(
    async (release: RemoteRelease) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      lastPercentRef.current = 0;
      setPhase({stage: 'downloading', release, progress: 0});
      try {
        const fileUri = await startApkDownload(release, (fraction) => {
          const percent = Math.floor(fraction * 100);
          if (percent >= lastPercentRef.current + PROGRESS_PERCENT_STEP) {
            lastPercentRef.current = percent;
            setPhase({stage: 'downloading', release, progress: percent / 100});
          }
        }).promise;
        setPhase({stage: 'launching', release});
        await installApk(fileUri);
        // Installer is (or was) on screen — the dialog's job is done. If the
        // user backed out without installing, a later launch re-prompts.
        setPhase({stage: 'idle'});
      } catch {
        setPhase({stage: 'failed', release});
      } finally {
        busyRef.current = false;
      }
    },
    [],
  );

  const update = useCallback(
    (release: RemoteRelease) => {
      void startDownload(release);
    },
    [startDownload],
  );

  const retry = useCallback(
    (release: RemoteRelease) => {
      void startDownload(release);
    },
    [startDownload],
  );

  const dismiss = useCallback(() => {
    setPhase({stage: 'idle'});
  }, []);

  return {phase, update, retry, dismiss};
}
