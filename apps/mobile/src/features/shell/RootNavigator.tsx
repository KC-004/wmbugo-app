import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { DefaultTheme, NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../../shared/copy';
import { navLayout } from '../../shared/feedback/layout';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import type { AddButtonRef } from './AddButton';
import { useOpenAdd } from '../add/useOpenAdd';
import { ActivityScreen } from '../activity/ActivityScreen';
import { HomeScreen } from '../home/HomeScreen';
import { AccountsScreen } from '../accounts/AccountsScreen';
import { ScreenHeader } from './ScreenHeader';
import { TabBar, type TabRoute } from './TabBar';
import { markTabFirstFrame } from './navTiming';

type RootParams = { Tabs: undefined; Accounts: undefined; Settings: undefined };
const RootStack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator();
const TabStack = createNativeStackNavigator();

type Nav = { navigate: (s: keyof RootParams) => void };

/** The frame every tab shares: safe area, a centred column, and the first-frame timing mark. */
function TabFrame({ tab, children }: { tab?: TabRoute; children: ReactNode }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const column = navLayout(width).contentWidth;
  useEffect(() => {
    if (tab) requestAnimationFrame(() => markTabFirstFrame(tab));
  }, [tab]);
  return (
    <View style={[styles.screen, { backgroundColor: theme.color('bg-canvas'), paddingTop: insets.top }]}>
      <View style={[styles.column, { maxWidth: column, flex: 1 }]}>{children}</View>
    </View>
  );
}

/** Header only: Insights and Plan show nothing else until their epics land. */
function HeaderOnly({ title, tab }: { title: string; tab: TabRoute }) {
  const nav = useNavigation<Nav>();
  return (
    <TabFrame tab={tab}>
      <ScreenHeader title={title} onAccounts={() => nav.navigate('Accounts')} onProfile={() => nav.navigate('Settings')} />
    </TabFrame>
  );
}

function HomeTab() {
  const nav = useNavigation<Nav>();
  return (
    <TabFrame tab="Home">
      <HomeScreen onAccounts={() => nav.navigate('Accounts')} onProfile={() => nav.navigate('Settings')} onAddAccount={() => nav.navigate('Accounts')} />
    </TabFrame>
  );
}

function ActivityTab() {
  const nav = useNavigation<Nav>();
  const openAdd = useOpenAdd();
  return (
    <TabFrame tab="Activity">
      <ActivityScreen onAccounts={() => nav.navigate('Accounts')} onProfile={() => nav.navigate('Settings')} onAdd={openAdd} />
    </TabFrame>
  );
}

const stackOf = (name: string, Screen: () => ReactNode) =>
  function TabStackScreen() {
    return (
      <TabStack.Navigator screenOptions={{ headerShown: false }}>
        <TabStack.Screen name={name}>{() => <Screen />}</TabStack.Screen>
      </TabStack.Navigator>
    );
  };

const HomeStack = stackOf('HomeRoot', HomeTab);
const ActivityStack = stackOf('ActivityRoot', ActivityTab);
const InsightsStack = stackOf('InsightsRoot', () => <HeaderOnly title={copy.nav.insights} tab="Insights" />);
const PlanStack = stackOf('PlanRoot', () => <HeaderOnly title={copy.nav.plan} tab="Plan" />);

function TabsWithAdd() {
  const opener: AddButtonRef = useRef(null);
  const { width } = useWindowDimensions();
  const nav = navLayout(width);
  const onAdd = useOpenAdd(opener);

  return (
    <View style={styles.fill}>
      <Tabs.Navigator
        initialRouteName="Home"
        screenOptions={{ headerShown: false, tabBarPosition: nav.kind === 'rail' ? 'left' : 'bottom' }}
        tabBar={(props) => <TabBar {...props} onAdd={onAdd} addRef={opener} />}>
        <Tabs.Screen name="Home" component={HomeStack} />
        <Tabs.Screen name="Activity" component={ActivityStack} />
        <Tabs.Screen name="Insights" component={InsightsStack} />
        <Tabs.Screen name="Plan" component={PlanStack} />
      </Tabs.Navigator>
    </View>
  );
}

function Placeholder({ title }: { title: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: theme.color('bg-canvas'), paddingTop: insets.top }]}>
      <Text accessibilityRole="header" style={[textStyle('title'), styles.pad, { color: theme.color('text-primary') }]}>
        {title}
      </Text>
    </View>
  );
}

function AccountsRoute() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: theme.color('bg-canvas'), paddingTop: insets.top }]}>
      <AccountsScreen />
    </View>
  );
}

/**
 * Root navigator: bottom tabs Home, Activity, Insights, Plan (the ＋ sits in the bar) with a
 * stack per tab, no drawer, state kept across switches. Accounts and Settings open above the tabs.
 */
export function RootNavigator() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navTheme = {
    ...DefaultTheme,
    dark: theme.scheme === 'dark',
    colors: { ...DefaultTheme.colors, background: theme.color('bg-canvas'), card: theme.color('bg-surface'), text: theme.color('text-primary'), border: theme.color('border-hairline'), primary: theme.color('accent-primary') },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <ToastHost bottomOffset={88 + insets.bottom}>
        <SheetHost>
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="Tabs" component={TabsWithAdd} />
            <RootStack.Screen name="Accounts" component={AccountsRoute} />
            <RootStack.Screen name="Settings">{() => <Placeholder title={copy.nav.settings} />}</RootStack.Screen>
          </RootStack.Navigator>
        </SheetHost>
      </ToastHost>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, alignItems: 'center' },
  column: { width: '100%' },
  pad: { padding: 16 },
});
