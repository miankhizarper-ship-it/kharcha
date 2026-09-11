import type {ComponentProps} from 'react';
import type {Ionicons} from '@expo/vector-icons';
import type {ThemeColors} from '@/theme';
import type {BudgetState} from '../types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Maps a budget's visual state to THEME tokens — never hardcoded colors.
 * `ok` uses the positive/primary tone, `warning` the semantic warning tone,
 * `exceeded` the semantic danger tone and `zero` the muted text tone.
 */
export function budgetStateColor(
  state: BudgetState,
  colors: ThemeColors,
): string {
  switch (state) {
    case 'exceeded':
      return colors.danger;
    case 'warning':
      return colors.warning;
    case 'zero':
      return colors.textMuted;
    default:
      return colors.primary;
  }
}

/** Icon accent for a budget state banner/label (Ionicons glyph). */
export function budgetStateIcon(state: BudgetState): IoniconName {
  switch (state) {
    case 'exceeded':
      return 'alert-circle';
    case 'warning':
      return 'warning';
    case 'zero':
      return 'information-circle';
    default:
      return 'checkmark-circle';
  }
}
