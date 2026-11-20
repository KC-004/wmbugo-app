import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { MerchantSpend } from '@wmbugo/core';
import { amountLabel } from '../../../shared/a11y/labels';
import { copy } from '../../../shared/copy';
import { Skeleton } from '../../../shared/feedback/Feedback';
import { useAmountsHidden } from '../../../shared/state/amountsHidden';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { radii } from '../../../shared/theme/tokens';
import { textStyle } from '../../../shared/theme/typography';
import { BarChart, type BarDatum } from '../../../shared/ui/BarChart';
import { Button } from '../../../shared/ui/Button';
import { moneyText } from '../../../shared/ui/moneyText';
import { merchantsKey } from '../insightsApi';
import type { InsightsSection, InsightsSectionContext } from '../sectionRegistry';

const i = copy.insights;
export const TOP_MERCHANTS = 10;

const entriesText = (n: number) => (n === 1 ? i.entryOne : i.entriesCount.replace('{n}', String(n)));

function WhoBody({ ctx }: { ctx: InsightsSectionContext }) {
  const theme = useTheme();
  useAmountsHidden();
  const [table, setTable] = useState(false);
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: merchantsKey(ctx.selection), queryFn: () => ctx.api.loadMerchants(ctx.selection) });
  const d = q.data;
  if (q.isError) {
    return (
      <View testID="who-error" accessibilityRole="alert" style={styles.gap}>
        <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{i.sectionError}</Text>
        <Button label={i.retry} variant="text" testID="who-retry" onPress={() => void q.refetch()} />
      </View>
    );
  }
  if (!d) return <Skeleton height={160} />;
  const m = d.merchants;
  const o = ctx.overview;
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  if (m.ranked.length === 0 && !m.noMerchant && m.surplus.length === 0) {
    return <Text testID="who-empty" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{i.merchantsEmpty.replace('{range}', o.period.title)}</Text>;
  }

  const shown = all ? m.ranked : m.ranked.slice(0, TOP_MERCHANTS);
  const key = (x: MerchantSpend) => (x.noMerchant ? '__none__' : x.key);
  const rows = [...shown, ...(m.noMerchant ? [m.noMerchant] : []), ...m.surplus];
  const data: BarDatum[] = rows.map((x) => ({
    id: key(x),
    label: x.displayMinor === 0 && x.backMinor > 0 ? `${x.name} · ${i.back.replace('{amount}', money(x.backMinor))}` : x.name,
    valueMinor: x.displayMinor,
    detail: entriesText(x.entries),
    spokenLabel: x.displayMinor === 0 && x.backMinor > 0 ? `${x.name}, ${i.back.replace('{amount}', amountLabel({ amountMinor: x.backMinor, currency: d.currency, locale: d.locale, inline: true }))}` : x.name,
  }));
  const merchantFilter = (ctx.selection.filters.merchantKeys?.length ?? 0) > 0;
  const scope = merchantFilter ? d.scopeParts.join(' · ') : [o.period.title, ...d.scopeParts].join(' · ');

  const drill = (id: string) => {
    if (!ctx.onDrill) return;
    const x = rows.find((r) => key(r) === id);
    if (x) ctx.onDrill({ kind: 'merchant', key: x.noMerchant ? '' : x.key, name: x.name });
  };

  return (
    <View testID="who-section" style={styles.gap}>
      <BarChart testID="who-chart" title={i.topMerchants} scope={scope} data={data} currency={d.currency} locale={d.locale} orientation="horizontal" table={table} onToggleTable={() => setTable((t) => !t)} onPressDatum={(b) => drill(b.id)} nameColumn={i.merchantColumn} detailColumn={i.entriesColumn} />
      {m.ranked.length > TOP_MERCHANTS ? <Button label={all ? i.showFewerMerchants : i.seeAllMerchants.replace('{n}', String(m.ranked.length))} variant="text" testID="who-see-all" onPress={() => setAll((v) => !v)} /> : null}
    </View>
  );
}

export const whoGotIt: InsightsSection = {
  id: 'who',
  heading: i.whoHeading,
  order: 3,
  visible: () => true,
  render: (ctx) => (
    <View testID="who-card" style={styles.card}>
      <WhoBody ctx={ctx} />
    </View>
  ),
};

const styles = StyleSheet.create({
  gap: { gap: 12 },
  card: { borderRadius: radii.md, gap: 8 },
});
