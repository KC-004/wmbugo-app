import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../shared/ui/Button';
import { dayMonthLabel, type ActivityRow, type CurrencyCode, type LinkCandidate } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { ActivityRowView } from '../activity/ActivityRowView';
import type { BillsApi } from './billsApi';

const asRow = (c: LinkCandidate): ActivityRow => ({
  id: c.id,
  kind: 'expense',
  amountMinor: c.amountMinor,
  localDate: c.localDate,
  merchant: c.merchant,
  categoryName: c.categoryName,
  categoryIcon: c.categoryIcon,
  categoryColor: c.categoryColor,
  accountName: c.accountName,
});

/**
 * `Link an entry`: confirmed expenses near the due date that are not linked to another bill, the ones that look like the
 * payment first (`Looks like a match`), searchable by merchant or note. Tapping one links it.
 */
export function BillLinkPicker({ api, ruleId, dueDate, currency, locale, today, onPick }: { api: BillsApi; ruleId: string; dueDate: string; currency: CurrencyCode; locale: string; today: string; onPick: (transactionId: string) => void }) {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [list, setList] = useState<readonly LinkCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void api
      .candidates(ruleId, dueDate, search)
      .then((r) => live && setList(r))
      .catch(() => live && (setFailed(true), setList([])));
    return () => {
      live = false;
    };
  }, [api, ruleId, dueDate, search, attempt]);
  const ink = { color: theme.color('on-glass-primary') };
  return (
    <View testID="bill-link-picker" style={styles.root}>
      <TextInput
        testID="bill-link-search"
        accessibilityLabel={copy.bills.pickerSearch}
        placeholder={copy.bills.pickerSearch}
        placeholderTextColor={theme.color('on-glass-secondary')}
        value={search}
        onChangeText={setSearch}
        style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]}
      />
      {failed ? (
        <View testID="bill-link-error" style={styles.gap}>
          <Text accessibilityRole="alert" style={[textStyle('body'), ink]}>{copy.bills.pickerError}</Text>
          <Button label={copy.bills.pickerRetry} variant="secondary" onGlass testID="bill-link-retry" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : list !== null && list.length === 0 ? (
        <Text testID="bill-link-empty" style={[textStyle('body'), ink]}>{copy.bills.pickerEmpty.replace('{date}', dayMonthLabel(dueDate))}</Text>
      ) : (
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.gap}>
          {(list ?? []).map((c) => (
            <ActivityRowView
              key={c.id}
              row={asRow(c)}
              date={today}
              currency={currency}
              locale={locale}
              showDate
              onPress={() => onPick(c.id)}
              footer={c.looksLikeMatch ? <Text testID={`bill-link-match-${c.id}`} style={[textStyle('caption'), { color: theme.color('accent-primary') }]}>{copy.bills.looksLikeMatch}</Text> : undefined}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 420 },
  gap: { gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
