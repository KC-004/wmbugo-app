import { layout } from '../theme/tokens';

export type NavKind = 'bar' | 'rail';

export interface NavLayout {
  readonly kind: NavKind;
  /** Rail width in dp (0 for the bar). */
  readonly railWidth: number;
  /** Width of the centred content column. */
  readonly contentWidth: number;
}

export const RAIL_WIDTH = 80;

/**
 * Below 600dp (including phone landscape) the glass tab bar; from 600dp an 80dp
 * solid rail with content centred at a maximum of 600dp. No two-pane layout.
 */
export function navLayout(windowWidth: number): NavLayout {
  const rail = windowWidth >= layout.railBreakpoint;
  const available = windowWidth - (rail ? RAIL_WIDTH : 0);
  return { kind: rail ? 'rail' : 'bar', railWidth: rail ? RAIL_WIDTH : 0, contentWidth: Math.min(available, layout.contentMax) };
}

/** The screen header splits into two rows at font scale 1.3 and above, or when it does not fit. */
export function headerSplits(fontScale: number, fitsOneRow = true): boolean {
  return fontScale >= 1.3 || !fitsOneRow;
}

/** Tab slots are at least 64dp wide and 56dp tall. */
export const TAB_SLOT = { minWidth: 64, minHeight: 56 } as const;
export const ADD_BUTTON_SIZE = 56;

/**
 * How far the end of a tab's scroll must stay clear of the floating tab bar and the ＋ button above it: the bar's margin, its slot
 * height and half the ＋ that rises over it, plus a gap and the bottom safe-area inset (HOM-006).
 */
export const tabBarClearance = (insetBottom: number): number => 8 + TAB_SLOT.minHeight + ADD_BUTTON_SIZE / 2 + 16 + insetBottom;
