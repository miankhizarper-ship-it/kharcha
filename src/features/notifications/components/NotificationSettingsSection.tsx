import {Ionicons} from '@expo/vector-icons';
import React, {useState} from 'react';
import {Pressable, StyleSheet, Switch, View} from 'react-native';

import {Button, Card, Text} from '@/components/ui';
import {useTheme} from '@/theme';

import {formatTimeLabel} from '../time';
import {useNotificationSettings} from '../useNotificationSettings';
import {TimePickerSheet} from './TimePickerSheet';

/**
 * The Notifications section of the Settings screen (spec §1/§14).
 *
 * Design language is entirely Kharcha's own: theme tokens for every color,
 * spacing and radius, the shared `Card`/`Text`/`Button` components and a
 * plain React Native `Switch`. Nothing here introduces a new look.
 *
 * Permission behavior (spec §6): a status card appears only when the
 * permission is not granted; tapping "Allow notifications" (or enabling any
 * toggle) is the ONLY moment the system dialog is ever requested. Denial
 * keeps everything functional — preferences still save and a note explains
 * where to turn notifications on.
 */

interface ToggleRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (enabled: boolean) => void;
}

function ToggleRow({
  icon,
  title,
  description,
  value,
  disabled,
  onValueChange,
}: ToggleRowProps) {
  const {colors, spacing} = useTheme();

  return (
    <View style={[styles.row, {paddingVertical: spacing.md}]}>
      <View style={[styles.iconCircle, {backgroundColor: colors.surfaceMuted}]}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <Text variant="body">{title}</Text>
        <Text variant="caption" color="textMuted">
          {description}
        </Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{false: colors.border, true: colors.primary}}
        thumbColor="#FFFFFF"
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

export function NotificationSettingsSection() {
  const {colors, radius, spacing} = useTheme();
  const {
    preferences,
    permission,
    saving,
    ensurePermissionThen,
    apply,
  } = useNotificationSettings();
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  /** Explicit re-request via the card button — the single request pathway. */
  const requestPermissionFromCard = () => {
    ensurePermissionThen(feature => feature.loadPreferences());
  };

  if (!preferences) {
    // Database still loading (or unavailable) — render nothing instead of
    // flashing a half-built section; Settings has its own loading states.
    return null;
  }

  const showPermissionCard =
    permission === 'denied' ||
    permission === 'undetermined' ||
    permission === 'unknown';

  return (
    <View>
      <Text variant="title" style={{marginTop: spacing.lg}}>
        Notifications
      </Text>
      <Card style={{marginTop: spacing.sm, gap: 0}}>
        {showPermissionCard ? (
          <View
            style={[
              styles.permissionCard,
              {
                backgroundColor: permission === 'denied'
                  ? colors.dangerMuted
                  : colors.surfaceMuted,
                borderRadius: radius.md,
                marginBottom: spacing.sm,
              },
            ]}
          >
            <Text variant="caption" color="textMuted">
              {permission === 'denied'
                ? 'Notifications are turned off for Kharcha in Android settings. Reminders are saved and will start as soon as you allow them.'
                : 'Kharcha needs your permission to show reminders on this device.'}
            </Text>
            {permission !== 'denied' ? (
              <View style={{marginTop: spacing.sm}}>
                <Button
                  title="Allow notifications"
                  variant="secondary"
                  onPress={requestPermissionFromCard}
                  disabled={saving}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        <ToggleRow
          icon="notifications-outline"
          title="Daily Spending Reminder"
          description="Remind me to record today's expenses"
          value={preferences.dailyReminderEnabled}
          disabled={saving}
          onValueChange={enabled => {
            if (enabled) {
              ensurePermissionThen(feature =>
                feature.setDailyReminder(true),
              );
            } else {
              apply(feature => feature.setDailyReminder(false));
            }
          }}
        />

        {preferences.dailyReminderEnabled ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change daily reminder time"
            onPress={() => setTimePickerVisible(true)}
            android_ripple={{color: colors.overlay, foreground: true}}
            style={({pressed}) => [
              styles.timeRow,
              {
                borderRadius: radius.md,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text variant="caption" color="textMuted">
              Reminder time
            </Text>
            <View style={styles.timeValue}>
              <Text variant="label" color="primary">
                {formatTimeLabel(preferences.dailyReminderTime)}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textMuted}
              />
            </View>
          </Pressable>
        ) : null}

        <View style={[styles.divider, {borderColor: colors.border}]} />

        <ToggleRow
          icon="wallet-outline"
          title="Budget Alerts"
          description="Notify me when I approach my budget"
          value={preferences.budgetAlertsEnabled}
          disabled={saving}
          onValueChange={enabled => {
            if (enabled) {
              ensurePermissionThen(feature => feature.setBudgetAlerts(true));
            } else {
              apply(feature => feature.setBudgetAlerts(false));
            }
          }}
        />

        <View style={[styles.divider, {borderColor: colors.border}]} />

        <ToggleRow
          icon="repeat-outline"
          title="Recurring Expense Reminder"
          description="Remind me about upcoming recurring expenses"
          value={preferences.recurringReminderEnabled}
          disabled={saving}
          onValueChange={enabled => {
            if (enabled) {
              ensurePermissionThen(feature =>
                feature.setRecurringReminder(true),
              );
            } else {
              apply(feature => feature.setRecurringReminder(false));
            }
          }}
        />

        <View style={[styles.divider, {borderColor: colors.border}]} />

        <ToggleRow
          icon="stats-chart-outline"
          title="Monthly Summary"
          description="Notify me when my monthly summary is ready"
          value={preferences.monthlySummaryEnabled}
          disabled={saving}
          onValueChange={enabled => {
            if (enabled) {
              ensurePermissionThen(feature => feature.setMonthlySummary(true));
            } else {
              apply(feature => feature.setMonthlySummary(false));
            }
          }}
        />
      </Card>

      <TimePickerSheet
        visible={timePickerVisible}
        selectedTime={preferences.dailyReminderTime}
        onSelect={time => {
          ensurePermissionThen(feature =>
            feature.setDailyReminder(true, time),
          );
        }}
        onClose={() => setTimePickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  copy: {
    flex: 1,
    marginRight: 8,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginLeft: 46,
  },
  timeValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  permissionCard: {
    padding: 12,
  },
});
