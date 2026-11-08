import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { parseAmountInput, type CardDetails } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';

type Field = 'statement' | 'date' | 'limit';

/**
 * Card details copied from the statement: amount due, due date and limit, each optional. Clearing a field removes it;
 * zero is refused. It says plainly that wmbugo is not connected to the bank.
 */
export function CardDetailsPanel({
  initial,
  exponent,
  onSave,
  onCancel,
}: {
  initial: CardDetails;
  exponent: number;
  onSave: (d: CardDetails) => Promise<{ ok: boolean; code?: string }>;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [statement, setStatement] = useState(minorToInput(initial.statementDueMinor, exponent));
  const [date, setDate] = useState(initial.dueDate ?? '');
  const [limit, setLimit] = useState(minorToInput(initial.limitMinor, exponent));
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const busy = useRef(false);
  const ink = { color: theme.color('text-primary') };

  const amount = (text: string, field: Field, zero: string): { ok: true; value: number | null } | { ok: false } => {
    if (text.trim() === '') return { ok: true, value: null };
    const p = parseAmountInput(text, exponent);
    if (!p.ok) {
      setError({ field, message: p.code === 'EXCESS_DECIMALS' ? copy.accounts.balanceExcess : p.code === 'AMOUNT_TOO_LARGE' ? copy.accounts.balanceTooLarge : copy.accounts.balanceInvalid });
      return { ok: false };
    }
    if (p.value === 0) {
      setError({ field, message: zero });
      return { ok: false };
    }
    return { ok: true, value: p.value };
  };

  const save = async () => {
    if (busy.current) return;
    const s = amount(statement, 'statement', copy.cardDetails.statementZero);
    if (!s.ok) return;
    const l = amount(limit, 'limit', copy.cardDetails.limitZero);
    if (!l.ok) return;
    const due = date.trim();
    if (due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return setError({ field: 'date', message: copy.accountDetail.dateInvalid });
    busy.current = true;
    try {
      const r = await onSave({ statementDueMinor: s.value, dueDate: due === '' ? null : due, limitMinor: l.value });
      if (!r.ok) {
        setError(
          r.code === 'DATE_INVALID'
            ? { field: 'date', message: copy.accountDetail.dateInvalid }
            : r.code === 'LIMIT_INVALID'
              ? { field: 'limit', message: copy.cardDetails.limitZero }
              : r.code === 'STATEMENT_INVALID'
                ? { field: 'statement', message: copy.cardDetails.statementZero }
                : { field: 'statement', message: copy.accountDetail.saveError },
        );
      }
    } catch {
      setError({ field: 'statement', message: copy.accountDetail.saveError });
    } finally {
      busy.current = false;
    }
  };

  const input = (field: Field, label: string, value: string, set: (v: string) => void, kind: 'decimal-pad' | 'numbers-and-punctuation') => (
    <View style={styles.field}>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{label}</Text>
      <TextInput
        testID={`card-${field}`}
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => {
          set(t);
          setError(null);
        }}
        keyboardType={kind}
        style={[styles.input, textStyle('body'), ink, { borderColor: theme.color(error?.field === field ? 'semantic-expense' : 'border-control') }]}
      />
      {error?.field === field ? (
        <Text testID={`card-${field}-error`} accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
          {error.message}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View testID="card-panel" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.cardDetails.note}</Text>
      {input('statement', copy.cardDetails.statementLabel, statement, setStatement, 'decimal-pad')}
      {input('date', copy.cardDetails.dateLabel, date, setDate, 'numbers-and-punctuation')}
      {input('limit', copy.cardDetails.limitLabel, limit, setLimit, 'decimal-pad')}
      <View style={styles.row}>
        <Button label={copy.cardDetails.save} onPress={() => void save()} testID="card-save" />
        <Button label={copy.common.cancel} variant="text" onPress={onCancel} testID="card-cancel" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 12 },
  field: { gap: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});
