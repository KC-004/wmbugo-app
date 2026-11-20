import { Pressable, StyleSheet, Text, View } from 'react-native';
import { monthName, type CurrencyCode, type GoalRow } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { PaperBoat } from '../../shared/brand/PaperBoat';
import { copy } from '../../shared/copy';
import { useAmountsHidden, isAmountsHidden } from '../../shared/state/amountsHidden';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { moneyText } from '../../shared/ui/moneyText';
import { categoryIcon } from '../add/categoryIcons';

const g = copy.goals;

/** `Mar 2027` from the first day of the month a goal is by. */
export const dueLabel = (dueDate: string): string => `${monthName(dueDate).slice(0, 3)} ${dueDate.slice(0, 4)}`;

const monthLabel = (month: string): string => dueLabel(`${month}-01`);

/**
 * The pace line of an active goal (GOAL-003): an honest `Not enough history for a pace yet` until there is a pace, then
 * `About 5,000 a month · done by Mar 2027`, or with a date `On track for Mar 2027` / `At this pace, done by Jun 2027` in
 * neutral text. A passed date reads `Your date has passed · 5,000 to go`, never alarm wording. Paused, funded and finished
 * goals show none.
 */
export function paceLine(goal: GoalRow, thisMonth: string, money: (n: number) => string): string | null {
  if (goal.state !== 'active' || goal.funded) return null;
  const dueMonth = goal.dueDate ? goal.dueDate.slice(0, 7) : null;
  if (dueMonth !== null && dueMonth < thisMonth) return g.paceDatePassed.replace('{amount}', money(goal.remainingMinor));
  const pace = goal.progress?.pace;
  if (!pace) return g.paceNoHistory;
  if (dueMonth === null) return g.paceMonthly.replace('{amount}', money(pace.monthlyMinor)).replace('{date}', monthLabel(pace.projectedMonth));
  return pace.projectedMonth <= dueMonth ? g.paceOnTrack.replace('{date}', monthLabel(dueMonth)) : g.paceAtThis.replace('{date}', monthLabel(pace.projectedMonth));
}

/** The goal's fill, 0 to 1. It never overflows: a funded goal is a full bar (UX-DR25, no overflow). */
export const goalFill = (goal: Pick<GoalRow, 'contributedMinor' | 'targetMinor'>): number => (goal.targetMinor <= 0 ? 0 : Math.min(1, Math.max(0, goal.contributedMinor / goal.targetMinor)));

/**
 * One goal (Story 6.6): its icon chip in its colour, the name, a progress bar, `₹5,000 of ₹30,000` and `₹25,000 to go · by Mar
 * 2027`. When amounts are hidden the bar is not drawn and every amount is masked. A funded goal shows the boat relief moment
 * with `Mark complete`, no confetti and no exclamation mark. The card is one TalkBack node.
 */
export function GoalCard({ goal, currency, locale, thisMonth, onPress, onComplete, bare = false }: { goal: GoalRow; /** Drawn inside another card (Home's Savings goal): no outline or fill of its own. */ bare?: boolean; currency: CurrencyCode; locale: string; /** The profile's current month (YYYY-MM), to tell a passed date. */ thisMonth?: string; /** Without it the card is a plain summary, not a button (a goal's own detail screen). */ onPress?: () => void; onComplete?: () => void }) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: this component builds amount text and labels
  const theme = useTheme();
  const hidden = isAmountsHidden();
  const money = (n: number) => moneyText(n, currency, locale);
  const due = goal.dueDate ? dueLabel(goal.dueDate) : null;
  const toGo = due ? g.toGoBy.replace('{amount}', money(goal.remainingMinor)).replace('{date}', due) : g.toGo.replace('{amount}', money(goal.remainingMinor));
  const spoken = hidden
    ? g.spokenHidden.replace('{name}', goal.name)
    : (due ? g.spokenGoal : g.spokenGoalNoDate)
        .replace('{name}', goal.name)
        .replace('{amount}', amountLabel({ amountMinor: goal.contributedMinor, currency, locale, inline: true }))
        .replace('{target}', amountLabel({ amountMinor: goal.targetMinor, currency, locale, inline: true }))
        .replace('{togo}', amountLabel({ amountMinor: goal.remainingMinor, currency, locale, inline: true }))
        .replace('{date}', due ?? '');
  const pace = thisMonth ? paceLine(goal, thisMonth, money) : null;
  const colour = goal.color as ColorName;
  const stateTag = goal.state === 'paused' ? g.paused : goal.state === 'completed' ? g.completed : goal.state === 'archived' ? g.archived : null;
  return (
    <View style={bare ? styles.bare : [styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Pressable testID={`goal-card-${goal.id}`} accessible {...(onPress ? { accessibilityRole: 'button' as const } : {})} accessibilityLabel={[spoken, stateTag].filter(Boolean).join(', ')} {...(onPress ? { onPress } : { disabled: true })} style={styles.row}>
        <View style={[styles.chip, { backgroundColor: theme.color('bg-muted') }]}>
          <Icon icon={categoryIcon(goal.icon)} size={22} color={colour} />
        </View>
        <View style={styles.body}>
          <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{goal.name}</Text>
          {hidden ? null : (
            <View testID={`goal-bar-${goal.id}`} style={[styles.track, { backgroundColor: theme.color('bg-muted') }]}>
              <View style={[styles.fill, { width: `${Math.round(goalFill(goal) * 100)}%`, backgroundColor: theme.color(colour) }]} />
            </View>
          )}
          <Text testID={`goal-of-${goal.id}`} style={[textStyle('caption'), { color: theme.color('text-primary') }]}>{g.ofTarget.replace('{amount}', money(goal.contributedMinor)).replace('{target}', money(goal.targetMinor))}</Text>
          <Text testID={`goal-status-${goal.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{goal.funded ? '' : toGo}</Text>
          {pace ? <Text testID={`goal-pace-${goal.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{pace}</Text> : null}
          {goal.setAsideMinor > 0 ? <Text testID={`goal-aside-${goal.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{g.setAsideLine.replace('{amount}', money(goal.setAsideMinor))}</Text> : null}
          {goal.movedMinor > 0 ? <Text testID={`goal-moved-${goal.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{g.movedLine.replace('{amount}', money(goal.movedMinor))}</Text> : null}
          {stateTag ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{stateTag}</Text> : null}
        </View>
      </Pressable>
      {goal.funded && goal.state === 'active' ? (
        <View testID={`goal-funded-${goal.id}`} style={styles.relief}>
          <PaperBoat size={48} />
          <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{g.funded.replace('{name}', goal.name)}</Text>
          {onComplete ? <Button label={g.markComplete} variant="text" testID={`goal-complete-${goal.id}`} onPress={onComplete} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bare: { overflow: 'hidden' },
  card: { borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 12, padding: 12, minHeight: 72 },
  chip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  relief: { alignItems: 'center', gap: 4, paddingBottom: 12 },
});
