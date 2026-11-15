import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
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
import { BILLS_QUERY_KEY, realBillsApi, type BillsApi } from './billsApi';
import { useBillActions } from './useBillActions';

const b = copy.bills;

/**
 * SCR-16 Bills & Recurring (Story 6.2): active bills by next due date, then Paused and Ended collapsed at the bottom. A bill
 * is a plan: nothing here creates an entry or changes a balance. Reached from Plan.
 */
export function BillsScreen({ api = realBillsApi, onBack, onOpenBill }: { api?: BillsApi; onBack: () => void; onOpenBill: (id: string) => void }) {
  const theme = useTheme();
  const actions = useBillActions(api);
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
  const { active, paused, ended } = data.list;
  const pickers = { exponent: data.exponent, categories: data.categories, accounts: data.accounts };
  const add = () => actions.openEditor({ mode: 'add' }, pickers);
  const row = (r: BillRowModel) => (
    <BillRow
      key={r.id}
      row={r}
      currency={data.currency}
      locale={data.locale}
      onPress={() => onOpenBill(r.id)}
      {...(r.status.kind === 'not_seen_yet' && r.status.date
        ? { onMarkPaid: () => actions.confirmMarkPaid({ id: r.id, title: r.title }, r.status.date!), onLink: () => actions.openLinkPicker({ id: r.id, title: r.title }, r.status.date!, { currency: data.currency, locale: data.locale, today: data.list.today }) }
        : {})}
    />
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

  if (active.length + paused.length + ended.length === 0) {
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
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
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
});
