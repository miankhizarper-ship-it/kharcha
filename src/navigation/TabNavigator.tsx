import {Ionicons} from '@expo/vector-icons';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {FAB_SIZE, Fab, Text} from '@/components/ui';
import {HomeScreen} from '@/features/home/screens/HomeScreen';
import {MoreScreen} from '@/features/more/screens/MoreScreen';
import {ReportsScreen} from '@/features/reports/screens/ReportsScreen';
import {TransactionsScreen} from '@/features/transactions/screens/TransactionsScreen';
import {useTheme} from '@/theme';
import {AddActionSheet} from './AddActionSheet';
import type {MainTabParamList, RootStackParamList} from './types';

type TabName = keyof MainTabParamList;
type IconName = keyof typeof Ionicons.glyphMap;

const BAR_HEIGHT = 60;
/** Visual gap in the middle of the bar so the centered FAB has breathing room. */
const CENTER_SLOT_WIDTH = FAB_SIZE + 12;

const TAB_CONFIG: Record<
  TabName,
  {activeIcon: IconName; inactiveIcon: IconName}
> = {
  Home: {activeIcon: 'home', inactiveIcon: 'home-outline'},
  Transactions: {activeIcon: 'receipt', inactiveIcon: 'receipt-outline'},
  Reports: {activeIcon: 'stats-chart', inactiveIcon: 'stats-chart-outline'},
  More: {activeIcon: 'grid', inactiveIcon: 'grid-outline'},
};

interface MainTabBarProps extends BottomTabBarProps {
  onAddExpense: () => void;
  onAddIncome: () => void;
}

/**
 * Custom bottom bar: the four tabs with a prominent, centered floating
 * action button between "Transactions" and "Reports". The button opens an
 * action sheet to record either an expense or income.
 */
function MainTabBar({
  state,
  navigation,
  onAddExpense,
  onAddIncome,
}: MainTabBarProps) {
  const {colors, spacing, typography} = useTheme();
  const insets = useSafeAreaInsets();
  const [actionSheetVisible, setActionSheetVisible] = useState(false);

  return (
    <View
      style={[
        styles.wrapper,
        {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const icons = TAB_CONFIG[route.name as TabName] ?? TAB_CONFIG.Home;

          return (
            <React.Fragment key={route.key}>
              {index === 2 ? <View style={{width: CENTER_SLOT_WIDTH}} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={isFocused ? {selected: true} : {}}
                style={styles.tab}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
              >
                <Ionicons
                  name={isFocused ? icons.activeIcon : icons.inactiveIcon}
                  size={22}
                  color={isFocused ? colors.primary : colors.tabBarInactive}
                />
                <Text
                  style={{
                    marginTop: spacing.xs,
                    fontSize: typography.size.caption - 1,
                    fontWeight: typography.weight.medium,
                    color: isFocused ? colors.primary : colors.tabBarInactive,
                  }}
                >
                  {route.name}
                </Text>
              </Pressable>
            </React.Fragment>
          );
        })}
      </View>

      {/* Centered primary action — raised above the bar. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.fabSlot,
          {bottom: insets.bottom + (BAR_HEIGHT - FAB_SIZE) / 2 + 14},
        ]}
      >
        <Fab
          onPress={() => setActionSheetVisible(true)}
          accessibilityLabel="Add transaction"
        />
      </View>

      <AddActionSheet
        visible={actionSheetVisible}
        onAddExpense={() => {
          setActionSheetVisible(false);
          onAddExpense();
        }}
        onAddIncome={() => {
          setActionSheetVisible(false);
          onAddIncome();
        }}
        onClose={() => setActionSheetVisible(false)}
      />
    </View>
  );
}

const Tab = createBottomTabNavigator<MainTabParamList>();

export function TabNavigator() {
  // TabNavigator is a screen of the root stack, so this context is the
  // stack navigation — exactly what we need to present the AddExpense modal.
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Tab.Navigator
      screenOptions={{headerShown: false}}
      tabBar={props => (
        <MainTabBar
          {...props}
          onAddExpense={() => navigation.navigate('AddExpense')}
          onAddIncome={() => navigation.navigate('AddIncome')}
        />
      )}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Reports" component={ReportsScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: BAR_HEIGHT,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
