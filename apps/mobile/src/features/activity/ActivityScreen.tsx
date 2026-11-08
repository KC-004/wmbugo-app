import { SectionList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ArrowsLeftRight, DotsThree } from 'phosphor-react-native';
import { dayHeading, longDate, type ActivityDay, type ActivityRow, type CurrencyCode } from '@wmbugo/core';
import { amountLabel, type AmountKind } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { categoryIcon } from '../add/categoryIcons';
import { ScreenHeader } from '../shell/ScreenHeader';
import { ACTIVITY_QUERY_KEY, realActivityApi, type ActivityApi } from './activityApi';

const KIND: Readonly<Record<ActivityRow['kind'], AmountKind>> = { expense: 'spent', income: 'income', refund: 'refund', transfer: 'transfer' };

/** Activity: saved entries grouped under day headers with that day's "Spent" total. */
export function ActivityScreen({
  api = realActivityApi,
  onAccounts,
  onProfile,
  onAdd,
}: {
  api?: ActivityApi;
  onAccounts: () => void;
  onProfile: () => void;
  onAdd: () => void;
}) {
  const q = useQuery({ queryKey: ACTIVITY_QUERY_KEY, queryFn: () => api.load() });
  const d = q.data ?? null;
  const header = <ScreenHeader title={copy.nav.activity} onAccounts={onAccounts} onProfile={onProfile} />;
  const skeleton = (
    <View style={styles.pad} testID="activity-skeleton">
      <Skeleton height={56} />
      <Skeleton height={56} />
      <Skeleton height={56} />
    </View>
  );

  if (d && d.days.length === 0) {
    return (
      <View style={styles.fill}>
        <View style={styles.pad}>{header}</View>
        <EmptyState sentence={copy.activity.empty} actionLabel={copy.activity.addExpense} onAction={onAdd} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={styles.pad}>{header}</View>
      <Reveal loading={q.isLoading} skeleton={skeleton}>
        {d ? (
          <SectionList
            testID="activity-list"
            sections={d.days.map((day) => ({ day, data: day.rows as ActivityRow[] }))}
            keyExtractor={(r) => r.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.list}
            renderSectionHeader={({ section }) => <DayHeader day={section.day} today={d.today} currency={d.currency} locale={d.locale} />}
            renderItem={({ item, section }) => <Row row={item} date={section.day.localDate} currency={d.currency} locale={d.locale} />}
          />
        ) : q.isError ? (
          <View style={styles.pad}>
            <Text style={textStyle('body')}>{copy.activity.loadError}</Text>
            <Button label={copy.common.tryAgain} variant="secondary" onPress={() => void q.refetch()} />
          </View>
        ) : null}
      </Reveal>
    </View>
  );
}

function DayHeader({ day, today, currency, locale }: { day: ActivityDay; today: string; currency: CurrencyCode; locale: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const spoken = `${longDate(day.localDate)}, ${amountLabel({ amountMinor: day.spentMinor, currency, locale, kind: 'spent', inline: true })}`;
  return (
    <View
      testID={`day-${day.localDate}`}
      accessible
      accessibilityRole="header"
      accessibilityLabel={spoken}
      style={[styles.dayHeader, fontScale >= 1.3 ? styles.column : styles.between]}>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{dayHeading(day.localDate, today)}</Text>
      <View style={styles.spent}>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.activity.spent}</Text>
        <Amount amountMinor={day.spentMinor} currency={currency} direction="neutral" role="caption" locale={locale} color="text-secondary" />
      </View>
    </View>
  );
}

function Row({ row, date, currency, locale }: { row: ActivityRow; date: string; currency: CurrencyCode; locale: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const title = row.merchant ?? row.categoryName ?? copy.activity.transfer;
  const sub = [row.kind === 'transfer' ? copy.activity.transfer : row.categoryName, row.accountName].filter(Boolean).join(' · ');
  const spoken = [
    title,
    amountLabel({ amountMinor: row.amountMinor, currency, locale, kind: KIND[row.kind], inline: true }),
    row.kind === 'transfer' ? null : row.categoryName,
    row.accountName,
    longDate(date),
  ]
    .filter(Boolean)
    .join(', ');
  const glyph = row.kind === 'transfer' ? ArrowsLeftRight : row.categoryIcon ? categoryIcon(row.categoryIcon) : DotsThree;
  const direction = row.kind === 'income' || row.kind === 'refund' ? 'income' : row.kind === 'expense' ? 'expense' : 'neutral';
  const stack = fontScale >= 1.3;
  return (
    <View
      testID={`activity-row-${row.id}`}
      accessible
      accessibilityLabel={spoken}
      style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={[styles.chip, { backgroundColor: theme.color('bg-muted') }]}>
        <Icon icon={glyph} size={22} color={(row.categoryColor as ColorName | null) ?? 'text-secondary'} />
      </View>
      <View style={[styles.rowBody, stack ? styles.column : styles.between]}>
        <View style={styles.rowText}>
          <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{title}</Text>
          <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{sub}</Text>
        </View>
        <Amount amountMinor={row.amountMinor} currency={currency} direction={direction} locale={locale} color={direction === 'income' ? 'semantic-income' : 'text-primary'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
  dayHeader: { paddingTop: 12, paddingBottom: 4, gap: 2 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  column: { flexDirection: 'column', alignItems: 'flex-start' },
  spent: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radii.md, padding: 12 },
  chip: { width: 40, height: 40, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 4 },
  rowText: { flexShrink: 1 },
});
