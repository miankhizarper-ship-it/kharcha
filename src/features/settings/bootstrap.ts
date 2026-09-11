import {openDatabase} from '@/database/connection';
import {useSettingsStore} from '@/store/settingsStore';
import {createSettingsFeature} from './service';

/**
 * Launch-time bootstrap: reads persisted settings from SQLite and mirrors
 * them into the runtime store ONCE, right after the database opens (called
 * from `App.tsx`). Runs before the navigator renders so the correct theme
 * and currency are active from the first frame.
 *
 * Failures are non-fatal by design — the app simply runs on its defaults
 * rather than blocking the whole ledger behind a settings read.
 */
export async function hydrateSettingsFromDatabase(): Promise<void> {
  try {
    const db = await openDatabase();
    const feature = createSettingsFeature(db);
    const settings = await feature.load();
    useSettingsStore.getState().hydrate(settings);
  } catch (error) {
    // Non-fatal: keep built-in defaults (PKR, system theme).
    console.log('[settings] falling back to defaults', error);
  }
}
