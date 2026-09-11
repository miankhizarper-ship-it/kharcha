import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
} from '@/store/settingsStore';

/**
 * Currency metadata for the Settings picker. Storage stays currency-agnostic
 * (amounts are minor units in SQLite); the code below only changes how
 * amounts are DISPLAYED (see `formatCurrency`). Historical amounts are never
 * converted.
 */
export interface CurrencyOption {
  code: string;
  name: string;
}

const CURRENCY_NAMES: Record<string, string> = {
  PKR: 'Pakistani Rupee',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  AED: 'UAE Dirham',
  SAR: 'Saudi Riyal',
  INR: 'Indian Rupee',
  BDT: 'Bangladeshi Taka',
  TRY: 'Turkish Lira',
  CNY: 'Chinese Yuan',
  JPY: 'Japanese Yen',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  MYR: 'Malaysian Ringgit',
  SGD: 'Singapore Dollar',
};

export const CURRENCY_OPTIONS: readonly CurrencyOption[] =
  SUPPORTED_CURRENCIES.map(code => ({
    code,
    name: CURRENCY_NAMES[code] ?? code,
  }));

export {DEFAULT_CURRENCY, isSupportedCurrency};
