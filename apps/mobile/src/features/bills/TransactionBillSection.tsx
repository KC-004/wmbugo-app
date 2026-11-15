import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { dayMonthLabel } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { BillMatchPrompt } from '../../shared/BillMatchPrompt';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { entryBillKey, realBillsApi, type BillsApi } from './billsApi';
import { useBillActions } from './useBillActions';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateForEvent } from '../../shared/queryClient';

/**
 * The bill part of an entry's detail (Story 6.3): `Rent paid? Yes, link it` when the entry looks like a bill's payment, or
 * `Paid Rent for 5 Dec` with `Unlink` once it is linked. Nothing shows when the entry has nothing to do with a bill, and a
 * failed read shows nothing rather than an error: it is a suggestion, not part of the entry.
 */
export function TransactionBillSection({ transactionId, api = realBillsApi }: { transactionId: string; api?: BillsApi }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const actions = useBillActions(api);
  const q = useQuery({ queryKey: entryBillKey(transactionId), queryFn: () => api.forEntry(transactionId) });
  const state = q.data;
  if (!state) return null;

  if (state.link) {
    const l = state.link;
    return (
      <View testID="bill-linked" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.bills.linkedLine.replace('{name}', l.title).replace('{date}', dayMonthLabel(l.dueDate))}</Text>
        <Button label={copy.bills.unlink} variant="text" testID="bill-unlink" onPress={() => void actions.unlink(transactionId)} />
      </View>
    );
  }
  if (!state.match) return null;
  const m = state.match;
  return (
    <BillMatchPrompt
      billName={m.title}
      onLink={() => void actions.link({ id: m.ruleId, title: m.title }, m.dueDate, transactionId)}
      onDismiss={() => void api.dismissMatch(m.ruleId, transactionId).then(() => invalidateForEvent(qc, 'RecurringChanged')).catch(() => undefined)}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
});
