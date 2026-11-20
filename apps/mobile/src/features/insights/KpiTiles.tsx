import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { ArrowUUpLeft } from 'phosphor-react-native';
import type { Kept } from '@wmbugo/core';
import { amountLabel, controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { moneyText } from '../../shared/ui/moneyText';
import type { InsightsOverview } from './insightsApi';

const i = copy.insights;

/** `Spent · HDFC only · Food`: the tile names its scope first (PRD 6.5). */
export const scopeLabel = (base: string, parts: readonly string[]): string => [base, ...parts].join(' · ');

function Tile({ testID, label, caption, spoken, children, onPress, footer }: { testID: string; label: string; caption: string; spoken: string; children: ReactNode; onPress?: () => void; footer?: ReactNode }) {
  const theme = useTheme();
  const box = { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') };
  const body = (
    <>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{label}</Text>
      {children}
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{caption}</Text>
    </>
  );
  return (
    <View style={[styles.tile, box]}>
      {onPress ? (
        <Pressable testID={testID} {...controlA11y({ label: spoken, role: 'button' })} onPress={onPress} style={styles.inner}>
          {body}
        </Pressable>
      ) : (
        <View testID={testID} accessible accessibilityLabel={spoken} style={styles.inner}>
          {body}
        </View>
      )}
      {footer}
    </View>
  );
}

/** A 270 degree arc: the track in `bg-muted`, the fill in `accent`. Not drawn while amounts are hidden (it would give the percent away). */
export function Gauge({ percent, size = 56 }: { percent: number; size?: number }) {
  const theme = useTheme();
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const fill = arc * Math.min(100, Math.max(0, percent)) / 100;
  const mid = size / 2;
  return (
    <View testID="kept-gauge" importantForAccessibility="no" accessibilityElementsHidden>
      <Svg width={size} height={size}>
        <Circle cx={mid} cy={mid} r={r} stroke={theme.color('bg-muted')} strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={`${arc} ${c}`} rotation={135} origin={`${mid}, ${mid}`} />
        {fill > 0 ? <Circle cx={mid} cy={mid} r={r} stroke={theme.color('accent-primary')} strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={`${fill} ${c}`} rotation={135} origin={`${mid}, ${mid}`} /> : null}
      </Svg>
    </View>
  );
}

function KeptTable({ kept, money, scope }: { kept: Kept; money: (n: number) => string; scope: string }) {
  const theme = useTheme();
  const rows: [string, string, string][] = [];
  if (kept.kind !== 'no_income') rows.push([i.tableIncome, money(kept.incomeMinor), '']);
  rows.push([i.tableSpent, money(kept.spentMinor), '']);
  if (kept.kind === 'kept') rows.push([i.tableKept, money(kept.keptMinor), `${kept.keptPercent}%`]);
  if (kept.kind === 'short') rows.push([i.tableShort, money(kept.shortMinor), '']);
  const ink = { color: theme.color('text-primary') };
  return (
    <View testID="kept-table" accessible={false} style={styles.table}>
      <Text accessibilityRole="header" style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{scope}</Text>
      <View accessible accessibilityRole="header" style={styles.row}>
        <Text style={[textStyle('label'), ink]}>{i.tableHeaderItem}</Text>
        <Text style={[textStyle('label'), ink]}>{i.tableHeaderAmount}</Text>
      </View>
      {rows.map(([name, amount, pct]) => (
        <View key={name} accessible accessibilityLabel={`${name}, ${amount}${pct ? `, ${pct.replace('%', ' percent')}` : ''}`} style={styles.row}>
          <Text style={[textStyle('body'), ink]}>{name}</Text>
          <Text style={[textStyle('body'), ink]}>{`${amount}${pct ? ` · ${pct}` : ''}`}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The four KPI tiles (Story 7.2, UX-DR27, INS-015, INS-016): Spent, Income, Spending change and Kept, each one TalkBack node
 * that names its scope first. A refund surplus reads `₹X back` with the refund icon and never a minus sign; an increase is
 * never red or called bad. Hidden amounts keep the labels and drop every figure, percent, arrow and the gauge.
 */
export function KpiTiles({ overview, onOpenSpent, onOpenIncome }: { overview: InsightsOverview; onOpenSpent?: () => void; onOpenIncome?: () => void }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  const { fontScale, width } = useWindowDimensions();
  const [table, setTable] = useState(false);
  const stack = fontScale >= 1.3 || width < 360;
  const o = overview;
  const money = (n: number) => moneyText(n, o.currency, o.locale);
  const spoken = (n: number) => amountLabel({ amountMinor: n, currency: o.currency, locale: o.locale, inline: true });
  const caption = o.period.title;
  const ink = { color: theme.color('text-primary') };

  const spentBack = o.spent.spentMinor === 0 && o.spent.backMinor > 0;
  const spentTile = (
    <Tile testID="tile-spent" label={scopeLabel(i.spent, o.scopeParts)} caption={caption} spoken={`${scopeLabel(i.spent, o.scopeParts)}, ${hidden ? i.amountHidden : spentBack ? `${spoken(o.spent.backMinor)} back` : spoken(o.spent.spentMinor)}`} {...(onOpenSpent ? { onPress: onOpenSpent } : {})}>
      {spentBack ? (
        <View style={styles.inline}>
          <Icon icon={ArrowUUpLeft} size={20} color="semantic-income" />
          <Text testID="spent-figure" style={[textStyle('headline'), ink]}>{i.back.replace('{amount}', money(o.spent.backMinor))}</Text>
        </View>
      ) : (
        <Amount testID="spent-figure" amountMinor={o.spent.spentMinor} currency={o.currency} locale={o.locale} direction="neutral" role="headline" />
      )}
    </Tile>
  );

  const incomeTile = (
    <Tile testID="tile-income" label={scopeLabel(i.income, o.scopeParts)} caption={caption} spoken={`${scopeLabel(i.income, o.scopeParts)}, ${hidden ? i.amountHidden : spoken(o.income.incomeMinor)}`} {...(onOpenIncome ? { onPress: onOpenIncome } : {})}>
      <Amount testID="income-figure" amountMinor={o.income.incomeMinor} currency={o.currency} locale={o.locale} direction="income" role="headline" color="semantic-income" />
    </Tile>
  );

  const c = o.change;
  // The arrow and the lower-case "vs" live here: a copy string cannot start with either (the catalogue's sentence-case rule).
  const arrow = c.kind === 'change' ? (c.direction === 'up' ? '↑ ' : c.direction === 'down' ? '↓ ' : '') : '';
  const changeText = c.kind === 'no_baseline' ? i.noBaseline : hidden ? `vs ${c.baselineLabel}` : arrow + (c.direction === 'up' ? i.changeUp : c.direction === 'down' ? i.changeDown : i.changeSame).replace('{percent}', String(c.percent)).replace('{label}', c.baselineLabel);
  const changeSpoken = c.kind === 'no_baseline' ? i.noBaseline : hidden ? i.spokenChangeHidden.replace('{label}', c.baselineLabel) : (c.direction === 'up' ? i.spokenChangeUp : c.direction === 'down' ? i.spokenChangeDown : i.spokenChangeSame).replace('{percent}', String(c.percent)).replace('{label}', c.baselineLabel);
  const changeTile = (
    <Tile testID="tile-change" label={scopeLabel(i.change, o.scopeParts)} caption={caption} spoken={changeSpoken}>
      <Text testID="change-figure" style={[textStyle('title'), ink]}>{changeText}</Text>
    </Tile>
  );

  const k = o.kept;
  const keptFigure =
    k.kind === 'no_income' ? i.noIncome : k.kind === 'short' ? i.keptShort.replace('{amount}', money(k.shortMinor)) : hidden ? i.keptHidden.replace('{amount}', money(k.keptMinor)) : i.keptPercent.replace('{percent}', String(k.keptPercent));
  const keptSpoken = k.kind === 'no_income' ? `${i.kept}, ${i.noIncome}` : hidden ? `${i.kept}, ${i.amountHidden}` : k.kind === 'short' ? `${i.kept}, ${keptFigure}` : i.spokenKept.replace('{percent}', String(k.keptPercent));
  const showGauge = !hidden && k.kind !== 'no_income';
  const keptTile = (
    <Tile
      testID="tile-kept"
      label={scopeLabel(i.kept, o.scopeParts)}
      caption={k.kind === 'no_income' ? caption : i.keptCaption}
      spoken={keptSpoken}
      footer={
        k.kind === 'no_income' && k.spentMinor === 0 ? null : (
          <View>
            <Button label={table ? i.viewChart : i.viewTable} variant="text" testID="kept-toggle" onPress={() => setTable((t) => !t)} />
            {table ? <KeptTable kept={k} money={money} scope={scopeLabel(i.kept, o.scopeParts)} /> : null}
          </View>
        )
      }>
      <View style={styles.inline}>
        {showGauge ? <Gauge percent={k.kind === 'kept' ? k.keptPercent : 0} /> : null}
        <Text testID="kept-figure" style={[textStyle('title'), ink, styles.shrink]}>{keptFigure}</Text>
      </View>
    </Tile>
  );

  return (
    <View testID="kpi-tiles" style={stack ? styles.column : styles.grid}>
      <View style={stack ? styles.full : styles.cell}>{spentTile}</View>
      <View style={stack ? styles.full : styles.cell}>{incomeTile}</View>
      <View style={stack ? styles.full : styles.cell}>{changeTile}</View>
      <View style={stack ? styles.full : styles.cell}>{keptTile}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  column: { gap: 12 },
  cell: { width: '47.5%', flexGrow: 1 },
  full: { width: '100%' },
  tile: { borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  inner: { padding: 12, gap: 4, minHeight: 88 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  table: { padding: 12, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 40, alignItems: 'center', gap: 8 },
});
