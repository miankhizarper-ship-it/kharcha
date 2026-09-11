import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React, {useMemo} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AddExpenseScreen} from '@/features/add-expense/screens/AddExpenseScreen';
import {AddIncomeScreen} from '@/features/add-income/screens/AddIncomeScreen';
import {BackupScreen} from '@/features/backup/screens/BackupScreen';
import {ExportCsvScreen} from '@/features/backup/screens/ExportCsvScreen';
import {ImportCsvScreen} from '@/features/backup/screens/ImportCsvScreen';
import {BudgetScreen} from '@/features/budgets/screens/BudgetScreen';
import {CategoriesScreen} from '@/features/categories/screens/CategoriesScreen';
import {CategoryDetailScreen} from '@/features/reports/screens/CategoryDetailScreen';
import {RecurringScreen} from '@/features/recurring/screens/RecurringScreen';
import {RecurringFormScreen} from '@/features/recurring/screens/RecurringFormScreen';
import {SettingsScreen} from '@/features/settings/screens/SettingsScreen';
import {useTheme} from '@/theme';
import {TabNavigator} from './TabNavigator';
import type {RootStackParamList} from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const {colors, isDark} = useTheme();

  // Bridge Kharcha's theme tokens into React Navigation's theming so native
  // chrome (modal headers, backgrounds) matches the app palette.
  const navigationTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
      },
    }),
    [colors, isDark],
  );

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator screenOptions={{headerShown: false}}>
          <Stack.Screen name="Tabs" component={TabNavigator} />
          <Stack.Screen
            name="AddExpense"
            component={AddExpenseScreen}
            options={({route}) => ({
              presentation: 'modal' as const,
              headerShown: true,
              title: route.params?.expenseId ? 'Edit Expense' : 'Add Expense',
              headerStyle: {backgroundColor: colors.surface},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            })}
          />
          <Stack.Screen
            name="AddIncome"
            component={AddIncomeScreen}
            options={({route}) => ({
              presentation: 'modal' as const,
              headerShown: true,
              title: route.params?.incomeId ? 'Edit Income' : 'Add Income',
              headerStyle: {backgroundColor: colors.surface},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            })}
          />
          <Stack.Screen
            name="Budgets"
            component={BudgetScreen}
            options={{
              headerShown: true,
              title: 'Budget',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="Categories"
            component={CategoriesScreen}
            options={{
              headerShown: true,
              title: 'Categories',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="Recurring"
            component={RecurringScreen}
            options={{
              headerShown: true,
              title: 'Recurring Transactions',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="RecurringForm"
            component={RecurringFormScreen}
            options={({route}) => ({
              headerShown: true,
              title: route.params?.ruleId ? 'Edit Recurring' : 'Add Recurring',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            })}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              headerShown: true,
              title: 'Settings',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="Backup"
            component={BackupScreen}
            options={{
              headerShown: true,
              title: 'Backup & Export',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="ExportCsv"
            component={ExportCsvScreen}
            options={{
              headerShown: true,
              title: 'Export CSV',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="ImportCsv"
            component={ImportCsvScreen}
            options={{
              headerShown: true,
              title: 'Import CSV',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="CategoryDetail"
            component={CategoryDetailScreen}
            options={{
              headerShown: true,
              title: 'Category Detail',
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
