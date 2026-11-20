import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import type { BudgetListRow, GoalRow } from '@wmbugo/core';
import { controlA11y } from '../../../shared/a11y/labels';
import { copy } from '../../../shared/copy';
import { Skeleton } from '../../../shared/feedback/Feedback';
import { useAmountsHidden } from '../../../shared/state/amountsHidden';
import { Icon } from '../../../shared/theme/Icon';
import type { ColorName } from '../../../shared/theme/colors';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { radii } from '../../../shared/theme/tokens';
import { textStyle } from '../../../shared/theme/typography';
import { Button } from '../../../shared/ui/Button';
import { LimitBar } from '../../../shared/ui/LimitBar';
import { moneyText } from '../../../shared/ui/moneyText';
import { categoryIcon } from '../../add/categoryIcons';
import { goalFill, paceLine } from '../../goals/GoalCard';
import { onTrackKey, type OnTrackData } from '../insightsApi';
import { useInsightsStore } from '../insightsStore';
import type { InsightsSection, InsightsSectionContext } from '../sectionRegistry';

const i = copy.insights;

function Failed({ id, onRetry }: { id: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View testID={id} accessibilityRole="alert" style={styles.gap}>
      <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{i.sectionError}</Text>
      <Button label={i.retry} variant="text" testID={`${id}-retry`} onPress={onRetry} />
    </View>
  );
}

function Card({ title, scope, caption, children, testID }: { title: string; scope: string; caption?: string | null; children: React.ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-primary') }]}>{title}</Text>
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{scope}</Text>
      {children}
      {caption ? <Text testID={`${testID}-caption`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{caption}</Text> : null}
    </View>
  );
}

const statusOf = (r: BudgetListRow, money: (n: number) => string): string => (r.status.status === 'exceeded' ? i.overBy.replace('{amount}', money(r.usedMinor - r.targetMinor)) : i.leftAmount.replace('{amount}', money(Math.max(0, r.targetMinor - r.usedMinor))));

/** One goal as a ring: the contributed share on a `bg-muted` track, the goal's icon in the centre, capped at a full ring. Not drawn while amounts are hidden. */
export function GoalRing({ goal, size = 72 }: { goal: GoalRow; size?: number }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  const fill = goalFill(goal);
  return (
    <View testID={`goal-ring-${goal.id}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={mid} cy={mid} r={r} stroke={theme.color('bg-muted')} strokeWidth={stroke} fill="none" />
        {hidden || fill <= 0 ? null : <Circle cx={mid} cy={mid} r={r} stroke={theme.color(goal.color as ColorName)} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c * fill} ${c}`} rotation={-90} origin={`${mid}, ${mid}`} />}
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <Icon icon={categoryIcon(goal.icon)} size={24} color={goal.color as ColorName} />
      </View>
    </View>
  );
}

function BudgetsCard({ d, ctx }: { d: OnTrackData; ctx: InsightsSectionContext }) {
  const theme = useTheme();
  useAmountsHidden();
  const [table, setTable] = useState(false);
  const t = d.track;
  const o = ctx.overview;
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  const filtered = o.filterChips.length > 0;
  if (t.budgetsState === 'not_budget_period') {
    const label = o.presets.includes('this_cycle') ? i.pickThisCycle : i.pickThisMonth;
    return (
      <Card title={i.budgetsTitle} scope={o.period.title} testID="budgets-card">
        <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{i.budgetsPickPeriod}</Text>
        <Button label={label} variant="text" testID="budgets-pick-period" onPress={() => useInsightsStore.getState().setPreset('default')} />
      </Card>
    );
  }
  if (t.budgets.length === 0) return null;
  const ink = { color: theme.color('text-primary') };
  return (
    <Card title={i.budgetsTitle} scope={o.period.title} caption={filtered ? i.ownScopeBudgets : null} testID="budgets-card">
      {table ? (
        <View testID="budgets-table" style={styles.gap}>
          <View accessible accessibilityRole="header" style={styles.row}>
            <Text style={[textStyle('label'), ink]}>{i.tableBudget}</Text>
            <Text style={[textStyle('label'), ink]}>{`${i.tableUsed} · ${i.tableTarget} · ${i.tableStatus}`}</Text>
          </View>
          {t.budgets.map((r) => (
            <Pressable key={r.id} testID={`budgets-row-${r.id}`} accessible accessibilityRole="button" accessibilityLabel={`${r.name}, ${money(r.usedMinor)} of ${money(r.targetMinor)}, ${statusOf(r, money)}`} onPress={() => ctx.nav?.onOpenBudget?.(r.id, r.period.start)} style={styles.row}>
              <Text style={[textStyle('body'), ink]}>{r.name}</Text>
              <Text style={[textStyle('body'), ink]}>{`${money(r.usedMinor)} · ${money(r.targetMinor)} · ${statusOf(r, money)}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        t.budgets.map((r) => (
          <Pressable key={r.id} testID={`budgets-row-${r.id}`} {...controlA11y({ label: `${r.name}, ${r.periodLabel}`, role: 'button' })} onPress={() => ctx.nav?.onOpenBudget?.(r.id, r.period.start)} style={styles.gap}>
            <LimitBar testID={`budgets-limit-${r.id}`} name={r.name} status={r.status} currency={d.currency} locale={d.locale} {...(r.group === 'categories' && r.overlapsOverall ? { caption: copy.budgets.alsoCounted } : {})} />
            {r.refundSurplusMinor > 0 ? <Text testID={`budgets-refunds-${r.id}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{i.refundsThisPeriod.replace('{amount}', money(r.refundSurplusMinor))}</Text> : null}
            {r.period.start !== o.period.start || r.period.end !== o.period.end ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{r.periodLabel}</Text> : null}
          </Pressable>
        ))
      )}
      <Button label={table ? copy.chart.viewAsChart : copy.chart.viewAsTable} variant="text" testID="budgets-toggle" onPress={() => setTable((v) => !v)} />
    </Card>
  );
}

function NwsCard({ d, ctx }: { d: OnTrackData; ctx: InsightsSectionContext }) {
  const theme = useTheme();
  useAmountsHidden();
  const [table, setTable] = useState(false);
  const nws = d.track.nws;
  const o = ctx.overview;
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  if (!nws || d.track.budgetsState === 'not_budget_period') return null;
  const a = nws.amounts;
  if (a.needsMinor + a.wantsMinor + a.savingsMinor + a.notClassifiedMinor === 0 && !nws.needs && !nws.wants && !nws.savings) return null;
  const ink = { color: theme.color('text-primary') };
  const hasTargets = nws.needs !== null || nws.wants !== null || nws.savings !== null;
  const rows: { key: 'needs' | 'wants' | 'savings'; label: string; amount: number; row: BudgetListRow | null }[] = [
    { key: 'needs', label: i.needsLabel, amount: a.needsMinor, row: nws.needs },
    { key: 'wants', label: i.wantsLabel, amount: a.wantsMinor, row: nws.wants },
    { key: 'savings', label: i.savingsLabel, amount: a.savingsMinor, row: nws.savings },
  ];
  const sortIt = () => ctx.nav?.onSortIt?.({ categoryIds: nws.notClassifiedCategoryIds, fromDate: nws.period.start, toDate: nws.period.end });
  return (
    <Card title={i.nwsTitle} scope={o.period.title} caption={o.filterChips.length > 0 ? i.ownScopeNws : null} testID="nws-card">
      {table ? (
        <View testID="nws-table" style={styles.gap}>
          <View accessible accessibilityRole="header" style={styles.row}>
            <Text style={[textStyle('label'), ink]}>{i.tableType}</Text>
            <Text style={[textStyle('label'), ink]}>{`${i.tableUsed} · ${i.tableTarget} · ${i.tablePercent}`}</Text>
          </View>
          {[...rows, { key: 'nc' as const, label: copy.insights.notClassifiedLabel, amount: a.notClassifiedMinor, row: null }].map((x) => (
            <View key={x.key} accessible accessibilityLabel={`${x.label}, ${money(x.amount)}${x.row ? ` of ${money(x.row.targetMinor)}, ${x.row.status.percentUsed} percent` : ''}`} style={styles.row}>
              <Text style={[textStyle('body'), ink]}>{x.label}</Text>
              <Text style={[textStyle('body'), ink]}>{`${money(x.amount)}${x.row ? ` · ${money(x.row.targetMinor)} · ${x.row.status.percentUsed}%` : ''}`}</Text>
            </View>
          ))}
        </View>
      ) : hasTargets ? (
        rows.map((x) =>
          x.row ? (
            <LimitBar key={x.key} testID={`nws-limit-${x.key}`} name={x.label} status={x.row.status} currency={d.currency} locale={d.locale} tone={x.key === 'savings' ? 'savings' : x.key} {...(x.key === 'savings' ? { savings: true } : {})} />
          ) : null,
        )
      ) : (
        <View testID="nws-amounts" style={styles.gap}>
          {rows.map((x) => (
            <View key={x.key} style={styles.row}>
              <Text style={[textStyle('body'), ink]}>{x.label}</Text>
              <Text style={[textStyle('body'), ink]}>{money(x.amount)}</Text>
            </View>
          ))}
          <Button label={i.noTargets} variant="text" testID="nws-try" onPress={() => ctx.nav?.onTryTemplate?.()} />
        </View>
      )}
      {a.notClassifiedMinor > 0 ? <Button label={i.notClassifiedSort.replace('{amount}', money(a.notClassifiedMinor))} variant="text" testID="nws-sort" onPress={sortIt} /> : null}
      <Button label={table ? copy.chart.viewAsChart : copy.chart.viewAsTable} variant="text" testID="nws-toggle" onPress={() => setTable((v) => !v)} />
    </Card>
  );
}

function GoalsCard({ d, ctx }: { d: OnTrackData; ctx: InsightsSectionContext }) {
  const theme = useTheme();
  useAmountsHidden();
  const [table, setTable] = useState(false);
  const goals = d.track.goals;
  const { fontScale } = useWindowDimensions();
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  if (goals.length === 0) return null;
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  return (
    <Card title={i.goalsTitle} scope={i.goalsScope} caption={ctx.overview.filterChips.length > 0 ? i.ownScopeGoals : null} testID="goals-card">
      {table ? (
        <View testID="goals-table" style={styles.gap}>
          <View accessible accessibilityRole="header" style={styles.row}>
            <Text style={[textStyle('label'), ink]}>{i.tableGoal}</Text>
            <Text style={[textStyle('label'), ink]}>{`${i.tableContributed} · ${i.tableTarget} · ${i.tableToGo}`}</Text>
          </View>
          {goals.map((g) => (
            <Pressable key={g.id} testID={`goals-row-${g.id}`} accessible accessibilityRole="button" accessibilityLabel={`${g.name}, ${money(g.contributedMinor)} of ${money(g.targetMinor)}, ${money(g.remainingMinor)} to go`} onPress={() => ctx.nav?.onOpenGoal?.(g.id)} style={styles.row}>
              <Text style={[textStyle('body'), ink]}>{g.name}</Text>
              <Text style={[textStyle('body'), ink]}>{`${money(g.contributedMinor)} · ${money(g.targetMinor)} · ${money(g.remainingMinor)}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.rings}>
          {goals.map((g) => {
            const pace = paceLine(g, d.thisMonth, money);
            return (
              <Pressable key={g.id} testID={`goals-ring-${g.id}`} {...controlA11y({ label: `${g.name}, ${money(g.contributedMinor)} of ${money(g.targetMinor)}`, role: 'button' })} onPress={() => ctx.nav?.onOpenGoal?.(g.id)} style={[styles.ringItem, { width: fontScale >= 1.3 ? '46%' : '30%' }]}>
                <GoalRing goal={g} />
                <Text style={[textStyle('body-medium'), ink]}>{g.name}</Text>
                <Text style={[textStyle('caption'), muted]}>{g.funded ? i.fullyFunded.replace('{name}', g.name) : i.ofTarget.replace('{amount}', money(g.contributedMinor)).replace('{target}', money(g.targetMinor))}</Text>
                {pace ? <Text style={[textStyle('caption'), muted]}>{pace}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}
      <Button label={table ? copy.chart.viewAsChart : copy.chart.viewAsTable} variant="text" testID="goals-toggle" onPress={() => setTable((v) => !v)} />
    </Card>
  );
}

function TrackBody({ ctx }: { ctx: InsightsSectionContext }) {
  const q = useQuery({ queryKey: onTrackKey(ctx.selection), queryFn: () => ctx.api.loadOnTrack(ctx.selection) });
  const d = q.data;
  if (q.isError) return <Failed id="track-error" onRetry={() => void q.refetch()} />;
  if (!d) return <Skeleton height={160} />;
  return (
    <View style={styles.gap}>
      <BudgetsCard d={d} ctx={ctx} />
      <NwsCard d={d} ctx={ctx} />
      <GoalsCard d={d} ctx={ctx} />
    </View>
  );
}

export const amIOnTrack: InsightsSection = {
  id: 'track',
  heading: i.trackHeading,
  order: 4,
  visible: () => true,
  render: (ctx) => <TrackBody ctx={ctx} />,
};

const styles = StyleSheet.create({
  gap: { gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40, gap: 8 },
  rings: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  ringItem: { flexGrow: 1, alignItems: 'center', gap: 4 },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
