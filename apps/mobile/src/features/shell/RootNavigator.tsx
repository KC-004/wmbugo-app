import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { DefaultTheme, NavigationContainer, useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../../shared/copy';
import { navLayout } from '../../shared/feedback/layout';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { AppLockOfferHost } from '../lock/AppLockOfferHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import type { AddButtonRef } from './AddButton';
import { useOpenAdd, useOpenAddWith } from '../add/useOpenAdd';
import { useOpenSplit } from '../activity/useOpenSplit';
import { ActivityScreen } from '../activity/ActivityScreen';
import { TransactionDetailScreen } from '../activity/TransactionDetailScreen';
import { ReviewQueueScreen } from '../activity/ReviewQueueScreen';
import { useReviewDot } from '../activity/reviewDot';
import { useEntryActions } from '../activity/useEntryActions';
import { HomeScreen } from '../home/HomeScreen';
import { homeHeroNav } from '../home/homeNav';
import { HomeEditScreen } from '../home/HomeEditScreen';
import type { ActivityQuery, DrillTarget } from '@wmbugo/core';
import { useUiStore } from '../../shared/state/uiStore';
import { BudgetsScreen } from '../budgets/BudgetsScreen';
import { appNotifier } from '../../adapters/notifier';
import { BudgetDetailScreen } from '../budgets/BudgetDetailScreen';
import { BillsScreen } from '../bills/BillsScreen';
import { BillDetailScreen } from '../bills/BillDetailScreen';
import { InsightsScreen } from '../insights/InsightsScreen';
import { DrillScreen } from '../insights/DrillScreen';
import { useInsightsStore } from '../insights/insightsStore';
import { registerInsightsSections } from '../insights/sections';
import { PlanHubScreen } from '../plan/PlanHubScreen';
import { GoalsScreen } from '../goals/GoalsScreen';
import { GoalDetailScreen } from '../goals/GoalDetailScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { AccountDetailScreen } from '../accounts/AccountDetailScreen';
import { AccountsScreen } from '../accounts/AccountsScreen';
import { usePayBill } from '../accounts/payBill';
import { ScreenFrame } from '../../shared/ui/ScreenFrame';
import { TopBar } from '../../shared/ui/TopBar';
import { TabBar, type TabRoute } from './TabBar';
import { markTabFirstFrame } from './navTiming';

type RootParams = { Tabs: undefined; BudgetDetail: { budgetId: string; periodStart?: string }; Accounts: undefined; AccountDetail: { accountId: string }; TransactionDetail: { transactionId: string }; ReviewQueue: { focusId?: string }; Settings: undefined; HomeEdit: undefined; Bills: { focusRuleId?: string } | undefined; BillDetail: { ruleId: string }; Goals: undefined; GoalDetail: { goalId: string }; Budgets: undefined; InsightsDrill: { target: DrillTarget } };
registerInsightsSections();
const RootStack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator();
const TabStack = createNativeStackNavigator();

type Nav = { navigate: (s: keyof RootParams, p?: RootParams[keyof RootParams]) => void };

/** The frame every tab shares: safe area, a centred column, and the first-frame timing mark. */
function TabFrame({ tab, children }: { tab?: TabRoute; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const column = navLayout(width).contentWidth;
  useEffect(() => {
    if (tab) requestAnimationFrame(() => markTabFirstFrame(tab));
  }, [tab]);
  return (
    <ScreenFrame style={styles.screen}>
      <View style={[styles.column, { maxWidth: column, flex: 1 }]}>{children}</View>
    </ScreenFrame>
  );
}

/** The top bar of a tab: the shared TopBar with the Accounts icon and the avatar already wired, so a tab only gives a title. */
function TabTopBar({ title }: { title: string }) {
  const nav = useNavigation<Nav>();
  return <TopBar title={title} onAccounts={() => nav.navigate('Accounts')} onProfile={() => nav.navigate('Settings')} />;
}

/** Insights opens on the overview (SCR-11, Story 7.2): period and filters, the KPI tiles, then the question sections. */
function InsightsTab() {
  const nav = useNavigation<Nav>();
  const openAdd = useOpenAdd();
  const openActivity = useOpenActivityFilter();
  return (
    <TabFrame tab="Insights">
      <TabTopBar title={copy.nav.insights} />
      <InsightsScreen nav={{ onAdd: openAdd, onReview: () => nav.navigate('ReviewQueue', {}), onDrill: (target) => nav.navigate('InsightsDrill', { target: target as DrillTarget }), onOpenBudget: (budgetId, periodStart) => nav.navigate('BudgetDetail', { budgetId, periodStart }), onOpenGoal: (goalId) => nav.navigate('GoalDetail', { goalId }), onSortIt: openActivity, onTryTemplate: () => nav.navigate('Budgets') }} />
    </TabFrame>
  );
}

/** Plan opens on the hub (SCR-13): Before payday, then Budgets, Bills & recurring and Goals. SCR-14, SCR-16 and SCR-17 are pushed from it. */
function PlanTab() {
  const nav = useNavigation<Nav>();
  const openActivity = useOpenActivityFilter();
  return (
    <TabFrame tab="Plan">
      <TabTopBar title={copy.nav.plan} />
      <PlanHubScreen
        onOpenBills={() => nav.navigate('Bills')}
        onOpenBill={(ruleId) => nav.navigate('BillDetail', { ruleId })}
        onOpenGoals={() => nav.navigate('Goals')}
        onOpenGoal={(goalId) => nav.navigate('GoalDetail', { goalId })}
        onOpenBudgets={() => nav.navigate('Budgets')}
        onOpenBudget={(budgetId) => nav.navigate('BudgetDetail', { budgetId })}
        onOpenAccounts={() => nav.navigate('Accounts')}
        onOpenActivity={openActivity}
      />
    </TabFrame>
  );
}

function HomeTab() {
  const nav = useNavigation<Nav>();
  const tabs = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const openActivity = useOpenActivityFilter();
  return (
    <TabFrame tab="Home">
      <HomeScreen
        onAccounts={() => nav.navigate('Accounts')}
        onProfile={() => nav.navigate('Settings')}
        onAddAccount={() => nav.navigate('Accounts')}
        {...homeHeroNav({ navigate: (s, p) => tabs.navigate(s, p), openActivity, requestBudgetEditor: () => useUiStore.getState().requestBudgetEditor() })}
      />
    </TabFrame>
  );
}

function ActivityTab() {
  const nav = useNavigation<Nav>();
  const openAdd = useOpenAdd();
  const entry = useEntryActions();
  const focused = useIsFocused();
  return (
    <TabFrame tab="Activity">
      <ActivityScreen focused={focused} onAccounts={() => nav.navigate('Accounts')} onProfile={() => nav.navigate('Settings')} onAdd={openAdd} onOpen={entry.open} onReview={entry.review} onDeleteRow={(r) => void entry.remove(r)} onRecategorise={(r) => void entry.recategorise(r)} />
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
const InsightsStack = stackOf('InsightsRoot', InsightsTab);
const PlanStack = stackOf('PlanRoot', PlanTab);

function TabsWithAdd() {
  const opener: AddButtonRef = useRef(null);
  const root = useNavigation<Nav>();
  // Tapping a budget alert opens that budget and period (Story 4.9). Nothing is subscribed while no notifier is available.
  useEffect(
    () =>
      appNotifier.onOpen((data) => {
        // A bill reminder opens Bills, scrolled to that bill (Story 6.5).
        if (data.screen === 'Bills') root.navigate('Bills', data.ruleId ? { focusRuleId: data.ruleId } : undefined);
        if (data.screen === 'BudgetDetail' && data.budgetId) root.navigate('BudgetDetail', { budgetId: data.budgetId, ...(data.periodStart ? { periodStart: data.periodStart } : {}) });
      }),
    [root],
  );
  const { width } = useWindowDimensions();
  const nav = navLayout(width);
  const onAdd = useOpenAdd(opener);
  const reviewDot = useReviewDot();

  return (
    <View style={styles.fill}>
      <Tabs.Navigator
        initialRouteName="Home"
        screenOptions={{ headerShown: false, tabBarPosition: nav.kind === 'rail' ? 'left' : 'bottom' }}
        tabBar={(props) => <TabBar {...props} onAdd={onAdd} addRef={opener} reviewDot={reviewDot} />}>
        <Tabs.Screen name="Home" component={HomeStack} />
        <Tabs.Screen name="Activity" component={ActivityStack} />
        <Tabs.Screen name="Insights" component={InsightsStack} />
        <Tabs.Screen name="Plan" component={PlanStack} />
      </Tabs.Navigator>
    </View>
  );
}

function SettingsRoute() {
  const nav = useNavigation<{ goBack: () => void }>();
  return (
    <ScreenFrame>
      <SettingsScreen onBack={() => nav.goBack()} />
    </ScreenFrame>
  );
}

function AccountsRoute() {
  const nav = useNavigation<{ navigate: (s: 'AccountDetail', p: { accountId: string }) => void; goBack: () => void }>();
  const payBill = usePayBill();
  return (
    <ScreenFrame>
      <AccountsScreen onPayBill={payBill} onBack={() => nav.goBack()} onOpen={(accountId) => nav.navigate('AccountDetail', { accountId })} />
    </ScreenFrame>
  );
}

function AccountDetailRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'TransactionDetail', p: { transactionId: string }) => void }>();
  const route = useRoute<RouteProp<RootParams, 'AccountDetail'>>();
  const { accountId } = route.params;
  const moveMoney = useOpenAdd(undefined, { kind: 'transfer', accountId });
  const addExpense = useOpenAdd(undefined, { kind: 'expense', accountId });
  const payBill = usePayBill();
  return (
    <ScreenFrame>
      <AccountDetailScreen accountId={accountId} onBack={() => nav.goBack()} onMoveMoney={moveMoney} onAddExpense={addExpense} onPayBill={() => payBill(accountId)} onOpenTransaction={(transactionId) => nav.navigate('TransactionDetail', { transactionId })} />
    </ScreenFrame>
  );
}

function HomeEditRoute() {
  const nav = useNavigation<{ goBack: () => void }>();
  return (
    <ScreenFrame>
      <HomeEditScreen onBack={() => nav.goBack()} />
    </ScreenFrame>
  );
}

function ReviewQueueRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'TransactionDetail', p: { transactionId: string }) => void }>();
  const route = useRoute<RouteProp<RootParams, 'ReviewQueue'>>();
  return (
    <ScreenFrame>
      <ReviewQueueScreen focusId={route.params?.focusId} onBack={() => nav.goBack()} onEdit={(transactionId) => nav.navigate('TransactionDetail', { transactionId })} />
    </ScreenFrame>
  );
}

/** Opens the Activity tab with a filter already applied (a budget's drill-down, `Not classified · Sort it`). */
function useOpenActivityFilter() {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  return (query: ActivityQuery) => {
    useUiStore.getState().setActivityFilter({ query, datePreset: 'custom' });
    nav.navigate('Tabs', { screen: 'Activity' });
  };
}

function BillsRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'BillDetail', p: { ruleId: string }) => void }>();
  const route = useRoute<RouteProp<RootParams, 'Bills'>>();
  return (
    <ScreenFrame>
      <BillsScreen onBack={() => nav.goBack()} {...(route.params?.focusRuleId ? { focusRuleId: route.params.focusRuleId } : {})} onOpenBill={(ruleId) => nav.navigate('BillDetail', { ruleId })} />
    </ScreenFrame>
  );
}

function BillDetailRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'TransactionDetail', p: { transactionId: string }) => void }>();
  const route = useRoute<RouteProp<RootParams, 'BillDetail'>>();
  return (
    <ScreenFrame>
      <BillDetailScreen ruleId={route.params.ruleId} onBack={() => nav.goBack()} onOpenEntry={(transactionId) => nav.navigate('TransactionDetail', { transactionId })} />
    </ScreenFrame>
  );
}

/** SCR-14 Budgets, pushed from the Plan hub (`See all budgets`); Back returns to the hub. */
function BudgetsRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'BudgetDetail', p: { budgetId: string }) => void }>();
  const openActivity = useOpenActivityFilter();
  return (
    <ScreenFrame>
      <TopBar title={copy.budgets.title} onBack={() => nav.goBack()} backTestID="budgets-back" />
      <ScrollView contentContainerStyle={styles.planScroll} keyboardShouldPersistTaps="handled">
        <BudgetsScreen onOpen={(budgetId) => nav.navigate('BudgetDetail', { budgetId })} onOpenActivity={openActivity} />
      </ScrollView>
    </ScreenFrame>
  );
}

/** SCR-12 (Story 7.3): pushed over the Insights tab, so Back returns to the same overview, period and filters. */
function InsightsDrillRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'TransactionDetail', p: { transactionId: string }) => void }>();
  const route = useRoute<RouteProp<RootParams, 'InsightsDrill'>>();
  const selection = useInsightsStore((s) => s.selection);
  const openActivity = useOpenActivityFilter();
  return (
    <ScreenFrame>
      <DrillScreen selection={selection} target={route.params.target} onBack={() => nav.goBack()} onOpenEntry={(transactionId) => nav.navigate('TransactionDetail', { transactionId })} onSeeInActivity={openActivity} />
    </ScreenFrame>
  );
}

function GoalsRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'GoalDetail', p: { goalId: string }) => void }>();
  return (
    <ScreenFrame>
      <GoalsScreen onBack={() => nav.goBack()} onOpenGoal={(goalId) => nav.navigate('GoalDetail', { goalId })} />
    </ScreenFrame>
  );
}

function GoalDetailRoute() {
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'Accounts') => void }>();
  const route = useRoute<RouteProp<RootParams, 'GoalDetail'>>();
  const openAdd = useOpenAddWith();
  return (
    <ScreenFrame>
      <GoalDetailScreen
        goalId={route.params.goalId}
        onBack={() => nav.goBack()}
        onMove={(goal, potId) => openAdd({ kind: 'transfer', accountId: null, toAccountId: potId, goal: { id: goal.id, name: goal.name, setAsideMinor: goal.setAsideMinor } })}
        onAddPot={() => nav.navigate('Accounts')}
      />
    </ScreenFrame>
  );
}

function BudgetDetailRoute() {
  const openActivity = useOpenActivityFilter();
  const nav = useNavigation<{ goBack: () => void; navigate: (s: 'TransactionDetail', p: { transactionId: string }) => void }>();
  const route = useRoute<RouteProp<RootParams, 'BudgetDetail'>>();
  return (
    <ScreenFrame>
      <BudgetDetailScreen onOpenActivity={openActivity} budgetId={route.params.budgetId} {...(route.params.periodStart ? { periodStart: route.params.periodStart } : {})} onBack={() => nav.goBack()} onOpenEntry={(transactionId) => nav.navigate('TransactionDetail', { transactionId })} />
    </ScreenFrame>
  );
}

function TransactionDetailRoute() {
  const nav = useNavigation<{ goBack: () => void }>();
  const route = useRoute<RouteProp<RootParams, 'TransactionDetail'>>();
  const openAdd = useOpenAddWith();
  const openSplit = useOpenSplit();
  return (
    <ScreenFrame>
      <TransactionDetailScreen
        transactionId={route.params.transactionId}
        onBack={() => nav.goBack()}
        onEdit={(spec) => openAdd(undefined, spec)}
        onDuplicate={(preset) => openAdd(preset)}
        onSplit={(id) => openSplit(id)}
      />
    </ScreenFrame>
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
          <AppLockOfferHost />
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="Tabs" component={TabsWithAdd} />
            <RootStack.Screen name="Accounts" component={AccountsRoute} />
            <RootStack.Screen name="AccountDetail" component={AccountDetailRoute} />
            <RootStack.Screen name="BudgetDetail" component={BudgetDetailRoute} />
            <RootStack.Screen name="Bills" component={BillsRoute} />
            <RootStack.Screen name="BillDetail" component={BillDetailRoute} />
            <RootStack.Screen name="Budgets" component={BudgetsRoute} />
            <RootStack.Screen name="Goals" component={GoalsRoute} />
            <RootStack.Screen name="InsightsDrill" component={InsightsDrillRoute} />
            <RootStack.Screen name="GoalDetail" component={GoalDetailRoute} />
            <RootStack.Screen name="TransactionDetail" component={TransactionDetailRoute} />
            <RootStack.Screen name="ReviewQueue" component={ReviewQueueRoute} />
            <RootStack.Screen name="Settings" component={SettingsRoute} />
            <RootStack.Screen name="HomeEdit" component={HomeEditRoute} />
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
  planScroll: { padding: 16, paddingBottom: 120 },
});
