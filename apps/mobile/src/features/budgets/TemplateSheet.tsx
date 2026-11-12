import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseAmountInput, splitIncome, type CurrencyCode, type TemplateState, type TemplateTargets } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';

type Row = 'needs' | 'wants' | 'savings';
const ROWS: readonly { key: Row; label: string }[] = [
  { key: 'needs', label: copy.budgets.needs },
  { key: 'wants', label: copy.budgets.wants },
  { key: 'savings', label: copy.budgets.savings },
];

/** `Targets add up to ₹82,000 of ₹80,000 income`: the two amounts are rendered by <Amount>. */
function SumLine({ sumMinor, incomeMinor, currency, locale }: { sumMinor: number; incomeMinor: number; currency: CurrencyCode; locale: string }) {
  const theme = useTheme();
  const parts = copy.budgets.sumLine.split(/(\{sum\}|\{income\})/);
  return (
    <Text testID="template-sum" style={[textStyle('caption'), { color: theme.color('on-glass-secondary') }]}>
      {parts.map((p, i) =>
        p === '{sum}' ? (
          <Amount key={i} amountMinor={sumMinor} currency={currency} locale={locale} direction="neutral" role="caption" color="on-glass-secondary" />
        ) : p === '{income}' ? (
          <Amount key={i} amountMinor={incomeMinor} currency={currency} locale={locale} direction="neutral" role="caption" color="on-glass-secondary" />
        ) : (
          p
        ),
      )}
    </Text>
  );
}

/**
 * The 50/30/20 sheet (Story 4.10): the income (pre-filled when it is known), the three rows it gives and a caption that says
 * when the rows do not add up to it. Rows start as the exact split and are saved as typed once edited. When the template
 * already exists it says so and offers Edit targets. Nothing is written until the last button.
 */
export function TemplateSheet({
  template,
  initialIncomeMinor,
  payCycle,
  exponent,
  currency,
  locale,
  onCreate,
  onEdit,
  close,
}: {
  template: TemplateState;
  initialIncomeMinor: number | null;
  payCycle: boolean;
  exponent: number;
  currency: CurrencyCode;
  locale: string;
  onCreate: (incomeMinor: number, targets?: TemplateTargets) => Promise<{ ok: boolean; code?: string }>;
  onEdit: (targets: TemplateTargets) => Promise<{ ok: boolean; code?: string }>;
  close: () => void;
}) {
  const theme = useTheme();
  const ink = { color: theme.color('on-glass-primary') };
  const muted = { color: theme.color('on-glass-secondary') };
  const [editing, setEditing] = useState(false);
  const [income, setIncome] = useState(initialIncomeMinor !== null ? minorToInput(initialIncomeMinor, exponent) : '');
  const [edits, setEdits] = useState<Partial<Record<Row, string>>>(() =>
    template.targets ? { needs: minorToInput(template.targets.needsMinor, exponent), wants: minorToInput(template.targets.wantsMinor, exponent), savings: minorToInput(template.targets.savingsMinor, exponent) } : {},
  );
  const [error, setError] = useState<{ field: 'income' | 'rows' | 'form'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const incomeRef = useRef<ComponentRef<typeof TextInput>>(null);

  const parsedIncome = parseAmountInput(income, exponent);
  const incomeMinor = parsedIncome.ok && parsedIncome.value > 0 ? parsedIncome.value : null;
  const split = useMemo(() => (incomeMinor !== null ? splitIncome(incomeMinor) : null), [incomeMinor]);
  const exact: Record<Row, number | null> = { needs: split?.needsMinor ?? null, wants: split?.wantsMinor ?? null, savings: split?.savingsMinor ?? null };

  // A row shows what was typed, or the exact split of the income until it is edited.
  const textFor = (k: Row): string => edits[k] ?? (exact[k] !== null ? minorToInput(exact[k], exponent) : '');
  const valueFor = (k: Row): number | null => {
    const p = parseAmountInput(textFor(k), exponent);
    return p.ok && p.value > 0 ? p.value : null;
  };
  const values = { needs: valueFor('needs'), wants: valueFor('wants'), savings: valueFor('savings') };
  const sum = (values.needs ?? 0) + (values.wants ?? 0) + (values.savings ?? 0);
  const basis = editing && template.incomeMinor ? template.incomeMinor : incomeMinor;
  const differs = basis !== null && values.needs !== null && values.wants !== null && values.savings !== null && sum !== basis;

  if (template.exists && !editing) {
    return (
      <View testID="template-exists" style={styles.root}>
        <Text accessibilityRole="alert" style={[textStyle('body-medium'), ink]}>{copy.budgets.alreadyUse}</Text>
        <Button label={copy.budgets.editTargets} testID="template-edit" onPress={() => setEditing(true)} />
      </View>
    );
  }

  const submit = async () => {
    if (busy) return;
    const targets = values.needs !== null && values.wants !== null && values.savings !== null ? { needsMinor: values.needs, wantsMinor: values.wants, savingsMinor: values.savings } : null;
    if (!template.exists && incomeMinor === null) {
      setError({ field: 'income', text: copy.budgets.incomeRequired });
      incomeRef.current?.focus();
      return;
    }
    if (!targets) {
      setError({ field: 'rows', text: copy.budgets.targetRequired });
      return;
    }
    setError(null);
    setBusy(true);
    let r: { ok: boolean; code?: string };
    try {
      r = template.exists ? await onEdit(targets) : await onCreate(incomeMinor!, edited(edits) ? targets : undefined);
    } catch {
      r = { ok: false, code: 'WRITE_FAILED' };
    } finally {
      setBusy(false);
    }
    if (r.ok) return close();
    if (r.code === 'INCOME_REQUIRED') return setError({ field: 'income', text: copy.budgets.incomeRequired });
    setError({ field: 'form', text: copy.budgets.templateFailed });
  };

  const input = (invalid: boolean) => [styles.input, textStyle('body'), ink, { borderColor: invalid ? theme.color('semantic-warning') : theme.color('on-glass-secondary') }];

  return (
    <View testID="template-sheet" style={styles.root}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.gap}>
        {template.exists ? null : (
          <>
            <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{payCycle ? copy.budgets.incomeCycle : copy.budgets.incomeMonthly}</Text>
            <TextInput
              ref={incomeRef}
              testID="template-income"
              accessibilityLabel={payCycle ? copy.budgets.incomeCycle : copy.budgets.incomeMonthly}
              keyboardType="decimal-pad"
              value={income}
              onChangeText={(t) => {
                setIncome(t);
                if (error?.field === 'income') setError(null);
              }}
              style={input(error?.field === 'income')}
            />
            {error?.field === 'income' ? <Text testID="template-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>{error.text}</Text> : null}
            <Text style={[textStyle('caption'), muted]}>{copy.budgets.changeLater}</Text>
          </>
        )}

        {ROWS.map((r) => (
          <View key={r.key} style={styles.row}>
            <Text style={[textStyle('body'), ink, styles.rowLabel]}>{r.label}</Text>
            <TextInput
              testID={`template-${r.key}`}
              accessibilityLabel={r.label}
              keyboardType="decimal-pad"
              value={textFor(r.key)}
              onChangeText={(t) => {
                setEdits((e) => ({ ...e, [r.key]: t }));
                if (error?.field === 'rows') setError(null);
              }}
              style={[...input(error?.field === 'rows' && values[r.key] === null), styles.rowInput]}
            />
          </View>
        ))}
        {error?.field === 'rows' || error?.field === 'form' ? <Text testID="template-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>{error.text}</Text> : null}
        {differs && basis !== null ? <SumLine sumMinor={sum} incomeMinor={basis} currency={currency} locale={locale} /> : null}
      </ScrollView>
      <Button label={template.exists ? copy.budgets.saveTargets : copy.budgets.createTargets} testID="template-save" onPress={() => void submit()} />
    </View>
  );
}

/** A row was typed over: the targets are saved as typed instead of as the exact split. */
const edited = (e: Partial<Record<Row, string>>): boolean => Object.keys(e).length > 0;

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 440 },
  gap: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { width: 84 },
  rowInput: { flex: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
