import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CaretRight } from 'phosphor-react-native';
import type { GoalRow } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { TopBar } from '../../shared/ui/TopBar';
import { GoalCard } from './GoalCard';
import { GOALS_QUERY_KEY, realGoalsApi, type GoalsApi } from './goalsApi';
import { useGoalActions } from './useGoalActions';

const g = copy.goals;

/**
 * SCR-17 Goals (Story 6.6): active and paused goals first, then Done and Archived collapsed at the bottom. A goal is a plan:
 * nothing here moves money. Reached from Plan.
 */
export function GoalsScreen({ api = realGoalsApi, onBack, onOpenGoal }: { api?: GoalsApi; onBack: () => void; onOpenGoal: (id: string) => void }) {
  const theme = useTheme();
  const q = useQuery({ queryKey: GOALS_QUERY_KEY, queryFn: () => api.load() });
  const [open, setOpen] = useState<{ done: boolean; archived: boolean }>({ done: false, archived: false });
  const display = q.data ?? { currency: 'INR' as const, locale: 'en-IN', exponent: 2 };
  const actions = useGoalActions(api, display);
  const header = <TopBar title={g.title} onBack={onBack} backTestID="goals-back" />;

  if (q.isError) return <View style={styles.fill}>{header}<ErrorBlock cause={g.loadError} onRetry={() => void q.refetch()} /></View>;
  if (!q.data) {
    return (
      <View style={styles.fill} testID="goals-loading">
        {header}
        <View style={styles.pad}>
          <Skeleton height={96} />
        </View>
      </View>
    );
  }
  const data = q.data;
  const add = () => actions.openEditor(null, data.accounts, data.thisMonth);
  if (data.goals.length === 0) {
    return (
      <View style={styles.fill} testID="goals-empty">
        {header}
        <EmptyState sentence={g.empty} actionLabel={g.add} onAction={add} />
      </View>
    );
  }
  const live = data.goals.filter((x) => x.state === 'active' || x.state === 'paused');
  const done = data.goals.filter((x) => x.state === 'completed');
  const archived = data.goals.filter((x) => x.state === 'archived');
  const card = (x: GoalRow) => <GoalCard key={x.id} goal={x} currency={data.currency} locale={data.locale} thisMonth={data.thisMonth} onPress={() => onOpenGoal(x.id)} {...(x.state === 'active' && x.funded ? { onComplete: () => actions.confirmComplete(x) } : {})} />;
  const group = (key: 'done' | 'archived', title: string, rows: readonly GoalRow[]) =>
    rows.length === 0 ? null : (
      <View key={key} testID={`goals-group-${key}`} style={styles.group}>
        <Pressable testID={`goals-toggle-${key}`} {...controlA11y({ label: `${title}, ${rows.length}`, role: 'button', selected: open[key] })} onPress={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} style={styles.toggle}>
          <Icon icon={open[key] ? CaretDown : CaretRight} size={18} color="text-secondary" />
          <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{`${title} (${rows.length})`}</Text>
        </Pressable>
        {open[key] ? rows.map(card) : null}
      </View>
    );
  return (
    <View style={styles.fill} testID="goals-screen">
      {header}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Button label={g.add} variant="secondary" testID="goals-add" onPress={add} />
        {live.map(card)}
        {group('done', g.groupDone, done)}
        {group('archived', g.groupArchived, archived)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12, paddingBottom: 120 },
  group: { gap: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
});
