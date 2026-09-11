import type {PaymentMethod} from '@/database/models';
import type {PaymentMethodOption} from './types';

/**
 * Payment methods offered in the Add/Edit form, mapped to the enum values
 * stored in SQLite (`payment_method` CHECK constraint in migration 001).
 * `mobile_wallet` is a valid storage value but not offered in the UI yet.
 */
export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  {value: 'cash', label: 'Cash'},
  {value: 'card', label: 'Card'},
  {value: 'bank_transfer', label: 'Bank'},
  {value: 'other', label: 'Other'},
];

const ALL_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank',
  mobile_wallet: 'Wallet',
  other: 'Other',
};

/** Human label for any stored payment method (list rows, exports). */
export function paymentMethodLabel(method: PaymentMethod): string {
  return ALL_LABELS[method] ?? 'Other';
}
