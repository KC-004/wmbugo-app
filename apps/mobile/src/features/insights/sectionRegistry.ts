import type { ReactNode } from 'react';
import type { InsightsOverview } from './insightsApi';

/**
 * The Insights question sections (Story 7.2, INS-007). Each later story registers one in its own file, so adding a section
 * never changes the overview. A section that has not landed is simply absent: there is no placeholder.
 */
export interface InsightsSectionContext {
  readonly overview: InsightsOverview;
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
