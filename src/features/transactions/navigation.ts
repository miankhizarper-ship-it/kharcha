import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import type {RootStackParamList} from '@/navigation/types';
import type {TransactionItem} from './types';

/**
 * Opens the correct edit screen for a combined-ledger row: expenses go to
 * the expense form, income to the income form. Single shared implementation
 * for the Transactions list and the dashboard's recent list.
 */
export function openTransaction(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  transaction: TransactionItem,
): void {
  if (transaction.type === 'expense') {
    navigation.navigate('AddExpense', {expenseId: transaction.id});
  } else {
    navigation.navigate('AddIncome', {incomeId: transaction.id});
  }
}
