import Constants from 'expo-constants';
import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {
  Card,
  EmptyState,
  Screen,
  SegmentedControl,
  Text,
} from '@/components/ui';
import {CurrencyPickerSheet} from '@/features/settings/components/CurrencyPickerSheet';
import {CURRENCY_OPTIONS} from '@/features/settings/currencies';
import {useSettingsFeature} from '@/features/settings/useSettingsFeature';
import {useTheme} from '@/theme';
import {THEME_MODES} from '@/theme/resolveMode';

/**
 * Reads the app version from the Expo project configuration (app.json) via
 * expo-constants — no hardcoded copy that can drift out of date.
 */
function useAppVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

function currencyNameOf(code: string): string {
  return (
    CURRENCY_OPTIONS.find(option => option.code === code)?.name ?? 'Custom'
  );
}

/**
 * Settings — currency, theme and about. Every change persists to the
 * `settings` SQLite table immediately (via the settings feature) and
 * updates the runtime store, so the UI reflects the choice at once.
 */
export function SettingsScreen() {
  const {colors, radius, spacing} = useTheme();
  const {
    loadError,
    currency,
    themeMode,
    saving,
    saveError,
    changeCurrency,
    changeThemeMode,
  } = useSettingsFeature();
  const version = useAppVersion();

  const [pickerVisible, setPickerVisible] = useState(false);

  if (loadError) {
    return (
      <Screen scroll>
        <Text variant="display">Settings</Text>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text variant="display">Settings</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Personalize how Kharcha looks and displays amounts.
      </Text>

      {saveError ? (
        <Card
          style={[
            styles.errorCard,
            {
              backgroundColor: colors.dangerMuted,
              borderColor: colors.danger,
              marginTop: spacing.md,
            },
          ]}
        >
          <Text variant="caption" style={{color: colors.danger}}>
            {saveError}
          </Text>
        </Card>
      ) : null}

      <Text variant="title" style={{marginTop: spacing.lg}}>
        Currency
      </Text>
      <Card style={{marginTop: spacing.sm}}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Currency. Current: ${currency}`}
          onPress={() => setPickerVisible(true)}
          android_ripple={{color: colors.overlay, foreground: true}}
          style={({pressed}) => [
            styles.row,
            {borderRadius: radius.md, opacity: pressed ? 0.85 : 1},
          ]}
        >
          <View style={styles.copy}>
            <Text variant="body">Display currency</Text>
            <Text variant="caption" color="textMuted">
              {currency} · {currencyNameOf(currency)}
            </Text>
          </View>
          <Text variant="label" color="primary">
            Change
          </Text>
        </Pressable>
        <Text
          variant="caption"
          color="textMuted"
          style={{marginTop: spacing.sm}}
        >
          Amounts are stored locally and are never converted — only the symbol
          and code change.
        </Text>
      </Card>

      <Text variant="title" style={{marginTop: spacing.lg}}>
        Theme
      </Text>
      <Card style={{marginTop: spacing.sm, gap: spacing.sm}}>
        <SegmentedControl
          segments={THEME_MODES.map(mode =>
            mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System',
          )}
          selectedIndex={THEME_MODES.indexOf(themeMode)}
          onSelect={index => {
            void changeThemeMode(THEME_MODES[index]);
          }}
        />
        <Text variant="caption" color="textMuted">
          System follows the device light or dark setting automatically.
        </Text>
      </Card>

      <Text variant="title" style={{marginTop: spacing.lg}}>
        About
      </Text>
      <Card style={{marginTop: spacing.sm, gap: spacing.xs}}>
        <View style={styles.row}>
          <Text variant="body">App</Text>
          <Text variant="label">Kharcha</Text>
        </View>
        <View style={styles.row}>
          <Text variant="body">Version</Text>
          <Text variant="label">{version}</Text>
        </View>
        <View style={styles.row}>
          <Text variant="body">Data</Text>
          <Text variant="label">On this device only</Text>
        </View>
        <Text
          variant="caption"
          color="textMuted"
          style={{marginTop: spacing.xs}}
        >
          Kharcha is offline-first: no account, no cloud sync, no tracking. Your
          ledger lives entirely in the local database.
        </Text>
      </Card>

      {saving ? (
        <Text variant="caption" color="textMuted" style={styles.savingNote}>
          Saving…
        </Text>
      ) : null}

      <CurrencyPickerSheet
        visible={pickerVisible}
        selectedCode={currency}
        onSelect={code => {
          setPickerVisible(false);
          void changeCurrency(code);
        }}
        onClose={() => setPickerVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  copy: {flexShrink: 1, gap: 1},
  errorCard: {borderWidth: 1},
  savingNote: {textAlign: 'center', marginTop: 12},
});
