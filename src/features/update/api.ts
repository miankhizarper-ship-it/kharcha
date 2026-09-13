import * as Network from 'expo-network';

import type {RemoteRelease} from './types';
import {validateRemoteRelease} from './validation';
import {APP_VERSION_API_PATH} from './config';

/**
 * Network + API transport for the update check. Every failure mode
 * (offline, timeout, HTTP error, invalid JSON, invalid payload) resolves to
 * null/false — the caller silently continues, nothing ever rejects.
 */

/** Cap on the whole check so a hanging request can never stall the session. */
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/**
 * True when the device can attempt the version check.
 *
 * Conservative: a definitive "no radio connection" short-circuits the check
 * (offline launches stay fully offline), while an unknown reachability state
 * returns true and lets the fetch + its timeout be the judge.
 */
export async function hasInternetConnection(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (!state.isConnected) {
      return false;
    }
    // isInternetReachable can be null while still being determined —
    // null/true → attempt the fetch; only explicit false means "captive
    // portal / no real internet" and skips it.
    return state.isInternetReachable !== false;
  } catch {
    // Network state itself failed (rare) — attempt the fetch anyway.
    return true;
  }
}

/**
 * Fetches and validates the latest release. Resolves null on EVERY failure:
 * no internet, timeout, 4xx/5xx, invalid JSON, invalid payload, or a
 * deliberately empty base URL.
 */
export async function fetchLatestRelease(
  baseUrl: string,
  timeoutMs: number = UPDATE_CHECK_TIMEOUT_MS,
): Promise<RemoteRelease | null> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${APP_VERSION_API_PATH}`, {
      headers: {Accept: 'application/json'},
      signal: controller.signal,
    });
    // 404 (no release configured), 5xx (backend trouble) — anything non-2xx
    // is "no update information", never an error surface.
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    return validateRemoteRelease(payload);
  } catch {
    // AbortError (timeout), network error, JSON parse error → no update.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
