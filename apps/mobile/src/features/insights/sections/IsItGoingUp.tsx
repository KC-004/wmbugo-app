import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polygon, Polyline } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { ArrowUUpLeft } from 'phosphor-react-native';
import type { Granularity, InOutPeriod, TrendBucket } from '@wmbugo/core';
import { amountLabel } from '../../../shared/a11y/labels';
import { copy } from '../../../shared/copy';
import { Skeleton } from '../../../shared/feedback/Feedback';
import { useAmountsHidden } from '../../../shared/state/amountsHidden';
import { Icon } from '../../../shared/theme/Icon';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { radii } from '../../../shared/theme/tokens';
import { textStyle } from '../../../shared/theme/typography';
import { Button } from '../../../shared/ui/Button';
import { Chip } from '../../../shared/ui/Chip';
import { moneyText } from '../../../shared/ui/moneyText';
import { inOutKey, trendKey } from '../insightsApi';
import type { InsightsSection, InsightsSectionContext } from '../sectionRegistry';

const i = copy.insights;
const SEG: Record<Granularity, string> = { day: i.segDay, week: i.segWeek, month: i.segMonth };
// `Spent per day`: the unit word is the segment label in lower case, so it is written once.
const UNIT: Record<Granularity, string> = { day: i.segDay.toLowerCase(), week: i.segWeek.toLowerCase(), month: i.segMonth.toLowerCase() };

function Failed({ id, onRetry }: { id: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View testID={id} accessibilityRole="alert" style={styles.gap}>
      <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{i.sectionError}</Text>
      <Button label={i.retry} variant="text" testID={`${id}-retry`} onPress={onRetry} />
    </View>
  );
}

function Card({ title, children, testID }: { title: string; children: React.ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-primary') }]}>{title}</Text>
      {children}
    </View>
  );
}

const W = 300;
const H = 120;

/** The line and its soft area, drawn on `bg-surface`. A refund-surplus bucket is plotted at zero. Not drawn while amounts are hidden. */
function Line({ buckets }: { buckets: readonly TrendBucket[] }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const max = Math.max(1, ...buckets.map((b) => b.spentMinor));
  const x = (idx: number) => (buckets.length === 1 ? W / 2 : (idx / (buckets.length - 1)) * (W - 16) + 8);
  const y = (v: number) => H - 12 - (v / max) * (H - 28);
  const pts = buckets.map((b, idx) => `${x(idx)},${y(b.spentMinor)}`).join(' ');
  const accent = theme.color('accent-primary');
  return (
    <View testID="trend-line" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {hidden ? null : <Polygon points={`${x(0)},${H - 12} ${pts} ${x(buckets.length - 1)},${H - 12}`} fill={accent} fillOpacity={0.16} />}
        {hidden ? null : <Polyline points={pts} fill="none" stroke={accent} strokeWidth={2} />}
        {hidden
          ? null
          : buckets.map((b, idx) => ((b.spentMinor === max && b.spentMinor > 0) ? <Circle key={b.start} cx={x(idx)} cy={y(b.spentMinor)} r={4} fill={accent} /> : null))}
      </Svg>
    </View>
  );
}

function Trend({ ctx }: { ctx: InsightsSectionContext }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const [g, setG] = useState<Granularity | undefined>(undefined);
  const [table, setTable] = useState(false);
  const q = useQuery({ queryKey: trendKey(ctx.selection, g), queryFn: () => ctx.api.loadTrend(ctx.selection, g) });
  const d = q.data;
  // After a period or filter change the scope may not offer the granularity chosen before: fall back to its default.
  useEffect(() => {
    if (g && d && !d.trend.options.includes(g)) setG(undefined);
  }, [g, d]);
  if (q.isError || q.data === null) return <Failed id="trend-error" onRetry={() => void q.refetch()} />;
  if (!d) return <Skeleton height={160} />;
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  const t = d.trend;
  const muted = { color: theme.color('text-secondary') };
  const ink = { color: theme.color('text-primary') };
  const scope = i.trendScope.replace('{unit}', UNIT[t.granularity]).replace('{range}', ctx.overview.period.title);
  const showing = (b: TrendBucket) => (b.backMinor > 0 && b.spentMinor === 0 ? i.back.replace('{amount}', money(b.backMinor)) : money(b.spentMinor));
  const drill = (b: TrendBucket) => ctx.onDrill?.({ kind: 'bucket', start: b.start, end: b.end, label: b.label });

  if (t.buckets.length < 2) {
    return (
      <View testID="trend-empty" style={styles.gap}>
        <Text style={[textStyle('caption'), muted]}>{scope}</Text>
        <Text style={[textStyle('title'), ink]}>{i.noBaseline}</Text>
        <Text style={[textStyle('caption'), muted]}>{i.trendNeed}</Text>
      </View>
    );
  }
  const top = t.buckets.reduce((m, b) => (b.spentMinor > m.spentMinor ? b : m), t.buckets[0]!);
  const today = t.buckets.find((b) => b.start === t.todayStart);
  const summary = hidden || top.spentMinor === 0 ? i.trendSummaryHidden.replace('{unit}', UNIT[t.granularity]).replace('{range}', ctx.overview.period.title) : i.trendSummary.replace('{unit}', UNIT[t.granularity]).replace('{range}', ctx.overview.period.title).replace('{label}', top.label).replace('{amount}', amountLabel({ amountMinor: top.spentMinor, currency: d.currency, locale: d.locale, inline: true }));
  const first = t.buckets[0]!;
  const last = t.buckets.at(-1)!;

  return (
    <View testID="trend-body" style={styles.gap}>
      <Text style={[textStyle('caption'), muted]}>{scope}</Text>
      {t.options.length > 1 ? (
        <View testID="trend-seg" accessibilityRole="radiogroup" style={styles.seg}>
          {t.options.map((o) => (
            <Chip key={o} role="radio" variant="period" label={SEG[o]} testID={`trend-seg-${o}`} selected={o === t.granularity} onPress={() => setG(o)} />
          ))}
        </View>
      ) : null}
      {table ? (
        <View testID="trend-table" style={styles.gap}>
          <View accessible accessibilityRole="header" style={styles.row}>
            <Text style={[textStyle('label'), ink]}>{i.tableDate}</Text>
            <Text style={[textStyle('label'), ink]}>{i.tableSpent}</Text>
          </View>
          {t.buckets.map((b) => (
            <Pressable key={b.start} testID={`trend-row-${b.start}`} accessible accessibilityRole="button" accessibilityLabel={`${b.label}, ${showing(b)}`} onPress={() => drill(b)} style={styles.row}>
              <Text style={[textStyle('body'), ink]}>{b.label}</Text>
              <Text style={[textStyle('body'), ink]}>{showing(b)}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View accessible accessibilityLabel={summary}>
          <View>
            <Line buckets={t.buckets} />
            <View style={styles.overlay} pointerEvents="box-none">
              {t.buckets.map((b) => (
                <Pressable key={b.start} testID={`trend-point-${b.start}`} accessible={false} onPress={() => drill(b)} style={styles.hit} />
              ))}
            </View>
          </View>
          <View style={styles.axis}>
            <Text style={[textStyle('caption'), muted]}>{first.label}</Text>
            <Text style={[textStyle('caption'), muted]}>{last.label}</Text>
          </View>
          {top.spentMinor > 0 ? <Text testID="trend-highest" style={[textStyle('caption'), ink]}>{i.highestPoint.replace('{label}', top.label).replace('{amount}', showing(top))}</Text> : null}
          {today && today.start !== top.start ? <Text testID="trend-today" style={[textStyle('caption'), ink]}>{i.todayPoint.replace('{amount}', showing(today))}</Text> : null}
          {t.buckets.some((b) => b.backMinor > 0 && b.spentMinor === 0) ? <Icon icon={ArrowUUpLeft} size={14} color="semantic-income" /> : null}
        </View>
      )}
      <Button label={table ? copy.chart.viewAsChart : copy.chart.viewAsTable} variant="text" testID="trend-toggle" onPress={() => setTable((v) => !v)} />
    </View>
  );
}

/** One group of two bars, In and Out, with its net underneath. Bars are not drawn while amounts are hidden. */
function Group({ p, max, money, onIn, onOut }: { p: InOutPeriod; max: number; money: (n: number) => string; onIn: () => void; onOut: () => void }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const h = (v: number) => (v <= 0 ? 0 : Math.max(4, Math.round((v / max) * 80)));
  const net = p.net === 'kept' ? i.netKept.replace('{amount}', money(p.netMinor)) : p.net === 'short' ? i.netShort.replace('{amount}', money(p.netMinor)) : i.netEven.replace('{amount}', money(0));
  const out = p.backMinor > 0 && p.spentMinor === 0 ? i.back.replace('{amount}', money(p.backMinor)) : money(p.spentMinor);
  return (
    <View testID={`inout-group-${p.start}`} style={styles.group}>
      <View style={styles.bars}>
        <Pressable testID={`inout-in-${p.start}`} accessible accessibilityRole="button" accessibilityLabel={`${p.label}, ${i.inLabel}`} onPress={onIn} style={styles.barCol}>
          <Text style={[textStyle('caption'), { color: theme.color('semantic-income') }]}>{`+${money(p.incomeMinor)}`}</Text>
          {hidden ? <View style={{ height: 0 }} /> : <View testID={`inout-in-fill-${p.start}`} style={[styles.bar, { height: h(p.incomeMinor), backgroundColor: theme.color('semantic-income') }]} />}
        </Pressable>
        <Pressable testID={`inout-out-${p.start}`} accessible accessibilityRole="button" accessibilityLabel={`${p.label}, ${i.outLabel}`} onPress={onOut} style={styles.barCol}>
          <Text style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>{out}</Text>
          {hidden ? <View style={{ height: 0 }} /> : <View testID={`inout-out-fill-${p.start}`} style={[styles.bar, { height: h(p.spentMinor), backgroundColor: theme.color('semantic-expense') }]} />}
        </Pressable>
      </View>
      <Text style={[textStyle('label'), { color: theme.color('text-primary') }]}>{p.label}</Text>
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{net}</Text>
    </View>
  );
}

function InOut({ ctx }: { ctx: InsightsSectionContext }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const [table, setTable] = useState(false);
  const q = useQuery({ queryKey: inOutKey(ctx.selection), queryFn: () => ctx.api.loadInOut(ctx.selection) });
  const d = q.data;
  if (q.isError || q.data === null) return <Failed id="inout-error" onRetry={() => void q.refetch()} />;
  if (!d) return <Skeleton height={160} />;
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  const ps = d.inOut.periods;
  const max = Math.max(1, ...ps.flatMap((p) => [p.incomeMinor, p.spentMinor]));
  const muted = { color: theme.color('text-secondary') };
  const ink = { color: theme.color('text-primary') };
  const dirOf = (p: InOutPeriod) => (p.net === 'kept' ? 'kept' : p.net === 'short' ? 'out' : 'even');
  const spoken = (p: InOutPeriod) => (hidden ? i.inOutSummaryHidden.replace('{label}', p.label) : i.inOutSummary.replace('{label}', p.label).replace('{inAmount}', amountLabel({ amountMinor: p.incomeMinor, currency: d.currency, locale: d.locale, inline: true })).replace('{outAmount}', amountLabel({ amountMinor: p.spentMinor, currency: d.currency, locale: d.locale, inline: true })).replace('{netAmount}', amountLabel({ amountMinor: p.netMinor, currency: d.currency, locale: d.locale, inline: true })).replace('{dir}', dirOf(p)));
  const drillIn = (p: InOutPeriod) => ctx.onDrill?.({ kind: 'bucket', start: p.start, end: p.end, label: p.label, income: true });
  const drillOut = (p: InOutPeriod) => ctx.onDrill?.({ kind: 'bucket', start: p.start, end: p.end, label: p.label });

  return (
    <View testID="inout-body" style={styles.gap}>
      <Text style={[textStyle('caption'), muted]}>{i.inOutScope.replace('{range}', ctx.overview.period.title)}</Text>
      <View style={styles.legend}>
        <Text style={[textStyle('caption'), { color: theme.color('semantic-income') }]}>{i.inLabel}</Text>
        <Text style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>{i.outLabel}</Text>
      </View>
      {table ? (
        <View testID="inout-table" style={styles.gap}>
          <View accessible accessibilityRole="header" style={styles.row}>
            <Text style={[textStyle('label'), ink]}>{i.tablePeriod}</Text>
            <Text style={[textStyle('label'), ink]}>{`${i.inLabel} · ${i.outLabel} · ${i.tableNet}`}</Text>
          </View>
          {ps.map((p) => (
            <Pressable key={p.start} testID={`inout-row-${p.start}`} accessible accessibilityRole="button" accessibilityLabel={spoken(p)} onPress={() => drillOut(p)} style={styles.row}>
              <Text style={[textStyle('body'), ink]}>{p.label}</Text>
              <Text style={[textStyle('body'), ink]}>{`${money(p.incomeMinor)} · ${money(p.spentMinor)} · ${money(p.netMinor)}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.groups}>
          {ps.map((p) => (
            <Group key={p.start} p={p} max={max} money={money} onIn={() => drillIn(p)} onOut={() => drillOut(p)} />
          ))}
        </View>
      )}
      {ps.length === 1 ? <Text testID="inout-earlier" style={[textStyle('caption'), muted]}>{i.earlierPeriods}</Text> : null}
      <Button label={table ? copy.chart.viewAsChart : copy.chart.viewAsTable} variant="text" testID="inout-toggle" onPress={() => setTable((v) => !v)} />
    </View>
  );
}

export const isItGoingUp: InsightsSection = {
  id: 'goingUp',
  heading: i.goingUpHeading,
  order: 2,
  visible: () => true,
  render: (ctx) => (
    <View style={styles.gap}>
      <Card title={i.spendingOverTime} testID="trend-card">
        <Trend ctx={ctx} />
      </Card>
      <Card title={i.moneyInOut} testID="inout-card">
        <InOut ctx={ctx} />
      </Card>
    </View>
  ),
};

const styles = StyleSheet.create({
  gap: { gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40, gap: 8 },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row' },
  hit: { flex: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  group: { alignItems: 'center', gap: 4, minWidth: 96 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, minHeight: 112 },
  barCol: { alignItems: 'center', justifyContent: 'flex-end', gap: 4, minWidth: 44 },
  bar: { width: 28, borderRadius: radii.sm },
  legend: { flexDirection: 'row', gap: 12 },
});
