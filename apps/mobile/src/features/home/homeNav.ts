import type { ActivityQuery } from '@wmbugo/core';

/** What the navigator gives Home so the hero can go anywhere: a stack screen, a tab, an Activity filter, the budget editor. */
export interface HomeNavDeps {
  /** Opens a stack screen by name, with no params. */
  navigate: (screen: string, params?: unknown) => void;
  openActivity: (query: ActivityQuery) => void;
  requestBudgetEditor: () => void;
}

/** The four hero destinations (Story 5.2): the overall budget, the Plan tab, the editor with Overall, and Activity filtered. */
export function homeHeroNav(d: HomeNavDeps) {
  return {
    onOpenBudget: (budgetId: string, periodStart?: string) => d.navigate('BudgetDetail', { budgetId, ...(periodStart ? { periodStart } : {}) }),
    onOpenReview: () => d.navigate('ReviewQueue', {}),
    onEditHome: () => d.navigate('HomeEdit'),
    onOpenActivity: (query: ActivityQuery) => d.openActivity(query),
    onOpenPlan: () => d.navigate('Tabs', { screen: 'Plan' }),
    onOpenBill: (ruleId: string) => d.navigate('BillDetail', { ruleId }),
    onOpenGoal: (goalId: string) => d.navigate('GoalDetail', { goalId }),
    onOpenGoals: () => d.navigate('Goals'),
    onSetLimit: () => {
      d.requestBudgetEditor();
      d.navigate('Tabs', { screen: 'Plan' });
    },
    onSortIt: (query: ActivityQuery) => d.openActivity(query),
  };
}
