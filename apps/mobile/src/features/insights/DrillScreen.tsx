import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ArrowUUpLeft } from 'phosphor-react-native';
import { dayHeading, type ActivityQuery, type ActivityRow, type DrillTarget } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { BarChart, type BarDatum } from '../../shared/ui/BarChart';
import { Button } from '../../shared/ui/Button';
import { moneyText } from '../../shared/ui/moneyText';
import { TopBar } from '../../shared/ui/TopBar';
import { ActivityRowView } from '../activity/ActivityRowView';
import { activityQueryFor, csvFor, drillKey, realDrillApi, shareCsvSaver, type CsvSaver, type DrillApi, type DrillData } from './drillApi';
import type { InsightsSelection } from './insightsApi';
import { scopeLabel } from './KpiTiles';

const i = copy.insights;

export const drillTitle = (t: DrillTarget): string => (t.kind === 'spent' ? i.drillTitleSpent : t.kind === 'income' ? i.drillTitleIncome : t.kind === 'bucket' ? t.label : t.name);

/** The category ids a drill-down for this target stands on, for `See in Activity`. */
const categoriesOf = (t: DrillTarget): readonly string[] | undefined => (t.kind === 'category' ? [t.id] : t.kind === 'categories' ? t.ids : undefined);

/**
 * SCR-12 Insight drill-down (Story 7.3, INS-002): the segment's amount, a chart of it over time with `View as table`, how it was
 * worked out, and the exact entries behind it grouped by day. Each row opens the entry; `See in Activity` opens the same slice
 * in Activity. The entries and the chart are counted the same way as the figure, so they add up to it. A refund surplus reads
 * `₹X back`, never a minus sign. It is pushed over the Insights tab, so Back returns to the same overview, period and filters.
 */
export function DrillScreen({ selection, target, api = realDrillApi, saver = shareCsvSaver, onBack, onOpenEntry, onSeeInActivity }: { selection: InsightsSelection; target: DrillTarget; api?: DrillApi; saver?: CsvSaver; onBack: () => void; onOpenEntry: (transactionId: string) => void; onSeeInActivity: (q: ActivityQuery) => void }) {
  const theme = useTheme();
  const toast = useToast();
  const [table, setTable] = useState(false);
  const q = useQuery({ queryKey: drillKey(selection, target), queryFn: () => api.loadDrill(selection, target) });
  const title = drillTitle(target);
  const header = <TopBar title={title} onBack={onBack} backTestID="drill-back" />;

  if (q.isError || q.data === null) return <View style={styles.fill}>{header}<ErrorBlock cause={i.loadError} onRetry={() => void q.refetch()} /></View>;
  const d: DrillData | undefined = q.data;
  if (!d) {
    return (
      <View style={styles.fill} testID="drill-loading">
        {header}
        <View style={styles.pad}>
          <Skeleton height={40} />
          <Skeleton height={120} />
        </View>
      </View>
    );
  }

  const drill = d.drill;
  const income = drill.mode === 'income';
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  const back = drill.backMinor > 0 && drill.spentMinor === 0;
  const empty = drill.days.length === 0;
  const scope = scopeLabel(income ? i.drillTitleIncome : i.drillTitleSpent, [drill.scope.label, ...d.scopeParts]);
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  const unit = drill.granularity === 'day' ? i.chartPerDay : drill.granularity === 'week' ? i.chartPerWeek : i.chartPerMonth;

  const data: BarDatum[] = drill.buckets.map((b) => ({ id: b.start, label: b.backMinor > 0 && b.spentMinor === 0 ? `${b.label} · ${i.back.replace('{amount}', money(b.backMinor))}` : b.label, valueMinor: income ? 0 : b.spentMinor }));

  const baseline = drill.explanation.baseline;
  const how = [
    drill.explanation.formula === 'spent' ? i.formulaSpent : i.formulaIncome,
    i.timeframe.replace('{range}', drill.explanation.timeframe),
    drill.explanation.entryCount === 1 ? i.fromOneEntry : i.fromEntries.replace('{n}', String(drill.explanation.entryCount)),
    ...(baseline ? [baseline.kind === 'amount' ? i.comparedWith.replace('{label}', baseline.label).replace('{amount}', money(baseline.previousMinor)) : i.noBaselineWhy] : []),
  ];

  const exportCsv = async () => {
    const { fileName, text } = csvFor(d, title);
    const r = await saver.save(fileName, text);
    if (r === 'saved') toast.show({ message: drill.explanation.entryCount === 1 ? i.exportedOne : i.exported.replace('{n}', String(drill.explanation.entryCount)) });
    else if (r === 'failed') toast.show({ message: i.exportFailed });
  };

  return (
    <View style={styles.fill} testID="drill-screen">
      {header}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text testID="drill-scope" style={[textStyle('caption'), muted]}>{scope}</Text>
        {back ? (
          <View style={styles.inline}>
            <Icon icon={ArrowUUpLeft} size={22} color="semantic-income" />
            <Text testID="drill-figure" accessibilityRole="header" style={[textStyle('headline'), ink]}>{`${title} · ${i.back.replace('{amount}', money(drill.backMinor))}`}</Text>
          </View>
        ) : (
          <Amount testID="drill-figure" amountMinor={income ? drill.incomeMinor : drill.spentMinor} currency={d.currency} locale={d.locale} direction={income ? 'income' : 'neutral'} role="headline" {...(income ? { color: 'semantic-income' as const } : {})} />
        )}

        {empty ? (
          <Text testID="drill-empty" style={[textStyle('body'), muted]}>{(income ? i.noIncomeHere : i.nothingSpentHere).replace('{range}', drill.scope.label)}</Text>
        ) : (
          <>
            {income ? null : (
              <BarChart title={i.chartTitleSpent.replace('{unit}', unit.toLowerCase())} scope={scope} data={data} currency={d.currency} locale={d.locale} orientation="vertical" table={table} onToggleTable={() => setTable((t) => !t)} testID="drill-chart" />
            )}
            <View testID="drill-how" style={[styles.how, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
              <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{i.howTitle}</Text>
              {how.map((line) => (
                <Text key={line} style={[textStyle('caption'), muted]}>{line}</Text>
              ))}
            </View>
            {drill.days.map((day) => {
              const net = day.backMinor > 0 && day.spentMinor === 0 ? i.back.replace('{amount}', money(day.backMinor)) : income ? '' : i.daySpent.replace('{amount}', money(day.spentMinor));
              return (
                <View key={day.date} testID={`drill-day-${day.date}`} style={styles.day}>
                  <View accessible accessibilityRole="header" style={styles.dayHeader}>
                    <Text style={[textStyle('label'), ink]}>{dayHeading(day.date, d.today)}</Text>
                    {net ? <Text style={[textStyle('caption'), muted]}>{net}</Text> : null}
                  </View>
                  {day.entries.map((e) => {
                    const row: ActivityRow = { id: e.id, kind: e.type, amountMinor: e.amountMinor, localDate: e.localDate, merchant: e.merchant, categoryName: e.categoryName, categoryIcon: e.categoryIcon, categoryColor: e.categoryColor, accountName: e.accountName };
                    return <ActivityRowView key={`${e.id}-${e.categoryName}`} row={row} date={d.today} currency={d.currency} locale={d.locale} onPress={() => onOpenEntry(e.id)} />;
                  })}
                </View>
              );
            })}
          </>
        )}

        <Button label={i.seeInActivity} variant="text" testID="drill-see-activity" onPress={() => onSeeInActivity(activityQueryFor(d, categoriesOf(target)))} />
        <Button label={i.exportCsv} variant="text" testID="drill-export" onPress={() => void exportCsv()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 16, paddingBottom: 120 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  how: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 4 },
  day: { gap: 8 },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
});
