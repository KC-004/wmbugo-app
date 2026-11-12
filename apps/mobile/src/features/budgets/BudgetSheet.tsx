import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ALERT_LEVELS, DEFAULT_ALERT_LEVELS, parseAmountInput, parseOverallExists, type SaveBudgetInput } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import type { BudgetsData, EditableBudget, SaveBudgetOutcome } from './budgetsApi';

export type BudgetSheetMode = { readonly mode: 'add' } | { readonly mode: 'edit'; readonly budget: EditableBudget };

type Field = 'limit' | 'categories' | 'dates' | 'form';
interface FieldError {
  readonly field: Field;
  readonly text: string;
}

const focusNode = (ref: { current: unknown }) => {
  const node = findNodeHandle(ref.current as never);
  if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 50);
};

/**
 * Add or edit a budget (Story 4.6): For (Everything or Some categories), optional Only these accounts, Period, Limit and
 * Alert me at. An overall budget always follows the profile period. Nothing is written until Save; an error keeps every
 * input and moves focus to the field.
 */
export function BudgetSheet({
  start,
  data,
  onSave,
  onEditExisting,
  close,
}: {
  start: BudgetSheetMode;
  data: BudgetsData;
  onSave: (input: SaveBudgetInput) => Promise<SaveBudgetOutcome>;
  /** Opens the existing overall budget when a second one is refused. */
  onEditExisting: (budgetId: string) => void;
  close: () => void;
}) {
  const theme = useTheme();
  const editing = start.mode === 'edit' ? start.budget : null;
  const [scope, setScope] = useState<'overall' | 'category'>(editing ? (editing.scope === 'overall' ? 'overall' : 'category') : 'category');
  const [categoryIds, setCategoryIds] = useState<string[]>(editing ? [...editing.categoryIds] : []);
  const [accountIds, setAccountIds] = useState<string[]>(editing?.accountIds ? [...editing.accountIds] : []);
  const [periodRule, setPeriodRule] = useState<'default' | 'monthly' | 'weekly' | 'custom'>(editing?.period.rule ?? 'monthly');
  const [from, setFrom] = useState(editing?.period.customStart ?? '');
  const [to, setTo] = useState(editing?.period.customEnd ?? '');
  const [limit, setLimit] = useState(editing ? minorToInput(editing.targetMinor, data.exponent) : '');
  const [levels, setLevels] = useState<number[]>(editing?.alertThresholds ? [...editing.alertThresholds] : [...DEFAULT_ALERT_LEVELS]);
  const [error, setError] = useState<FieldError | null>(null);
  const [overallId, setOverallId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const limitRef = useRef<ComponentRef<typeof TextInput>>(null);
  const fromRef = useRef<ComponentRef<typeof TextInput>>(null);
  const catRef = useRef<ComponentRef<typeof View>>(null);
  const ink = { color: theme.color('on-glass-primary') };
  const muted = { color: theme.color('on-glass-secondary') };
  const b = copy.budgets;

  const options = useMemo(() => {
    const byId = new Map(data.categories.map((c) => [c.id, c]));
    const tops = data.categories.filter((c) => c.parentId === null);
    const out: { id: string; label: string }[] = [];
    for (const t of tops) {
      out.push({ id: t.id, label: t.name });
      for (const c of data.categories.filter((x) => x.parentId === t.id)) out.push({ id: c.id, label: `${byId.get(t.id)!.name} › ${c.name}` });
    }
    return out;
  }, [data.categories]);

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const overall = scope === 'overall';
  const defaultLabel = data.payCycle ? b.eachCycle : b.eachMonth;

  const fail = (e: FieldError) => {
    setError(e);
    if (e.field === 'limit') limitRef.current?.focus();
    else if (e.field === 'dates') fromRef.current?.focus();
    else if (e.field === 'categories') focusNode(catRef);
  };

  const submit = async () => {
    if (busy) return;
    setOverallId(null);
    const amount = parseAmountInput(limit, data.exponent);
    if (!amount.ok || amount.value <= 0) return fail({ field: 'limit', text: b.amountRequired });
    if (scope === 'category' && categoryIds.length === 0) return fail({ field: 'categories', text: b.chooseCategory });
    if (!overall && periodRule === 'custom') {
      if (from.trim() !== '' && to.trim() !== '' && to.trim() < from.trim() && /^\d{4}-\d{2}-\d{2}$/.test(from.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(to.trim())) return fail({ field: 'dates', text: b.endBeforeStart });
    }
    setError(null);
    setBusy(true);
    let r: SaveBudgetOutcome;
    try {
      r = await onSave({
        ...(editing ? { id: editing.id } : {}),
        scope,
        categoryIds: scope === 'category' ? categoryIds : [],
        accountIds: accountIds.length > 0 ? accountIds : null,
        periodRule: overall ? 'default' : periodRule,
        ...(periodRule === 'custom' && !overall ? { customStart: from.trim(), customEnd: to.trim() } : {}),
        targetMinor: amount.value,
        alertLevels: levels,
      });
    } catch {
      r = { ok: false, code: 'WRITE_FAILED' };
    } finally {
      setBusy(false);
    }
    if (r.ok) return close();
    const existing = parseOverallExists(r.code);
    if (existing) return setOverallId(existing);
    if (r.code === 'AMOUNT_REQUIRED') return fail({ field: 'limit', text: b.amountRequired });
    if (r.code === 'CATEGORY_REQUIRED') return fail({ field: 'categories', text: b.chooseCategory });
    if (r.code === 'DATE_RANGE_INVALID') return fail({ field: 'dates', text: b.endBeforeStart });
    if (r.code === 'DATE_INVALID') return fail({ field: 'dates', text: b.dateInvalid });
    setError({ field: 'form', text: b.saveFailed });
  };

  const err = (f: Field) => (error?.field === f ? error.text : null);
  const errorText = (f: Field) =>
    err(f) ? (
      <Text testID={`budget-error-${f}`} accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>
        {err(f)}
      </Text>
    ) : null;
  const input = (invalid: boolean) => [styles.input, textStyle('body'), ink, { borderColor: invalid ? theme.color('semantic-warning') : theme.color('on-glass-secondary') }];

  return (
    <View testID="budget-sheet" style={styles.root}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.gap}>
        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.forLabel}</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.forLabel}>
          <Chip onGlass role="radio" label={b.everything} testID="budget-for-overall" selected={overall} onPress={() => { setScope('overall'); setOverallId(null); setError(null); }} />
          <Chip onGlass role="radio" label={b.someCategories} testID="budget-for-category" selected={!overall} onPress={() => { setScope('category'); setOverallId(null); setError(null); }} />
        </View>

        {overallId ? (
          <View testID="budget-overall-exists" style={styles.gap}>
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), ink]}>{b.overallExists}</Text>
            <Button label={b.editIt} testID="budget-edit-existing" onGlass variant="text" onPress={() => onEditExisting(overallId)} />
          </View>
        ) : null}

        {overall ? null : (
          <>
            <View ref={catRef} accessible accessibilityRole="header" accessibilityLabel={b.categoriesLabel}>
              <Text style={[textStyle('label'), ink]}>{b.categoriesLabel}</Text>
            </View>
            <View style={styles.row} accessibilityLabel={b.categoriesLabel}>
              {options.map((o) => (
                <Chip key={o.id} onGlass label={o.label} testID={`budget-category-${o.id}`} selected={categoryIds.includes(o.id)} onPress={() => { setCategoryIds((l) => toggle(l, o.id)); if (error?.field === 'categories') setError(null); }} />
              ))}
            </View>
            {errorText('categories')}
          </>
        )}

        {data.accounts.length > 1 ? (
          <>
            <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.accountsLabel}</Text>
            <View style={styles.row}>
              {data.accounts.map((a) => (
                <Chip key={a.id} onGlass variant="account" label={a.name} testID={`budget-account-${a.id}`} selected={accountIds.includes(a.id)} onPress={() => setAccountIds((l) => toggle(l, a.id))} />
              ))}
            </View>
          </>
        ) : null}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.periodLabel}</Text>
        {overall ? (
          <Text testID="budget-overall-caption" style={[textStyle('caption'), muted]}>{data.payCycle ? b.overallCycle : b.overallMonth}</Text>
        ) : (
          <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.periodLabel}>
            {([['default', defaultLabel], ['monthly', b.monthly], ['weekly', b.weekly], ['custom', b.custom]] as const).map(([rule, label]) => (
              <Chip key={rule} onGlass role="radio" label={label} testID={`budget-period-${rule}`} selected={periodRule === rule} onPress={() => { setPeriodRule(rule); if (error?.field === 'dates') setError(null); }} />
            ))}
          </View>
        )}
        {!overall && periodRule === 'custom' ? (
          <>
            <View style={styles.row}>
              <TextInput ref={fromRef} testID="budget-from" accessibilityLabel={b.from} placeholder={b.from} placeholderTextColor={theme.color('on-glass-secondary')} value={from} onChangeText={(t) => { setFrom(t); if (error?.field === 'dates') setError(null); }} style={[...input(error?.field === 'dates'), styles.half]} />
              <TextInput testID="budget-to" accessibilityLabel={b.to} placeholder={b.to} placeholderTextColor={theme.color('on-glass-secondary')} value={to} onChangeText={(t) => { setTo(t); if (error?.field === 'dates') setError(null); }} style={[...input(error?.field === 'dates'), styles.half]} />
            </View>
            <Text style={[textStyle('caption'), muted]}>{b.dateHint}</Text>
            {errorText('dates')}
          </>
        ) : null}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.limit}</Text>
        <TextInput
          ref={limitRef}
          testID="budget-limit"
          accessibilityLabel={b.limit}
          keyboardType="decimal-pad"
          value={limit}
          onChangeText={(t) => { setLimit(t); if (error?.field === 'limit') setError(null); }}
          style={input(error?.field === 'limit')}
        />
        {errorText('limit')}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.alertAt}</Text>
        <View style={styles.row}>
          {ALERT_LEVELS.map((l) => (
            <Chip key={l} onGlass label={`${l}%`} testID={`budget-alert-${l}`} selected={levels.includes(l)} onPress={() => setLevels((cur) => toggle(cur, l))} />
          ))}
        </View>
        {errorText('form')}
      </ScrollView>
      <Button label={b.save} testID="budget-save" onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 460 },
  gap: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  half: { flex: 1, minWidth: 140 },
});
