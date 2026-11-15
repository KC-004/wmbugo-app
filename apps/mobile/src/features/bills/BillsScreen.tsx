import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { isAmountsHidden, useAmountsHidden } from '../../shared/state/amountsHidden';
import { amountLabel } from '../../shared/a11y/labels';
import { moneyText } from '../../shared/ui/moneyText';
import { Chip } from '../../shared/ui/Chip';
import { radii } from '../../shared/theme/tokens';
import { CaretDown, CaretRight } from 'phosphor-react-native';
import type { BillRowModel } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { TopBar } from '../../shared/ui/TopBar';
import { BillRow } from './BillRow';
import { subscriptionPhrase } from './billText';
import { BILLS_QUERY_KEY, realBillsApi, type BillsApi } from './billsApi';
import { useBillActions } from './useBillActions';

const b = copy.bills;

/**
 * SCR-16 Bills & Recurring (Story 6.2): active bills by next due date, then Paused and Ended collapsed at the bottom. A bill
 * is a plan: nothing here creates an entry or changes a balance. Reached from Plan.
 */
export function BillsScreen({ api = realBillsApi, onBack, onOpenBill, focusRuleId }: { api?: BillsApi; onBack: () => void; onOpenBill: (id: string) => void; /** A tapped bill reminder opens the list scrolled to that bill. */ focusRuleId?: string }) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: the subscription header builds amount text
  const theme = useTheme();
  const actions = useBillActions(api);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const ys = useRef<Record<string, number>>({});
  const scrolled = useRef(false);
  const [filter, setFilter] = useState<'all' | 'subscriptions'>('all');
  const q = useQuery({ queryKey: BILLS_QUERY_KEY, queryFn: () => api.load() });
  const [open, setOpen] = useState<{ paused: boolean; ended: boolean }>({ paused: false, ended: false });
  const header = <TopBar title={b.title} onBack={onBack} backTestID="bills-back" />;

  if (q.isError) return <View style={styles.fill}>{header}<ErrorBlock cause={b.loadError} onRetry={() => void q.refetch()} /></View>;
  if (!q.data) {
    return (
      <View style={styles.fill} testID="bills-loading">
        {header}
        <View style={styles.pad}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      </View>
    );
  }
  const data = q.data;
  const all = data.list;
  const subsOnly = filter === 'subscriptions';
  const keep = (rows: readonly BillRowModel[]) => (subsOnly ? rows.filter((r) => r.kind === 'subscription') : rows);
  const active = keep(all.active);
  const paused = keep(all.paused);
  const ended = keep(all.ended);
  const pickers = { exponent: data.exponent, categories: data.categories, accounts: data.accounts, notificationsDenied: data.notificationsDenied };
  const add = () => actions.openEditor({ mode: 'add', ...(subsOnly ? { prefill: { kind: 'subscription' as const } } : {}) }, pickers);
  /** `₹1,189 a year · about ₹99 a month`: what a subscription costs per month, with its own cadence first. */
  const subsCaption = (r: BillRowModel): string | undefined => {
    if (!subsOnly) return undefined;
    const base = subscriptionPhrase(r, moneyText(r.expectedAmountMinor, data.currency, data.locale), moneyText(r.monthlyEquivalentMinor, data.currency, data.locale));
    const note = r.state === 'paused' ? b.notCountedPaused : r.state === 'ended' ? b.notCountedEnded : null;
    return [base, note].filter(Boolean).join(' · ') || undefined;
  };
  const row = (r: BillRowModel) => (
    <View key={r.id} onLayout={(e) => { ys.current[r.id] = e.nativeEvent.layout.y; }}>
    <BillRow
      row={r}
      currency={data.currency}
      locale={data.locale}
      onPress={() => onOpenBill(r.id)}
      {...(subsCaption(r) ? { extraCaption: subsCaption(r)! } : {})}
      {...(r.status.kind === 'not_seen_yet' && r.status.date
        ? { onMarkPaid: () => actions.confirmMarkPaid({ id: r.id, title: r.title }, r.status.date!), onLink: () => actions.openLinkPicker({ id: r.id, title: r.title }, r.status.date!, { currency: data.currency, locale: data.locale, today: data.list.today }) }
        : {})}
    />
    </View>
  );
  const group = (key: 'paused' | 'ended', title: string, rows: readonly BillRowModel[]) =>
    rows.length === 0 ? null : (
      <View key={key} testID={`bills-group-${key}`} style={styles.group}>
        <Pressable
          testID={`bills-toggle-${key}`}
          {...controlA11y({ label: `${title}, ${rows.length}`, role: 'button', selected: open[key] })}
          onPress={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
          style={styles.toggle}>
          <Icon icon={open[key] ? CaretDown : CaretRight} size={18} color="text-secondary" />
          <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{`${title} (${rows.length})`}</Text>
        </Pressable>
        {open[key] ? rows.map(row) : null}
      </View>
    );

  const filters = (
    <View style={styles.filters} accessibilityRole="radiogroup" accessibilityLabel={b.title}>
      <Chip role="radio" variant="period" label={b.allBills} testID="bills-filter-all" selected={!subsOnly} onPress={() => setFilter('all')} />
      <Chip role="radio" variant="period" label={b.subscriptions} testID="bills-filter-subscriptions" selected={subsOnly} onPress={() => setFilter('subscriptions')} />
    </View>
  );

  if (all.active.length + all.paused.length + all.ended.length === 0) {
    return (
      <View style={styles.fill} testID="bills-empty">
        {header}
        <EmptyState sentence={b.empty} actionLabel={b.add} onAction={add} />
      </View>
    );
  }

  return (
    <View style={styles.fill} testID="bills-screen">
      {header}
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.pad}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          const y = focusRuleId ? ys.current[focusRuleId] : undefined;
          if (y !== undefined && !scrolled.current) {
            scrolled.current = true;
            scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
          }
        }}>
        {filters}
        {subsOnly && all.subscriptions.counted > 0 ? (
          <View
            testID="bills-subs-header"
            accessible
            accessibilityLabel={isAmountsHidden() ? b.subsSpokenHidden : b.subsSpoken.replace('{amount}', amountLabel({ amountMinor: all.subscriptions.totalMinor, currency: data.currency, locale: data.locale, inline: true }).replace(/^about /, ''))}
            style={[styles.subsCard, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
            <Text style={[textStyle('headline'), { color: theme.color('text-primary') }]}>{b.subsMonth.replace('{amount}', moneyText(all.subscriptions.totalMinor, data.currency, data.locale))}</Text>
            <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{b.subsCaption}</Text>
          </View>
        ) : null}
        {subsOnly && active.length + paused.length + ended.length === 0 ? <Text testID="bills-subs-empty" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{b.subsEmpty}</Text> : null}
        <Button label={b.add} variant="secondary" testID="bills-add" onPress={add} />
        {active.map(row)}
        {group('paused', b.groupPaused, paused)}
        {group('ended', b.groupEnded, ended)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  group: { gap: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  subsCard: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 4 },
});
