import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Card, Screen, Text} from '@/components/ui';
import {useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

type MoreRowIcon = keyof typeof Ionicons.glyphMap;

interface MoreEntry {
  label: string;
  description: string;
  icon: MoreRowIcon;
  route: 'Budgets' | 'Categories' | 'Recurring' | 'Settings' | 'Backup';
}

/** The More tab's destinations. */
const MORE_ENTRIES: readonly MoreEntry[] = [
  {
    label: 'Budgets',
    description: 'Monthly limits and progress',
    icon: 'wallet-outline',
    route: 'Budgets',
  },
  {
    label: 'Categories',
    description: 'Manage expense & income categories',
    icon: 'pricetag-outline',
    route: 'Categories',
  },
  {
    label: 'Recurring Transactions',
    description: 'Automatic expenses and income',
    icon: 'repeat-outline',
    route: 'Recurring',
  },
  {
    label: 'Settings',
    description: 'Currency, theme and about',
    icon: 'settings-outline',
    route: 'Settings',
  },
  {
    label: 'Backup & Export',
    description: 'CSV import/export, JSON backup and restore',
    icon: 'save-outline',
    route: 'Backup',
  },
];

function MoreRow({
  label,
  description,
  icon,
  onPress,
}: {
  label: string;
  description: string;
  icon: MoreRowIcon;
  onPress: () => void;
}) {
  const {colors, radius, spacing} = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{color: colors.overlay, foreground: true}}
      style={({pressed}) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.full,
            marginRight: spacing.md,
          },
        ]}
      >
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>

      <View style={styles.copy}>
        <Text variant="body">{label}</Text>
        <Text variant="caption" color="textMuted">
          {description}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.textMuted}
        style={styles.chevron}
      />
    </Pressable>
  );
}

export function MoreScreen() {
  const {spacing} = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Screen scroll>
      <Text variant="display">More</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Budgets, categories, recurring rules, backups and settings.
      </Text>

      <View style={{gap: spacing.sm, marginTop: spacing.md}}>
        {MORE_ENTRIES.map(entry => (
          <MoreRow
            key={entry.label}
            label={entry.label}
            description={entry.description}
            icon={entry.icon}
            onPress={() => navigation.navigate(entry.route, undefined)}
          />
        ))}
      </View>

      <Card style={{marginTop: spacing.lg}}>
        <Text variant="caption" color="textMuted">
          Kharcha is offline-first: your data stays on this device, with no
          account required.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  chevron: {marginLeft: 4},
});
