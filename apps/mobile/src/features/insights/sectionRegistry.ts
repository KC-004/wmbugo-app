import type { ReactNode } from 'react';
import type { InsightsApi, InsightsOverview, InsightsSelection } from './insightsApi';

/**
 * The Insights question sections (Story 7.2, INS-007). Each later story registers one in its own file, so adding a section
 * never changes the overview. A section that has not landed is simply absent: there is no placeholder.
 */
/** Where a section can send the user (Story 7.7): a budget, a goal, Activity, the 50/30/20 flow. */
export interface InsightsSectionNav {
  readonly onOpenBudget?: (budgetId: string, periodStart: string) => void;
  readonly onOpenGoal?: (goalId: string) => void;
  readonly onSortIt?: (query: import('@wmbugo/core').ActivityQuery) => void;
  readonly onTryTemplate?: () => void;
}

export interface InsightsSectionContext {
  readonly nav?: InsightsSectionNav;
  readonly overview: InsightsOverview;
  readonly api: InsightsApi;
  readonly selection: InsightsSelection;
  /** Opens SCR-12 for a segment (Story 7.3). Absent until that screen exists. */
  readonly onDrill?: (target: unknown) => void;
}

export interface InsightsSection {
  readonly id: string;
  /** The question heading: a real heading for TalkBack heading navigation. */
  readonly heading: string;
  readonly order: number;
  /** Hidden for a scope that has nothing to show. */
  readonly visible: (ctx: InsightsSectionContext) => boolean;
  readonly render: (ctx: InsightsSectionContext) => ReactNode;
}

const registry = new Map<string, InsightsSection>();

export function registerInsightsSection(section: InsightsSection): void {
  registry.set(section.id, section);
}

/** The registered sections in their order. */
export const insightsSections = (): readonly InsightsSection[] => [...registry.values()].sort((a, b) => a.order - b.order);

/** For tests: forget every registered section. */
export const clearInsightsSections = (): void => registry.clear();
