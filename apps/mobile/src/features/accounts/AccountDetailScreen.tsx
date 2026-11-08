import { useRef, useState } from 'react';
import { SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bank, CreditCard, Money, PiggyBank, Wallet } from 'phosphor-react-native';
import { accountLine, ACTIVITY_PAGE_SIZE, type AdjustReason, type CardDetails, dayHeading, longDate, parseAmountInput, shortDate, type ActivityRow, type CurrencyCode } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { Icon, type IconComponent } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { ActivityRowView } from '../activity/ActivityRowView';
import { ScreenHeader } from '../shell/ScreenHeader';
import { AdjustBalancePanel } from './AdjustBalancePanel';
import { CardDetailsPanel } from './CardDetailsPanel';
import { CardLines, dayMonth } from './CardLines';
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
  const qc = useQueryClient();
  const d = q.data && q.data !== 'missing' ? q.data : null;
  const ink = { color: theme.color('text-primary') };
  const toast = useToast();
  const [panel, setPanel] = useState<'balance' | 'date' | 'adjust' | 'card' | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const adjust = async (input: { actualMinor: number; reason: AdjustReason; note: string }) => {
    const r = await api.adjustBalance({ accountId, ...input });
    if (r.ok) {
      setPanel(null);
      await invalidateForEvent(qc, 'AccountsChanged');
      const id = r.transactionId;
      toast.show({
        message: copy.adjust.done,
        undo: {
          label: copy.common.undo,
          onUndo: () =>
            void api
              .remove(id ?? '')
              .then(() => invalidateForEvent(qc, 'AccountsChanged'))
              .catch(() => toast.show({ message: copy.accountDetail.saveError })),
        },
      });
    }
    return r;
  };

  const saveCard = async (details: CardDetails) => {
    const r = await api.updateCardDetails(accountId, details);
    if (r.ok) {
      setPanel(null);
      await invalidateForEvent(qc, 'AccountsChanged');
    }
    return r;
  };

  const open = (kind: 'balance' | 'date') => {
    setPanel(kind);
    setError(null);
    setText(kind === 'date' ? (d?.starting?.localDate ?? '') : '');
  };
  const submit = async () => {
    if (!d || busy.current) return;
    let write: () => Promise<{ ok: boolean; code?: string }>;
    if (panel === 'balance') {
      if (text.trim() === '') return setError(copy.accountDetail.amountRequired);
      const amount = parseAmountInput(text, d.exponent);
      if (!amount.ok) return setError(amount.code === 'EXCESS_DECIMALS' ? copy.accounts.balanceExcess : amount.code === 'AMOUNT_TOO_LARGE' ? copy.accounts.balanceTooLarge : copy.accounts.balanceInvalid);
      write = () => api.setStartingBalance(accountId, amount.value);
    } else {
      write = () => api.changeTrackingDate(accountId, text.trim());
    }
    busy.current = true;
    try {
      const r = await write();
      if (r.ok) {
        setPanel(null);
        setError(null);
        await invalidateForEvent(qc, 'AccountsChanged');
      } else setError(r.code === 'DATE_IN_FUTURE' ? copy.accountDetail.dateFuture : r.code === 'DATE_INVALID' ? copy.accountDetail.dateInvalid : copy.accountDetail.saveError);
    } catch {
      setError(copy.accountDetail.saveError);
    } finally {
      busy.current = false;
    }
  };

  const back = <ScreenHeader title={copy.nav.accounts} onBack={onBack} backTestID="account-detail-back" />;

  if (q.data === 'missing') {
    return (
      <View style={styles.fill}>
        {back}
        <EmptyState sentence={copy.accountDetail.notFound} actionLabel={copy.accountDetail.back} onAction={onBack} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {back}
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
                {d.card ? <CardLines card={d.card} today={d.today} currency={d.currency} locale={d.locale} formatDate={(x) => dayMonth(shortDate(x))} /> : null}
                <View style={styles.actions}>
                  {d.account.type === 'card' ? null : <Button label={copy.accountDetail.moveMoney} variant="secondary" onPress={onMoveMoney} testID="account-move-money" />}
                  {d.account.type === 'card' ? <Button label={copy.cardDetails.action} variant="secondary" onPress={() => setPanel('card')} testID="account-card-details" /> : null}
                  {d.account.balanceNotSet ? null : (
                    <Button label={copy.adjust.action} variant="secondary" onPress={() => setPanel('adjust')} testID="account-adjust" />
                  )}
                  {d.account.balanceNotSet ? (
                    <Button label={d.account.type === 'card' ? copy.accountDetail.setAmountOwed : copy.accountDetail.setBalance} variant="secondary" onPress={() => open('balance')} testID="account-set-balance" />
                  ) : null}
                </View>
                {d.starting && !d.account.balanceNotSet ? (
                  <View style={styles.inline}>
                    <Text testID="tracking-since" style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{`${copy.accountDetail.trackingSince} ${dayMonth(shortDate(d.starting.localDate))}`}</Text>
                    <Button label={copy.accountDetail.changeDate} variant="text" onPress={() => open('date')} testID="account-change-date" />
                  </View>
                ) : null}
                {panel === 'card' && d.account.type === 'card' ? <CardDetailsPanel initial={d.card ?? { statementDueMinor: null, dueDate: null, limitMinor: null }} exponent={d.exponent} onSave={saveCard} onCancel={() => setPanel(null)} /> : null}
                {panel === 'adjust' ? (
                  <AdjustBalancePanel type={d.account.type} currentMinor={d.account.postingsMinor} exponent={d.exponent} currency={d.currency} locale={d.locale} onSave={adjust} onCancel={() => setPanel(null)} />
                ) : null}
                {panel === 'balance' || panel === 'date' ? (
                  <View testID="account-panel" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
                    <Text style={[textStyle('body-medium'), ink]}>
                      {panel === 'date' ? copy.accountDetail.dateLabel : d.account.type === 'card' ? copy.accountDetail.owedQuestion : copy.accountDetail.todayQuestion}
                    </Text>
                    <TextInput
                      testID="account-panel-input"
                      accessibilityLabel={panel === 'date' ? copy.accountDetail.dateLabel : d.account.type === 'card' ? copy.accountDetail.owedQuestion : copy.accountDetail.todayQuestion}
                      accessibilityHint={panel === 'balance' ? copy.accounts.roughIsFine : undefined}
                      value={text}
                      onChangeText={(t) => {
                        setText(t);
                        setError(null);
                      }}
                      keyboardType={panel === 'date' ? 'numbers-and-punctuation' : 'decimal-pad'}
                      autoFocus
                      style={[styles.input, textStyle('body'), { color: theme.color('text-primary'), borderColor: theme.color(error ? 'semantic-expense' : 'border-control') }]}
                    />
                    {error ? (
                      <Text testID="account-panel-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
                        {error}
                      </Text>
                    ) : null}
                    <View style={styles.actions}>
                      <Button label={panel === 'date' ? copy.accountDetail.saveDate : copy.accountDetail.saveBalance} onPress={() => void submit()} testID="account-panel-save" />
                      <Button label={copy.common.cancel} variant="text" onPress={() => setPanel(null)} testID="account-panel-cancel" />
                    </View>
                  </View>
                ) : null}
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
      {a.type === 'card' && line.kind !== 'not-set' ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.cardDetails.fromEntries}</Text> : null}
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
  const when = dayMonth(shortDate(localDate));
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
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accountDetail.correctHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
  headerBlock: { gap: 12, paddingBottom: 4 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  day: { paddingTop: 12, paddingBottom: 4 },
  footer: { gap: 8, paddingTop: 8 },
  starting: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
