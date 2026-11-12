import { StyleSheet, Text, View } from 'react-native';
import { Warning } from 'phosphor-react-native';
import type { BudgetStatus, CurrencyCode } from '@wmbugo/core';
import { spokenAmount } from '../a11y/labels';
import { copy } from '../copy';
import { moneyText } from './moneyText';
import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';

/** The most the overflow past the limit draws: 20% of the track (UX-DR25). */
export const OVERFLOW_CAP = 0.2;

export type LimitBarState = 'under' | 'near' | 'over' | 'hidden' | 'due-soon';

/** Where the fill, the overflow and the limit tick sit, as fractions of the track. Pure, so the states are testable. */
export function barGeometry(usedMinor: number, targetMinor: number): { fill: number; overflow: number; tick: number } {
  if (targetMinor <= 0) return { fill: 0, overflow: usedMinor > 0 ? OVERFLOW_CAP / (1 + OVERFLOW_CAP) : 0, tick: 1 / (1 + OVERFLOW_CAP) };
  const ratio = usedMinor / targetMinor;
  if (ratio <= 1) return { fill: ratio, overflow: 0, tick: 1 };
  // The track grows by the overflow, capped at 20% of the limit; the limit tick moves left so the overflow stays visible.
  const over = Math.min(ratio - 1, OVERFLOW_CAP);
  const total = 1 + over;
  return { fill: 1 / total, overflow: over / total, tick: 1 / total };
}

const daysText = (n: number): string => (n === 1 ? copy.budgets.dayLeft : copy.budgets.daysLeft.replace('{n}', String(n)));

/** The status line under the bar: `₹600 left · 12 days left`, `85% used`, `Over by ₹740` or `Too early to tell`. */
export function statusLine(s: BudgetStatus, currency: CurrencyCode, locale: string | undefined, hidden: boolean): { text: string; warning: boolean } {
  const b = copy.budgets;
  if (s.status === 'exceeded') return { text: b.over.replace('{amount}', moneyText(s.usedMinor - s.targetMinor, currency, locale, hidden)), warning: true };
  if (s.status === 'insufficient-data') return { text: b.tooEarly, warning: false };
  if (s.status === 'nearing') return { text: hidden ? daysText(s.daysRemaining) : b.percentUsed.replace('{n}', String(s.percentUsed)), warning: false };
  return { text: `${b.left.replace('{left}', moneyText(s.remainingMinor, currency, locale, hidden))}${s.daysRemaining > 0 ? ` · ${daysText(s.daysRemaining)}` : ''}`, warning: false };
}

/**
 * The status line of a Savings bar (Story 4.11): saving is never a warning, so there is no `Over by` and no warning tint.
 * Below the target it says how far to go; at or above it, `Target reached`.
 */
export function savingsStatusLine(s: BudgetStatus, currency: CurrencyCode, locale: string | undefined, hidden: boolean): { text: string; warning: false } {
  const b = copy.budgets;
  if (s.usedMinor >= s.targetMinor && s.targetMinor > 0) return { text: b.targetReached, warning: false };
  const toGo = b.toGo.replace('{amount}', moneyText(s.targetMinor - s.usedMinor, currency, locale, hidden));
  return { text: `${toGo}${s.daysRemaining > 0 ? ` · ${daysText(s.daysRemaining)}` : ''}`, warning: false };
}

/** What TalkBack reads for a Savings row: `Savings, 18,000 of 16,000 rupees, target reached`. */
export function savingsLabel(name: string, s: BudgetStatus, currency: CurrencyCode, locale: string | undefined, hidden: boolean, movedOut: boolean): string {
  const amounts = hidden ? '' : `${spokenAmount(s.usedMinor, currency, locale)} of ${spokenAmount(s.targetMinor, currency, locale)}`;
  const line = savingsStatusLine(s, currency, locale, hidden).text;
  return [name, amounts, hidden ? daysText(s.daysRemaining) : line, movedOut ? copy.budgets.movedOut : ''].filter(Boolean).join(', ');
}

/** What TalkBack reads for the whole row: `Groceries, 3,400 of 4,000 rupees, 85% used, 12 days left`. Never the bar. */
export function limitBarLabel(name: string, s: BudgetStatus, currency: CurrencyCode, locale: string | undefined, hidden: boolean, dueText?: string): string {
  const b = copy.budgets;
  const amounts = hidden ? '' : `${spokenAmount(s.usedMinor, currency, locale)} of ${spokenAmount(s.targetMinor, currency, locale)}`;
  const status = s.status === 'exceeded' ? b.over.replace('{amount}', hidden ? 'amount hidden' : spokenAmount(s.usedMinor - s.targetMinor, currency, locale)) : s.status === 'insufficient-data' ? b.tooEarly : hidden ? '' : b.percentUsed.replace('{n}', String(s.percentUsed));
  const days = s.daysRemaining > 0 ? daysText(s.daysRemaining) : '';
  return [name, amounts, status, days, dueText].filter(Boolean).join(', ');
}

/**
 * The limit bar (UX-DR25): name left and `₹3,400 of ₹4,000` right (they wrap below each other at large text, never
 * truncated), an 8dp bar with a tick at the limit and a warning-colour overflow capped at 20%, and a status line below.
 * `hidden` keeps the track and the day text but draws no fill, no percentage and no amounts. One TalkBack node per row.
 */
export function LimitBar({
  name,
  status,
  currency,
  locale,
  hidden = false,
  dueText,
  caption,
  tone,
  savings = false,
  movedOut = false,
  testID,
}: {
  name: string;
  status: BudgetStatus;
  currency: CurrencyCode;
  locale?: string;
  hidden?: boolean;
  /** `Due in 2 days` for a bill (Epic 6). */
  dueText?: string;
  /** A small line under the status, e.g. `Also counted in your overall budget`. */
  caption?: string;
  /** Needs, Wants and Savings draw in their own colours with a thin outline on light surfaces (Story 4.11). */
  tone?: 'needs' | 'wants' | 'savings';
  /** A Savings bar: never a warning, no overflow, `Target reached` above the target. */
  savings?: boolean;
  /** Savings: more moved out of pots than in this period (the bar shows zero, never a minus). */
  movedOut?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const g = barGeometry(status.usedMinor, status.targetMinor);
  const line = savings ? savingsStatusLine(status, currency, locale, hidden) : statusLine(status, currency, locale, hidden);
  const outline = tone && theme.scheme === 'light' ? { borderWidth: 1, borderColor: theme.color('text-secondary') } : null;
  const warn = theme.color('semantic-warning');
  return (
    <View testID={testID} accessible accessibilityLabel={savings ? savingsLabel(name, status, currency, locale, hidden, movedOut) : limitBarLabel(name, status, currency, locale, hidden, dueText)} style={styles.row}>
      <View style={styles.head}>
        <Text style={[textStyle('body-medium'), styles.name, { color: theme.color('text-primary') }]}>{name}</Text>
        <Text testID={testID ? `${testID}-amounts` : undefined} style={[textStyle('caption'), styles.tnum, { color: theme.color('text-secondary') }]}>
          {copy.budgets.ofTarget.replace('{used}', moneyText(status.usedMinor, currency, locale, hidden)).replace('{target}', moneyText(status.targetMinor, currency, locale, hidden))}
        </Text>
      </View>
      <View style={styles.barBox}>
        <View testID={testID ? `${testID}-track` : undefined} style={[styles.track, { backgroundColor: theme.color('bg-muted') }, outline]}>
        {hidden ? null : (
          <>
            <View testID={testID ? `${testID}-fill` : undefined} style={[styles.fill, { width: `${g.fill * 100}%`, backgroundColor: theme.color(tone ?? 'accent-primary') }]} />
            {g.overflow > 0 && !savings ? <View testID={testID ? `${testID}-overflow` : undefined} style={[styles.overflow, { left: `${g.fill * 100}%`, width: `${g.overflow * 100}%`, backgroundColor: warn }]} /> : null}
          </>
        )}
        </View>
        <View style={[styles.tick, { left: `${g.tick * 100}%`, backgroundColor: theme.color('text-primary') }]} />
      </View>
      <View style={styles.statusRow}>
        {line.warning ? <Icon icon={Warning} size={16} color="semantic-warning" /> : null}
        <Text testID={testID ? `${testID}-status` : undefined} style={[textStyle('caption'), { color: line.warning ? warn : theme.color('text-secondary') }]}>
          {line.text}
        </Text>
        {dueText ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{` · ${dueText}`}</Text> : null}
      </View>
      {movedOut ? <Text testID={testID ? `${testID}-moved-out` : undefined} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.budgets.movedOut}</Text> : null}
      {caption ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6 },
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 12 },
  name: { flexShrink: 1 },
  tnum: { fontVariant: ['tabular-nums'], flexShrink: 0 },
  barBox: { height: 8 },
  track: { ...StyleSheet.absoluteFill, borderRadius: radii.sm, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  overflow: { position: 'absolute', top: 0, bottom: 0 },
  tick: { position: 'absolute', top: -3, width: 2, height: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
});
