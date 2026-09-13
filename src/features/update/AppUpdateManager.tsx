import React from 'react';

import {AppUpdateDialog} from './AppUpdateDialog';
import {useAppUpdate} from './useAppUpdate';

/**
 * Root-level glue: runs the once-per-launch update check and renders the
 * update dialog on top of the whole app when a newer release is available.
 * Mount ONCE inside the theme provider (it reads theme tokens).
 */
export function AppUpdateManager() {
  const {phase, update, retry, dismiss} = useAppUpdate();

  return (
    <AppUpdateDialog
      phase={phase}
      onUpdate={update}
      onRetry={retry}
      onDismiss={dismiss}
    />
  );
}
