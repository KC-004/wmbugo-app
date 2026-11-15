import { useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseAmountInput, isLocalDate, type BillKind, type BillRule, type Cadence, type CategoryRow, type CustomUnit, type SaveRecurringRuleInput } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import type { SaveBillOutcome } from './billsApi';
import { KIND_LABEL } from './billText';

const b = copy.bills;

/** Add a bill (optionally pre-filled, as the Plan setup card does for Rent) or edit one. */
export type BillSheetMode = { readonly mode: 'add'; readonly prefill?: { readonly title?: string; readonly kind?: BillKind } } | { readonly mode: 'edit'; readonly rule: BillRule };

export interface BillPickers {
  readonly exponent: number;
  readonly categories: readonly CategoryRow[];
  readonly accounts: readonly { id: string; name: string }[];
  /** Notifications are off for wmbugo: the Remind me setting is kept but nothing is scheduled. */
  readonly notificationsDenied?: boolean;
}

type Field = 'name' | 'amount' | 'date' | 'end' | 'custom' | 'form';

/** The category a kind starts with (chosen by hand, nothing is suggested): Rent to Housing, EMI and Utility to Bills & Utilities, Subscription to Entertainment, Other to Other. */
export const DEFAULT_CATEGORY_NAME: Readonly<Record<BillKind, string>> = { rent: 'Housing', emi: 'Bills & Utilities', utility: 'Bills & Utilities', subscription: 'Entertainment', other: 'Other' };

const categoryFor = (kind: BillKind, cats: readonly CategoryRow[]): string | null => cats.find((c) => c.parentId === null && c.name === DEFAULT_CATEGORY_NAME[kind])?.id ?? null;

const focusNode = (ref: { current: unknown }) => {
  const node = findNodeHandle(ref.current as never);
  if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 50);
};

/**
 * The bill editor (Story 6.2): Name, Amount, Repeats, Next due, From account, Category, Kind, Paid to and Ends. Nothing is
 * written until Save; an error keeps every input and moves focus to the field. Saving never creates an entry.
 */
export function BillSheet({ start, pickers, onSave, close }: { start: BillSheetMode; pickers: BillPickers; onSave: (input: SaveRecurringRuleInput) => Promise<SaveBillOutcome>; close: () => void }) {
  const theme = useTheme();
  const rule = start.mode === 'edit' ? start.rule : null;
  const prefill = start.mode === 'add' ? start.prefill : undefined;
  const firstKind: BillKind = rule?.kind ?? prefill?.kind ?? 'other';
  const [title, setTitle] = useState(rule?.title ?? prefill?.title ?? '');
  const [amount, setAmount] = useState(rule ? minorToInput(rule.expectedAmountMinor, pickers.exponent) : '');
  const [cadence, setCadence] = useState<Cadence>(rule?.cadence ?? 'monthly');
  const [every, setEvery] = useState(rule?.customEvery ? String(rule.customEvery) : '');
  const [unit, setUnit] = useState<CustomUnit>(rule?.customUnit ?? 'days');
  const [due, setDue] = useState(rule?.anchorDate ?? '');
  const [accountId, setAccountId] = useState<string | null>(rule ? rule.accountId : (pickers.accounts[0]?.id ?? null));
  const [kind, setKind] = useState<BillKind>(firstKind);
  const [categoryId, setCategoryId] = useState<string | null>(rule ? rule.categoryId : categoryFor(firstKind, pickers.categories));
  const [paidTo, setPaidTo] = useState(rule?.paidTo ?? '');
  const [ends, setEnds] = useState<'never' | 'date'>(rule?.endsOn ? 'date' : 'never');
  const [endsOn, setEndsOn] = useState(rule?.endsOn ?? '');
  const [remind, setRemind] = useState<0 | 1 | 3 | null>(rule ? (rule.remindDays as 0 | 1 | 3 | null) : 1);
  const [error, setError] = useState<{ field: Field; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const amountRef = useRef<ComponentRef<typeof TextInput>>(null);
  const dueRef = useRef<ComponentRef<typeof TextInput>>(null);
  const endRef = useRef<ComponentRef<typeof TextInput>>(null);
  const everyRef = useRef<ComponentRef<typeof TextInput>>(null);
  const errRef = useRef<ComponentRef<typeof View>>(null);
  const ink = { color: theme.color('on-glass-primary') };
  const muted = { color: theme.color('on-glass-secondary') };

  const fail = (field: Field, text: string) => {
    setError({ field, text });
    const target = field === 'name' ? nameRef : field === 'amount' ? amountRef : field === 'date' ? dueRef : field === 'end' ? endRef : field === 'custom' ? everyRef : null;
    if (target) target.current?.focus();
    else focusNode(errRef);
  };
  const clear = (f: Field) => {
    if (error?.field === f) setError(null);
  };

  const chooseKind = (k: BillKind) => {
    setKind(k);
    // A new kind pre-selects its category, which can still be changed.
    const c = categoryFor(k, pickers.categories);
    if (c) setCategoryId(c);
  };

  const submit = async () => {
    if (busy) return;
    if (title.trim() === '') return fail('name', b.errName);
    const parsed = parseAmountInput(amount, pickers.exponent);
    if (!parsed.ok || parsed.value <= 0) return fail('amount', b.errAmount);
    const n = Number(every);
    if (cadence === 'custom' && !(Number.isInteger(n) && n >= 1 && n <= 99)) return fail('custom', b.errCustom);
    if (due.trim() === '' || !isLocalDate(due.trim())) return fail('date', b.errDate);
    const endDate = ends === 'date' ? endsOn.trim() : null;
    if (endDate !== null && (endDate === '' || !isLocalDate(endDate) || endDate < due.trim())) return fail('end', b.errEnd);
    setError(null);
    setBusy(true);
    let r: SaveBillOutcome;
    try {
      r = await onSave({
        ...(rule ? { id: rule.id } : {}),
        title: title.trim(),
        expectedAmountMinor: parsed.value,
        cadence,
        ...(cadence === 'custom' ? { customEvery: n, customUnit: unit } : {}),
        anchorDate: due.trim(),
        accountId,
        categoryId,
        kind,
        paidTo: paidTo.trim() === '' ? null : paidTo.trim(),
        endsOn: endDate,
        remindDays: remind,
      });
    } catch {
      r = { ok: false, code: 'WRITE_FAILED' };
    } finally {
      setBusy(false);
    }
    if (r.ok) return close();
    if (r.code === 'TITLE_REQUIRED') return fail('name', b.errName);
    if (r.code === 'AMOUNT_REQUIRED') return fail('amount', b.errAmount);
    if (r.code === 'DATE_REQUIRED' || r.code === 'DATE_INVALID') return fail('date', b.errDate);
    if (r.code === 'END_BEFORE_START') return fail('end', b.errEnd);
    if (r.code === 'CADENCE_INVALID') return fail('custom', b.errCustom);
    setError({ field: 'form', text: b.saveFailed });
  };

  const errorText = (f: Field) =>
    error?.field === f ? (
      <Text testID={`bill-error-${f}`} accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>
        {error.text}
      </Text>
    ) : null;
  const input = (invalid: boolean) => [styles.input, textStyle('body'), ink, { borderColor: invalid ? theme.color('semantic-warning') : theme.color('on-glass-secondary') }];
  const cadences: readonly (readonly [Cadence, string])[] = [['weekly', b.weekly], ['monthly', b.monthly], ['quarterly', b.quarterly], ['annual', b.yearly], ['custom', b.custom]];
  const kinds: readonly BillKind[] = ['subscription', 'rent', 'emi', 'utility', 'other'];
  const tops = pickers.categories.filter((c) => c.parentId === null);

  return (
    <View testID="bill-sheet" style={styles.root}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.gap}>
        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.name}</Text>
        <TextInput ref={nameRef} testID="bill-name" accessibilityLabel={b.name} value={title} onChangeText={(t) => { setTitle(t); clear('name'); }} style={input(error?.field === 'name')} />
        {errorText('name')}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.amount}</Text>
        <TextInput ref={amountRef} testID="bill-amount" accessibilityLabel={b.amount} keyboardType="decimal-pad" value={amount} onChangeText={(t) => { setAmount(t); clear('amount'); }} style={input(error?.field === 'amount')} />
        <Text style={[textStyle('caption'), muted]}>{b.amountCaption}</Text>
        {errorText('amount')}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.repeats}</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.repeats}>
          {cadences.map(([c, label]) => (
            <Chip key={c} onGlass role="radio" label={label} testID={`bill-cadence-${c}`} selected={cadence === c} onPress={() => { setCadence(c); clear('custom'); }} />
          ))}
        </View>
        {cadence === 'custom' ? (
          <>
            <View style={styles.row}>
              <Text style={[textStyle('body'), ink, styles.every]}>{b.every}</Text>
              <TextInput ref={everyRef} testID="bill-every" accessibilityLabel={b.every} keyboardType="number-pad" value={every} onChangeText={(t) => { setEvery(t); clear('custom'); }} style={[...input(error?.field === 'custom'), styles.small]} />
              {(['days', 'weeks', 'months'] as const).map((u) => (
                <Chip key={u} onGlass role="radio" label={u === 'days' ? b.days : u === 'weeks' ? b.weeks : b.months} testID={`bill-unit-${u}`} selected={unit === u} onPress={() => setUnit(u)} />
              ))}
            </View>
            {errorText('custom')}
          </>
        ) : null}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.nextDue}</Text>
        <TextInput ref={dueRef} testID="bill-due" accessibilityLabel={b.nextDue} placeholder={b.dateHint} placeholderTextColor={theme.color('on-glass-secondary')} value={due} onChangeText={(t) => { setDue(t); clear('date'); clear('end'); }} style={input(error?.field === 'date')} />
        {errorText('date')}

        {pickers.accounts.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.fromAccount}</Text>
            <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.fromAccount}>
              {pickers.accounts.map((a) => (
                <Chip key={a.id} onGlass role="radio" variant="account" label={a.name} testID={`bill-account-${a.id}`} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
              ))}
            </View>
          </>
        ) : null}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.kind}</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.kind}>
          {kinds.map((k) => (
            <Chip key={k} onGlass role="radio" label={KIND_LABEL[k]} testID={`bill-kind-${k}`} selected={kind === k} onPress={() => chooseKind(k)} />
          ))}
        </View>

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.category}</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.category}>
          {tops.map((c) => (
            <Chip key={c.id} onGlass role="radio" label={c.name} testID={`bill-category-${c.id}`} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
          ))}
        </View>

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.paidTo}</Text>
        <TextInput testID="bill-paid-to" accessibilityLabel={b.paidTo} value={paidTo} onChangeText={setPaidTo} style={input(false)} />
        <Text style={[textStyle('caption'), muted]}>{b.paidToCaption}</Text>

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.remindMe}</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.remindMe}>
          {([[null, b.remindOff], [0, b.remindDay], [1, b.remindOne], [3, b.remindThree]] as const).map(([v, label]) => (
            <Chip key={String(v)} onGlass role="radio" label={label} testID={`bill-remind-${v === null ? 'off' : v}`} selected={remind === v} onPress={() => setRemind(v)} />
          ))}
        </View>
        <Text style={[textStyle('caption'), muted]}>{b.remindCaption}</Text>
        {pickers.notificationsDenied && remind !== null ? (
          <View style={styles.row}>
            <Text testID="bill-notif-off" style={[textStyle('caption'), ink]}>{b.notifOff}</Text>
            <Button label={b.openSettings} variant="text" onGlass testID="bill-open-settings" onPress={() => void Linking.openSettings().catch(() => undefined)} />
          </View>
        ) : null}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{b.ends}</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={b.ends}>
          <Chip onGlass role="radio" label={b.endsNever} testID="bill-ends-never" selected={ends === 'never'} onPress={() => { setEnds('never'); clear('end'); }} />
          <Chip onGlass role="radio" label={b.endsOn} testID="bill-ends-date" selected={ends === 'date'} onPress={() => setEnds('date')} />
        </View>
        {ends === 'date' ? <TextInput ref={endRef} testID="bill-ends-on" accessibilityLabel={b.endsOn} placeholder={b.dateHint} placeholderTextColor={theme.color('on-glass-secondary')} value={endsOn} onChangeText={(t) => { setEndsOn(t); clear('end'); }} style={input(error?.field === 'end')} /> : null}
        {errorText('end')}
        <View ref={errRef} accessible={error?.field === 'form'}>{errorText('form')}</View>
      </ScrollView>
      <Button label={b.save} testID="bill-save" onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 460 },
  gap: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  small: { width: 72 },
  every: { minWidth: 40 },
});
