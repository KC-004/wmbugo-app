/**
 * The Home card layout (Story 5.6, HOM-003): which cards, in what order, hidden or shown, at what size. Stored as one JSON list
 * in the profile settings; `null` (or no value) means the PRD order with every card shown at its default size.
 */

export type HomeCardSize = 'full' | 'compact';
export const HOME_CARD_SIZES: readonly HomeCardSize[] = ['full', 'compact'];

export interface HomeLayoutEntry {
  readonly cardId: string;
  readonly hidden: boolean;
  readonly size: HomeCardSize;
}

/** A card the app knows: its id in default (PRD) order and the size it shows at until the user changes it. */
export interface RegisteredCard {
  readonly id: string;
  readonly defaultSize: HomeCardSize;
  /** The sizes the card supports (default size first). A saved size it does not support falls back to the default. */
  readonly sizes?: readonly HomeCardSize[];
}

/** A clean copy of a valid layout: only the three known fields of each entry, so nothing else is ever stored. */
export const sanitizeHomeLayout = (l: readonly HomeLayoutEntry[]): HomeLayoutEntry[] => l.map((e) => ({ cardId: e.cardId, hidden: e.hidden, size: e.size }));

export const MAX_LAYOUT_ENTRIES = 50;
const MAX_ID = 40;

/** True for a well-formed layout: a short list of entries with distinct ids. */
export function isHomeLayout(v: unknown): v is readonly HomeLayoutEntry[] {
  if (!Array.isArray(v) || v.length > MAX_LAYOUT_ENTRIES) return false;
  const seen = new Set<string>();
  for (const e of v) {
    if (typeof e !== 'object' || e === null) return false;
    const { cardId, hidden, size } = e as Record<string, unknown>;
    if (typeof cardId !== 'string' || cardId.length === 0 || cardId.length > MAX_ID || seen.has(cardId)) return false;
    if (typeof hidden !== 'boolean') return false;
    if (!HOME_CARD_SIZES.includes(size as HomeCardSize)) return false;
    seen.add(cardId);
  }
  return true;
}

/**
 * The layout to draw. A saved id the app no longer knows is ignored; a registered card missing from the saved list (one a later
 * release added) sits at its default position relative to its neighbours: right after the card that precedes it in the PRD order,
 * or first when none does. Cards the user never touched get their default size and are shown.
 */
export function resolveHomeLayout(registry: readonly RegisteredCard[], saved: readonly HomeLayoutEntry[] | null | undefined): HomeLayoutEntry[] {
  const known = new Map(registry.map((c) => [c.id, c]));
  const out: HomeLayoutEntry[] = [];
  const seen = new Set<string>();
  for (const e of saved ?? []) {
    if (!known.has(e.cardId) || seen.has(e.cardId)) continue;
    seen.add(e.cardId);
    const card = known.get(e.cardId)!;
    out.push({ cardId: e.cardId, hidden: e.hidden, size: card.sizes && !card.sizes.includes(e.size) ? card.defaultSize : e.size });
  }
  registry.forEach((card, i) => {
    if (seen.has(card.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((e) => e.cardId === registry[j]!.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, { cardId: card.id, hidden: false, size: card.defaultSize });
    seen.add(card.id);
  });
  return out;
}

/** The default layout: the PRD order, every card shown at its default size. */
export const defaultHomeLayout = (registry: readonly RegisteredCard[]): HomeLayoutEntry[] => registry.map((c) => ({ cardId: c.id, hidden: false, size: c.defaultSize }));

export const sameHomeLayout = (a: readonly HomeLayoutEntry[], b: readonly HomeLayoutEntry[]): boolean =>
  a.length === b.length && a.every((e, i) => e.cardId === b[i]!.cardId && e.hidden === b[i]!.hidden && e.size === b[i]!.size);
