import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CurrencyCode } from '@wmbugo/core';
import { controlA11y, spokenAmount } from '../a11y/labels';
import { copy } from '../copy';
import { useAmountsHidden } from '../state/amountsHidden';
import { useTheme } from '../theme/ThemeProvider';
import { radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';
import { Amount } from './Amount';
import { Button } from './Button';

/**
 * One bar. `valueMinor` is never negative. `label` is the name (a category, a day); `leading` is a small chip drawn before it
 * in the horizontal chart; `sharePercent` is the share of the whole (the table's percent column).
 */
export interface BarDatum {
  readonly id: string;
  readonly label: string;
  readonly valueMinor: number;
  readonly leading?: ReactNode;
  readonly sharePercent?: number | null;
  /** Spoken in place of `label` when it differs (`Today`, a full weekday). */
  readonly spokenLabel?: string;
}

export interface BarChartProps {
  /** What the chart is: `Top categories`, `Spending, last 7 days`. Read with the scope. */
  title: string;
  /** The scope label, rendered first and read first: `This period`, `Last 7 days`. */
  scope: string;
  data: readonly BarDatum[];
  currency: CurrencyCode;
  locale?: string;
  orientation: 'horizontal' | 'vertical';
  /** Showing the table instead of the bars. The parent keeps this choice. */
  table: boolean;
  onToggleTable: () => void;
  /** The same drill-down for a bar and for its table row. */
  onPressDatum?: (datum: BarDatum) => void;
  testID?: string;
}

const CHART_HEIGHT = 120;

/** A bar's fill as a percent of the track: any spending shows at least a sliver, only zero shows nothing. */
const fillPercent = (value: number, max: number): number => (value <= 0 ? 0 : Math.max(2, Math.round((value / max) * 100)));

/**
 * The shared bar chart (Story 5.5, UX-DR65): direct labels on every bar, a `View as table` toggle, bars and table rows that run
 * the same drill-down, the scope label first. Built from plain views, so it needs no native chart library. Hide amounts keeps
 * the track, the names and the day labels and draws no fill and no percentage. It is never placed on raw gradient.
 */
export function BarChart({ title, scope, data, currency, locale, orientation, table, onToggleTable, onPressDatum, testID = 'bar-chart' }: BarChartProps) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const max = Math.max(1, ...data.map((d) => d.valueMinor));
  const muted = { color: theme.color('text-secondary') };
  const loc = locale ? { locale } : {};

  const spoken = (d: BarDatum): string => {
    const name = d.spokenLabel ?? d.label;
    const amount = hidden ? 'amount hidden' : spokenAmount(d.valueMinor, currency, locale);
    const share = !hidden && d.sharePercent != null ? `, ${d.sharePercent} percent` : '';
    return `${name}, ${amount}${share}`;
  };

  const toggle = (
    <Button label={table ? copy.chart.viewAsChart : copy.chart.viewAsTable} variant="text" onPress={onToggleTable} testID={`${testID}-toggle`} />
  );

  const head = (
    <Text testID={`${testID}-scope`} accessibilityRole="header" style={[textStyle('caption'), muted]}>
      {`${title} · ${scope}`}
    </Text>
  );

  if (table) {
    const showShare = !hidden && data.some((d) => d.sharePercent != null);
    return (
      <View testID={testID} style={styles.gap}>
        {head}
        <View testID={`${testID}-table`} accessibilityRole="list" style={styles.gap}>
          <View testID={`${testID}-table-head`} accessible accessibilityRole="header" accessibilityLabel={`${copy.chart.nameColumn}, ${copy.chart.amountColumn}${showShare ? `, ${copy.chart.shareColumn}` : ''}`} style={styles.tableRow}>
            <Text style={[textStyle('caption'), styles.nameCol, muted]}>{copy.chart.nameColumn}</Text>
            <Text style={[textStyle('caption'), styles.amountCol, muted]}>{copy.chart.amountColumn}</Text>
            {showShare ? <Text style={[textStyle('caption'), styles.shareCol, muted]}>{copy.chart.shareColumn}</Text> : null}
          </View>
          {data.map((d) => (
            <Pressable
              key={d.id}
              testID={`${testID}-row-${d.id}`}
              {...controlA11y({ label: spoken(d), role: 'button' })}
              onPress={() => onPressDatum?.(d)}
              style={styles.tableRow}>
              <Text style={[textStyle('body'), styles.nameCol, { color: theme.color('text-primary') }]}>{d.label}</Text>
              <View style={styles.amountCol}>
                <Amount amountMinor={d.valueMinor} currency={currency} direction="neutral" role="body" {...loc} />
              </View>
              {showShare ? <Text style={[textStyle('body'), styles.shareCol, { color: theme.color('text-primary') }]}>{d.sharePercent != null ? `${d.sharePercent}%` : ''}</Text> : null}
            </Pressable>
          ))}
        </View>
        {toggle}
      </View>
    );
  }

  const track = theme.color('bg-muted');
  const fill = theme.color('accent-primary');

  if (orientation === 'vertical') {
    return (
      <View testID={testID} style={styles.gap}>
        {head}
        <View testID={`${testID}-bars`} style={styles.columns}>
          {data.map((d) => (
            <Pressable key={d.id} testID={`${testID}-bar-${d.id}`} {...controlA11y({ label: spoken(d), role: 'button' })} onPress={() => onPressDatum?.(d)} style={styles.column}>
              <Amount amountMinor={d.valueMinor} currency={currency} direction="neutral" role="caption" {...loc} style={styles.directLabel} />
              <View style={[styles.verticalTrack, { backgroundColor: track }]}>
                {hidden ? null : <View testID={`${testID}-fill-${d.id}`} style={[styles.verticalFill, { height: `${fillPercent(d.valueMinor, max)}%`, backgroundColor: fill }]} />}
              </View>
              <Text style={[textStyle('caption'), muted]}>{d.label}</Text>
            </Pressable>
          ))}
        </View>
        {toggle}
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.gap}>
      {head}
      <View testID={`${testID}-bars`} style={styles.rows}>
        {data.map((d) => (
          <Pressable key={d.id} testID={`${testID}-bar-${d.id}`} {...controlA11y({ label: spoken(d), role: 'button' })} onPress={() => onPressDatum?.(d)} style={styles.hRow}>
            {d.leading ? <View style={styles.lead}>{d.leading}</View> : null}
            <View style={styles.hBody}>
              <View style={styles.hHead}>
                <Text style={[textStyle('body-medium'), styles.nameCol, { color: theme.color('text-primary') }]}>{d.label}</Text>
                <Amount amountMinor={d.valueMinor} currency={currency} direction="neutral" role="body-medium" {...loc} />
              </View>
              <View style={[styles.hTrack, { backgroundColor: track }]}>
                {hidden ? null : <View testID={`${testID}-fill-${d.id}`} style={[styles.hFill, { width: `${fillPercent(d.valueMinor, max)}%`, backgroundColor: fill }]} />}
              </View>
            </View>
          </Pressable>
        ))}
      </View>
      {toggle}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  rows: { gap: 4 },
  hRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  lead: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hBody: { flex: 1, gap: 6 },
  hHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 12, flexWrap: 'wrap' },
  hTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  hFill: { height: 8, borderRadius: 999 },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  column: { flex: 1, minHeight: 48, alignItems: 'center', gap: 4 },
  directLabel: { fontSize: 10, lineHeight: 14, textAlign: 'center' },
  verticalTrack: { width: '60%', height: CHART_HEIGHT, borderRadius: radii.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  verticalFill: { width: '100%', borderRadius: radii.sm },
  tableRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameCol: { flex: 1 },
  amountCol: { alignItems: 'flex-end' },
  shareCol: { width: 48, textAlign: 'right' },
});
