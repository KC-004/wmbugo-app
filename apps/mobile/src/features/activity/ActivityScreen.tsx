import { SectionList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ACTIVITY_PAGE_SIZE, dayHeading, longDate, type ActivityDay, type ActivityRow, type CurrencyCode } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { ScreenHeader } from '../shell/ScreenHeader';
import { realAddApi, type AddApi } from '../add/addApi';
import { ActivityRowView } from './ActivityRowView';
import { HeldRowActions } from './HeldRowActions';
import { ACTIVITY_QUERY_KEY, realActivityApi, type ActivityApi } from './activityApi';

/** Activity: saved entries grouped under day headers with that day's "Spent" total. */
export function ActivityScreen({
  api = realActivityApi,
  onAccounts,
  onProfile,
  onAdd,
  duplicateApi = realAddApi,
}: {
  api?: ActivityApi;
  onAccounts: () => void;
  onProfile: () => void;
  onAdd: () => void;
  /** Keep both / Merge for a flagged entry. */
  duplicateApi?: Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'>;
}) {
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const q = useQuery({ queryKey: [...ACTIVITY_QUERY_KEY, limit], queryFn: () => api.load(limit), placeholderData: (prev) => prev });
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
      <Reveal loading={q.isLoading} skeleton={skeleton} fill>
        {d ? (
          <SectionList
            testID="activity-list"
            sections={d.days.map((day) => ({ day, data: day.rows as ActivityRow[] }))}
            keyExtractor={(r) => r.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.list}
            ListFooterComponent={
              d.hasMore ? (
                <Button label={copy.activity.showEarlier} variant="secondary" testID="activity-show-earlier" onPress={() => setLimit((n) => n + ACTIVITY_PAGE_SIZE)} />
              ) : undefined
            }
            renderSectionHeader={({ section }) => <DayHeader day={section.day} today={d.today} currency={d.currency} locale={d.locale} />}
            renderItem={({ item, section }) => (
              <ActivityRowView row={item} date={section.day.localDate} currency={d.currency} locale={d.locale} footer={item.held ? <HeldRowActions transactionId={item.id} api={duplicateApi} /> : undefined} />
            )}
          />
        ) : q.isError ? (
          <View style={styles.pad}>
            <ErrorBlock cause={copy.activity.loadError} onRetry={() => void q.refetch()} alternative={{ label: copy.activity.addExpense, onPress: onAdd }} />
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
  dayHeader: { paddingTop: 12, paddingBottom: 4, gap: 2 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  column: { flexDirection: 'column', alignItems: 'flex-start' },
  spent: { flexDirection: 'row', gap: 6, alignItems: 'center' },
});
