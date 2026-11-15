import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ArrowsLeftRight, BookmarkSimple } from 'phosphor-react-native';
import { dayMonthLabel, type CurrencyCode, type GoalAllocationRow, type GoalRow } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { moneyText } from '../../shared/ui/moneyText';
import { TopBar } from '../../shared/ui/TopBar';
import { GoalCard } from './GoalCard';
import { goalDetailKey, realGoalsApi, type GoalsApi } from './goalsApi';
import { useGoalActions } from './useGoalActions';

const g = copy.goals;

/** `Set aside` (bookmark icon) and `Moved to savings` (transfer icon) are never confused (GOAL-002); a take back has no minus sign. */
const historyText = (a: GoalAllocationRow, currency: CurrencyCode, locale: string): string => {
  const amount = moneyText(a.amountMinor, currency, locale);
  const date = dayMonthLabel(a.localDate);
  const t = a.kind === 'set_aside' ? g.histSetAside : a.kind === 'taken_back' ? g.histTakenBack : g.histMoved;
  return t.replace('{amount}', amount).replace('{date}', date);
};

/** A goal's detail (Story 6.6): the card, the history of every contribution and Set aside, Take back, Edit, Pause, Mark complete and Archive. */
export function GoalDetailScreen({ goalId, onBack, onMove, onAddPot, api = realGoalsApi }: { goalId: string; onBack: () => void; /** Opens the Add sheet as a transfer into the goal's savings pot, for this goal. */ onMove?: (goal: GoalRow, potId: string) => void; /** No savings pot yet: goes to add one. */ onAddPot?: () => void; api?: GoalsApi }) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: the history builds amount text
  const theme = useTheme();
  const q = useQuery({ queryKey: goalDetailKey(goalId), queryFn: () => api.loadDetail(goalId) });
  const display = q.data && q.data !== 'missing' ? q.data : { currency: 'INR' as const, locale: 'en-IN', exponent: 2 };
  const actions = useGoalActions(api, display);
  const header = <TopBar title={g.detailTitle} onBack={onBack} backTestID="goal-detail-back" />;

  if (q.isError) return <View style={styles.fill}>{header}<ErrorBlock cause={g.loadError} onRetry={() => void q.refetch()} /></View>;
  if (q.data === 'missing') return <View style={styles.fill}>{header}<EmptyState sentence={g.deletedElsewhere} actionLabel={g.backToGoals} onAction={onBack} /></View>;
  if (!q.data) {
    return (
      <View style={styles.fill} testID="goal-detail-loading">
        {header}
        <View style={styles.pad}>
          <Skeleton height={96} />
        </View>
      </View>
    );
  }
  const data = q.data;
  const goal = data.detail.goal;
  const muted = { color: theme.color('text-secondary') };
  const ink = { color: theme.color('text-primary') };
  const active = goal.state === 'active';
  const live = active || goal.state === 'paused';
  const pots = data.accounts.filter((a) => a.isPot);
  // The goal's own savings pot when it has one, otherwise the first pot.
  const pot = pots.find((p) => p.id === goal.accountId) ?? pots[0] ?? null;

  return (
    <View style={styles.fill} testID="goal-detail">
      {header}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <GoalCard goal={goal} currency={data.currency} locale={data.locale} thisMonth={data.thisMonth} onPress={() => undefined} {...(active && goal.funded ? { onComplete: () => actions.confirmComplete(goal) } : {})} />

        <Text accessibilityRole="header" style={[textStyle('label'), muted]}>{g.historyHeading}</Text>
        {data.detail.allocations.length === 0 ? (
          <Text testID="goal-history-empty" style={[textStyle('body'), muted]}>{g.historyNone}</Text>
        ) : (
          <View testID="goal-history" style={styles.gap}>
            {data.detail.allocations.map((a) => (
              <View key={a.id} testID={`goal-history-${a.id}`} style={styles.histRow}>
                <Icon icon={a.kind === 'moved' ? ArrowsLeftRight : BookmarkSimple} size={18} color="text-secondary" />
                <Text style={[textStyle('body'), ink, styles.histText]}>{historyText(a, data.currency, data.locale)}</Text>
                <Text testID={`goal-tag-${a.id}`} style={[textStyle('caption'), muted]}>{a.kind === 'moved' ? g.tagMoved : g.tagSetAside}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.actions}>
          {active && pot && onMove ? <Button label={g.moveToSavings} testID="goal-detail-move" onPress={() => onMove(goal, pot.id)} /> : null}
          {active && !pot && onAddPot ? <Button label={g.addPotFirst} variant="secondary" testID="goal-detail-add-pot" onPress={onAddPot} /> : null}
          {active ? <Button label={g.setAside} variant={pot && onMove ? 'secondary' : 'primary'} testID="goal-detail-set-aside" onPress={() => actions.openAmount(goal, 'set_aside')} /> : null}
          {live && goal.setAsideMinor > 0 ? <Button label={g.takeBack} variant="secondary" testID="goal-detail-take-back" onPress={() => actions.openAmount(goal, 'take_back')} /> : null}
          <Button label={g.edit} variant="secondary" testID="goal-detail-edit" onPress={() => actions.openEditor(goal, data.accounts, data.thisMonth)} />
          {active ? <Button label={g.pause} variant="secondary" testID="goal-detail-pause" onPress={() => void actions.change(goal, 'paused')} /> : null}
          {goal.state === 'paused' ? <Button label={g.resume} variant="secondary" testID="goal-detail-resume" onPress={() => void actions.change(goal, 'active')} /> : null}
          {live ? <Button label={g.markComplete} variant="text" testID="goal-detail-complete" onPress={() => actions.confirmComplete(goal)} /> : null}
          {live ? <Button label={g.archive} variant="text" testID="goal-detail-archive" onPress={() => actions.confirmArchive(goal)} /> : null}
          {goal.state === 'completed' || goal.state === 'archived' ? <Button label={g.restore} variant="secondary" testID="goal-detail-restore" onPress={() => void actions.change(goal, 'active')} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12, paddingBottom: 120 },
  gap: { gap: 8 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  histText: { flex: 1 },
  actions: { gap: 8, marginTop: 8 },
});
