import {StatusBar} from 'expo-status-bar';
import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {Text} from '@/components/ui';
import {openDatabase} from '@/database';
import {hydrateSettingsFromDatabase} from '@/features/settings/bootstrap';
import {processDueRecurringTransactions} from '@/features/recurring/processing';
import {RootNavigator} from '@/navigation/RootNavigator';
import {ThemeProvider, useTheme} from '@/theme';

function AppShell() {
  const {isDark} = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <RootNavigator />
    </>
  );
}

/** Shown while the local database is being opened and migrated. */
function DbLoading() {
  const {colors, spacing} = useTheme();

  return (
    <View
      style={[
        styles.center,
        {backgroundColor: colors.background, padding: spacing.lg},
      ]}
    >
      <Text variant="title">Kharcha</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.sm}}>
        Preparing your local database...
      </Text>
    </View>
  );
}

function DbError({message}: {message: string}) {
  const {colors, spacing} = useTheme();

  return (
    <View
      style={[
        styles.center,
        {backgroundColor: colors.background, padding: spacing.lg},
      ]}
    >
      <Text variant="title" color="danger">
        Something went wrong
      </Text>
      <Text
        variant="body"
        color="textMuted"
        align="center"
        style={{marginTop: spacing.sm}}
      >
        {message}
      </Text>
    </View>
  );
}

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // Opens the connection and applies pending migrations.
        const db = await openDatabase();
        // Mirror persisted settings (theme, currency) into the runtime
        // store before the navigator renders. Non-fatal on failure.
        await hydrateSettingsFromDatabase();
        if (!cancelled) {
          setIsReady(true);
        }
        // Process due recurring transactions once per launch (spec §16).
        // Fire-and-forget AFTER the first render is scheduled: the engine
        // is idempotent and atomic, and every screen refetches on focus,
        // so a just-generated transaction appears at the first refocus —
        // without blocking startup behind a potentially large catch-up.
        processDueRecurringTransactions(db).catch(() => {
          // Non-fatal: retried on next launch or when the recurring
          // screen focuses. Never blocks or crashes the app.
        });
      } catch (err) {
        // Full details stay in the log for diagnostics only (spec §12):
        // DatabaseError/MigrationError messages can embed SQL or engine
        // internals that must never reach the UI.
        console.error('[bootstrap] local database failed to initialize', err);
        if (!cancelled) {
          setError(
            'Kharcha could not start because the local database is unavailable. ' +
              'Your data stays on this device — please restart the app and try again.',
          );
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ThemeProvider>
      {error ? <DbError message={error} /> : null}
      {!error && !isReady ? <DbLoading /> : null}
      {!error && isReady ? <AppShell /> : null}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
