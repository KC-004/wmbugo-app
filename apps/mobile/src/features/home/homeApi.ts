import { getCurrency, homeSummary, MarkPromptSeen, SEEN_PROMPT_SQL, type CurrencyCode, type HomeSummary } from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import type { SeenStore } from '../../shared/feedback/tooltipController';
import { presentHero, type HeroView } from './heroPresenter';

export interface HomeData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly timezoneId: string;
  /** Local date (YYYY-MM-DD) and hour (0-23) in the profile timezone. */
  readonly today: string;
  readonly hour: number;
  /** The whole snapshot and the hero view model built from it. */
  readonly summary: HomeSummary;
  readonly hero: HeroView;
}

export interface HomeApi {
  load(): Promise<HomeData | null>;
  seen: SeenStore;
  /** The current time in ms; Home compares its local date with the loaded one to notice midnight. */
  nowMs?: () => number;
}

export const HOME_QUERY_KEY = ['home', 'summary'] as const;

function hourIn(nowMs: number, tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(nowMs));
  } catch {
    return 12;
  }
}

/** Tips are remembered in `prompt_state` and never inserted anywhere else. */
export const promptStateSeenStore: SeenStore = {
  async hasSeen(id) {
    const rows = await getServices().db.query(SEEN_PROMPT_SQL, [id]);
    return rows.length > 0 && Number(rows[0]![0]) > 0;
  },
  async markSeen(id) {
    await getServices().writer.run(MarkPromptSeen, { key: id }, 'user');
  },
};

/** What Home shows from the snapshot: the one place the snapshot is mapped to screen data. */
export function homeDataFrom(profile: { currency: CurrencyCode; locale: string; timezoneId: string }, summary: HomeSummary, nowMs: number): HomeData {
  const cur = getCurrency(profile.currency);
  return {
    currency: profile.currency,
    locale: profile.locale,
    timezoneId: profile.timezoneId,
    today: summary.today,
    hour: hourIn(nowMs, profile.timezoneId),
    summary,
    hero: presentHero(summary, cur.ok ? cur.value.exponent : 2),
  };
}

export const realHomeApi: HomeApi = {
  seen: promptStateSeenStore,
  nowMs: () => systemClock.nowMs(),
  async load() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const now = systemClock.nowMs();
    // One transaction on the serialised connection: the hero, the spent card and the accounts all come from the same ledger state.
    const summary = await db.transaction((tx) => homeSummary(tx, now));
    return summary ? homeDataFrom(p, summary, now) : null;
  },
};
