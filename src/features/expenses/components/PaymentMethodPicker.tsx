import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {Text} from '@/components/ui';
import type {PaymentMethod} from '@/database/models';
import {PAYMENT_METHOD_OPTIONS} from '../paymentMethods';
import {useTheme} from '@/theme';

export interface PaymentMethodPickerProps {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}

/** Segmented chips for Cash / Card / Bank / Other. */
export function PaymentMethodPicker({
  value,
  onChange,
}: PaymentMethodPickerProps) {
  const {colors, radius} = useTheme();

  return (
    <View style={styles.row}>
      {PAYMENT_METHOD_OPTIONS.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{selected}}
            onPress={() => onChange(option.value)}
            android_ripple={{color: colors.overlay, foreground: true}}
            style={[
              styles.chip,
              {
                borderRadius: radius.md,
                backgroundColor: selected ? colors.primary : colors.surface,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: selected ? colors.onPrimary : colors.text,
                fontSize: 13,
                fontWeight: '500',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
});
