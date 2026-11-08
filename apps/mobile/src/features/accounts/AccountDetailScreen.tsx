import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bank, CreditCard, Money, PiggyBank, Wallet } from 'phosphor-react-native';
import { accountLine, ACTIVITY_PAGE_SIZE, dayHeading, longDate, shortDate, type ActivityRow, type CurrencyCode } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { Icon, type IconComponent } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { ActivityRowView } from '../activity/ActivityRowView';
import { TYPE_LABEL } from './AccountForm';
import { accountDetailKey, realAccountDetailApi, type AccountDetailApi, type AccountDetailData } from './accountDetailApi';

const ICONS: Readonly<Record<string, IconComponent>> = { Money, Bank, Wallet, PiggyBank, CreditCard };

/**
 * One account: its balance (the same figure as the accounts list), the actions its type allows, and every entry
 * that touched it, newest first, with each side of a transfer. Opening balance is the last row. Rows are not
 * tappable yet (entry detail arrives in Epic 3).
 */
export function AccountDetailScreen({
  accountId,
  onBack,
  onMoveMoney,
  onAddExpense,
  api = realAccountDetailApi,
}: {
  accountId: string;
  onBack: () => void;
  /** Opens the Add sheet as a transfer from this account. */
  onMoveMoney: () => void;
  /** Opens the Add sheet as an expense on this account. */
  onAddExpense: () => void;
  api?: AccountDetailApi;
}) {
  const theme = useTheme();
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const q = useQuery({ queryKey: accountDetailKey(accountId, limit), queryFn: () => api.load(accountId, limit), placeholderData: (prev) => prev });
  const d = q.data && q.data !== 'missing' ? q.data : null;
  const ink = { color: theme.color('text-primary') };

  const back = (
    <Pressable testID="account-detail-back" accessibilityRole="button" accessibilityLabel={copy.nav.back} onPress={onBack} style={styles.back} hitSlop={8}>
      <Icon icon={ArrowLeft} />
    </Pressable>
  );

  if (q.data === 'missing') {
    return (
      <View style={styles.fill}>
        <View style={styles.pad}>{back}</View>
        <EmptyState sentence={copy.accountDetail.notFound} actionLabel={copy.accountDetail.back} onAction={onBack} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={styles.pad}>{back}</View>
      <Reveal
        loading={q.isLoading}
        skeleton={
          <View style={styles.pad} testID="account-detail-skeleton">
            <Skeleton height={96} />
            <Skeleton height={56} />
          </View>
        }
        fill>
        {d ? (
          <SectionList
            testID="account-timeline"
            sections={d.days.map((day) => ({ day, data: day.rows as ActivityRow[] }))}
            keyExtractor={(r) => r.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.headerBlock}>
                <Header d={d} />
                {d.account.type === 'card' ? null : (
                  <View style={styles.actions}>
                    <Button label={copy.accountDetail.moveMoney} variant="secondary" onPress={onMoveMoney} testID="account-move-money" />
                  </View>
                )}
                {d.days.length === 0 ? (
                  <Text testID="account-timeline-empty" style={[textStyle('body'), ink]}>
                    {copy.accountDetail.empty}
                  </Text>
                ) : null}
                {d.days.length === 0 ? <Button label={copy.accountDetail.addExpense} variant="secondary" onPress={onAddExpense} testID="account-add-expense" /> : null}
              </View>
            }
            ListFooterComponent={
              <View style={styles.footer}>
                {d.hasMore ? <Button label={copy.accountDetail.showEarlier} variant="secondary" testID="account-show-earlier" onPress={() => setLimit((n) => n + ACTIVITY_PAGE_SIZE)} /> : null}
                {!d.hasMore && d.starting ? <StartingRow minor={d.starting.minor} localDate={d.starting.localDate} currency={d.currency} locale={d.locale} /> : null}
              </View>
            }
            renderSectionHeader={({ section }) => <DayHeading date={section.day.localDate} today={d.today} />}
            renderItem={({ item, section }) => {
              const signed = d.signed[item.id] ?? 0;
              const title =
                item.kind === 'transfer' && item.accountName
                  ? (signed < 0 ? copy.accountDetail.toAccount : copy.accountDetail.fromAccount).replace('{name}', item.accountName)
                  : undefined;
              return <ActivityRowView row={item} date={section.day.localDate} currency={d.currency} locale={d.locale} title={title} showAccount={false} />;
            }}
          />
        ) : q.isError ? (
          <View style={styles.pad}>
            <ErrorBlock cause={copy.accountDetail.loadError} onRetry={() => void q.refetch()} />
          </View>
        ) : null}
      </Reveal>
    </View>
  );
}

function Header({ d }: { d: AccountDetailData }) {
  const theme = useTheme();
  const a = d.account;
  const line = accountLine(a);
  const words = line.kind === 'owe' ? copy.accounts.youOwe : line.kind === 'below-zero' ? copy.accounts.belowZero : line.kind === 'in-credit' ? copy.accounts.inCredit : '';
  const spoken =
    line.kind === 'not-set'
      ? copy.money.balanceNotSet
      : [words, amountLabel({ amountMinor: line.minor, currency: d.currency, locale: d.locale })].filter(Boolean).join(' ');
  return (
    <View
      testID="account-detail-header"
      accessible
      accessibilityLabel={`${a.name}, ${TYPE_LABEL[a.type]}, ${spoken}`}
      style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.titleRow}>
        <Icon icon={ICONS[a.icon] ?? Wallet} color={a.colorToken as ColorName} size={32} />
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('text-primary') }]}>{a.name}</Text>
          <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{TYPE_LABEL[a.type]}</Text>
        </View>
      </View>
      {line.kind === 'not-set' ? (
        <Text testID="account-detail-balance" style={[textStyle('body-medium'), { color: theme.color('text-secondary') }]}>{copy.money.balanceNotSet}</Text>
      ) : (
        <View testID="account-detail-balance" style={styles.inline}>
          {words ? <Text style={[textStyle('body-medium'), { color: theme.color('text-secondary') }]}>{words}</Text> : null}
          <Amount amountMinor={line.minor} currency={d.currency} direction="neutral" role="headline" locale={d.locale} />
        </View>
      )}
    </View>
  );
}

function DayHeading({ date, today }: { date: string; today: string }) {
  const theme = useTheme();
  return (
    <View testID={`day-${date}`} accessible accessibilityRole="header" accessibilityLabel={longDate(date)} style={styles.day}>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{dayHeading(date, today)}</Text>
    </View>
  );
}

function StartingRow({ minor, localDate, currency, locale }: { minor: number; localDate: string; currency: CurrencyCode; locale: string }) {
  const theme = useTheme();
  const amount = Math.abs(minor);
  // "Sun 1 Nov" without the weekday: the starting day reads "1 Nov".
  const when = shortDate(localDate).split(' ').slice(1).join(' ');
  return (
    <View
      testID="starting-balance"
      accessible
      accessibilityLabel={`${copy.accountDetail.startingBalance}, ${amountLabel({ amountMinor: amount, currency, locale })}, ${longDate(localDate)}`}
      style={[styles.starting, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.accountDetail.startingBalance}</Text>
      <View style={styles.inline}>
        <Amount amountMinor={amount} currency={currency} direction="neutral" locale={locale} />
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{`· ${when}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  back: { minWidth: layout.touchMin, minHeight: layout.touchMin, justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
  headerBlock: { gap: 12, paddingBottom: 4 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  day: { paddingTop: 12, paddingBottom: 4 },
  footer: { gap: 8, paddingTop: 8 },
  starting: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 2 },
});
