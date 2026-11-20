import { create } from 'zustand';
import type { InsightsFilters, PeriodPreset } from '@wmbugo/core';
import { DEFAULT_SELECTION, type InsightsSelection } from './insightsApi';

/**
 * The Insights selection (Story 7.2): kept while the app runs, so Back and a tab switch return to the same period and
 * filters, and gone after process death. It never touches Home, Plan or Activity. A selection of `default` follows the
 * profile's default period, so a payday change moves it without anyone doing anything.
 */
interface InsightsState {
  selection: InsightsSelection;
  setPreset: (preset: PeriodPreset | 'default', custom?: { start: string; end: string }) => void;
  setFilters: (filters: InsightsFilters) => void;
  clearFilters: () => void;
  reset: () => void;
}

export const useInsightsStore = create<InsightsState>((set) => ({
  selection: DEFAULT_SELECTION,
  setPreset: (preset, custom) => set((s) => ({ selection: { ...s.selection, preset, ...(custom ? { custom } : {}) } })),
  setFilters: (filters) => set((s) => ({ selection: { ...s.selection, filters } })),
  clearFilters: () => set((s) => ({ selection: { ...s.selection, filters: {} } })),
  reset: () => set({ selection: DEFAULT_SELECTION }),
}));

/** Removes one value from one filter; an emptied filter is dropped. */
export function withoutFilterValue(f: InsightsFilters, key: keyof InsightsFilters, value: string): InsightsFilters {
  const list = (f[key] as readonly string[] | undefined) ?? [];
  const next = list.filter((x) => x !== value);
  const out: Record<string, unknown> = { ...f };
  if (next.length > 0) out[key] = next;
  else delete out[key];
  return out as InsightsFilters;
}
