import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { OTHER_SEGMENT_ID, type CategoryView, type DonutSegment, type DrillTarget } from '@wmbugo/core';
import { amountLabel } from '../../../shared/a11y/labels';
import { copy } from '../../../shared/copy';
import { Skeleton } from '../../../shared/feedback/Feedback';
import { useAmountsHidden } from '../../../shared/state/amountsHidden';
import { Icon } from '../../../shared/theme/Icon';
import type { ColorName } from '../../../shared/theme/colors';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { radii } from '../../../shared/theme/tokens';
import { textStyle } from '../../../shared/theme/typography';
import { BarChart, type BarDatum } from '../../../shared/ui/BarChart';
import { Button } from '../../../shared/ui/Button';
import { moneyText } from '../../../shared/ui/moneyText';
import { categoryIcon } from '../../add/categoryIcons';
import { categoriesKey, type CategoriesData } from '../insightsApi';
import type { InsightsSection, InsightsSectionContext } from '../sectionRegistry';

const i = copy.insights;

/** The 40dp icon chip of a category in its palette colour. */
function Chip40({ icon, colorToken }: { icon: string | null; colorToken: string }) {
  const theme = useTheme();
  return (
    <View importantForAccessibility="no" accessibilityElementsHidden style={[styles.chip, { backgroundColor: theme.color('bg-muted') }]}>
      <Icon icon={categoryIcon(icon ?? 'Tag')} size={22} color={colorToken as ColorName} />
    </View>
  );
}

/**
 * The donut: one segment per named category in its palette colour with a 2dp gap, `Other` in `bg-muted`, the count in the
 * centre. It is drawn on `bg-surface`, is one decorative node (the bars and table carry the information), and is not drawn at
 * all while amounts are hidden, because the segment sizes are the amounts.
 */
export function Donut({ view, size = 160 }: { view: CategoryView; size?: number }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const stroke = 24;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  const gap = view.donut.length > 1 ? 2 : 0;
  const total = view.donut.reduce((s, d) => s + d.amountMinor, 0);
  let offset = 0;
  const count = view.ranked.length;
  return (
    <View testID="where-donut" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.donutBox}>
      <Svg width={size} height={size}>
        <Circle cx={mid} cy={mid} r={r} stroke={theme.color('bg-muted')} strokeWidth={stroke} fill="none" />
        {!hidden && total > 0
          ? view.donut.map((d: DonutSegment) => {
              const len = (d.amountMinor / total) * c;
              const seg = Math.max(0, len - gap);
              const node = (
                <Circle key={d.id} cx={mid} cy={mid} r={r} stroke={d.id === OTHER_SEGMENT_ID ? theme.color('text-secondary') : theme.color(d.colorToken as ColorName)} strokeWidth={stroke} fill="none" strokeDasharray={`${seg} ${c}`} strokeDashoffset={-offset} rotation={-90} origin={`${mid}, ${mid}`} />
              );
              offset += len;
              return node;
            })
          : null}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[textStyle('label'), { color: theme.color('text-primary') }]}>{count === 1 ? i.donutCenterOne : i.donutCenter.replace('{n}', String(count))}</Text>
      </View>
    </View>
  );
}

/** The labels around the donut: each segment's name and share, in order. Shares are not shown while amounts are hidden. */
function DonutLabels({ view, onPick }: { view: CategoryView; onPick: (id: string) => void }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  return (
    <View testID="where-donut-labels" style={styles.labels}>
      {view.donut.map((d) => (
        <Pressable key={d.id} testID={`where-donut-label-${d.id}`} accessible accessibilityRole="button" onPress={() => onPick(d.id)} style={styles.labelRow}>
          <View style={[styles.swatch, { backgroundColor: d.id === OTHER_SEGMENT_ID ? theme.color('text-secondary') : theme.color(d.colorToken as ColorName), borderColor: theme.color('text-secondary') }]} />
          <Text style={[textStyle('caption'), { color: theme.color('text-primary') }]}>{`${d.id === OTHER_SEGMENT_ID ? i.otherCategories.replace('{n}', String(d.members?.length ?? 0)) : d.name}${hidden ? '' : ` · ${d.sharePercent}%`}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function WhereBody({ ctx }: { ctx: InsightsSectionContext }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const [table, setTable] = useState(false);
  const o = ctx.overview;
  const q = useQuery({ queryKey: categoriesKey(ctx.selection), queryFn: () => ctx.api.loadCategories(ctx.selection) });
  const d: CategoriesData | null | undefined = q.data;
  if (q.isError || q.data === null) {
    return (
      <View testID="where-error" accessibilityRole="alert" style={styles.gap}>
        <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{i.sectionError}</Text>
        <Button label={i.retry} variant="text" testID="where-retry" onPress={() => void q.refetch()} />
      </View>
    );
  }
  if (!d) return <Skeleton height={200} />;
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  const v = d.view;
  if (v.ranked.length === 0 && v.surplus.length === 0) {
    return <Text testID="where-empty" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{i.nothingSpent.replace('{range}', o.period.title)}</Text>;
  }

  const bars: BarDatum[] = [
    ...v.ranked.map<BarDatum>((r) => ({ id: r.categoryId, label: r.name, valueMinor: r.displayMinor, sharePercent: r.sharePercent, leading: <Chip40 icon={r.icon} colorToken={r.colorToken} /> })),
    ...v.surplus.map<BarDatum>((s) => ({ id: s.categoryId, label: `${s.name} · ${i.back.replace('{amount}', money(s.backMinor))}`, valueMinor: 0, leading: <Chip40 icon={s.icon} colorToken={s.colorToken} />, spokenLabel: hidden ? s.name : `${s.name}, ${i.back.replace('{amount}', amountLabel({ amountMinor: s.backMinor, currency: d.currency, locale: d.locale, inline: true }))}` })),
  ];
  const back = d.total.backMinor;
  const totalLine = d.total.spentMinor === 0 && back > 0 ? i.totalBackOnly.replace('{back}', money(back)) : back > 0 ? i.totalSpentAfter.replace('{amount}', money(d.total.spentMinor)).replace('{back}', money(back)) : i.totalSpent.replace('{amount}', money(d.total.spentMinor));
  const top = v.ranked[0];
  const summary = top && !hidden
    ? i.donutSummary.replace('{range}', o.period.title).replace('{n}', String(v.ranked.length)).replace('{name}', top.name).replace('{amount}', amountLabel({ amountMinor: top.displayMinor, currency: d.currency, locale: d.locale, inline: true }))
    : i.donutSummaryHidden.replace('{range}', o.period.title).replace('{n}', String(v.ranked.length));

  const drill = (id: string) => {
    if (!ctx.onDrill) return;
    if (id === OTHER_SEGMENT_ID) {
      const other = v.donut.find((x) => x.id === OTHER_SEGMENT_ID);
      const ids = other?.members?.map((m) => m.categoryId) ?? [];
      ctx.onDrill({ kind: 'categories', ids, name: i.otherCategories.replace('{n}', String(ids.length)) } satisfies DrillTarget);
      return;
    }
    const row = [...v.ranked, ...v.surplus].find((r) => r.categoryId === id);
    if (row) ctx.onDrill({ kind: 'category', id, name: row.name } satisfies DrillTarget);
  };

  return (
    <View testID="where-section" accessible={false} style={styles.gap}>
      {table ? null : (
        <View accessible accessibilityLabel={summary} style={styles.donutRow}>
          <Donut view={v} />
          <DonutLabels view={v} onPick={drill} />
        </View>
      )}
      <BarChart testID="where-chart" title={i.spentByCategoryTitle} scope={o.period.title} showShareInBars data={bars} currency={d.currency} locale={d.locale} orientation="horizontal" table={table} onToggleTable={() => setTable((t) => !t)} onPressDatum={(b) => drill(b.id)} nameColumn={i.categoryColumn} />
      <Text testID="where-total" style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{totalLine}</Text>
    </View>
  );
}

export const whereDidItGo: InsightsSection = {
  id: 'where',
  heading: i.whereHeading,
  order: 1,
  visible: () => true,
  render: (ctx) => <WhereBody ctx={ctx} />,
};

const styles = StyleSheet.create({
  gap: { gap: 12 },
  chip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  donutBox: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  donutRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  labels: { flexShrink: 1, gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 14, height: 14, borderRadius: radii.sm, borderWidth: 1 },
});
