import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check } from 'phosphor-react-native';
import { CATEGORY_COLOURS, GOAL_NAME_MAX, parseAmountInput, type GoalRow, type SaveGoalInput } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { categoryIcon, searchIcons } from '../add/categoryIcons';
import { colourName } from '../categories/CategorySheet';
import type { SaveGoalOutcome } from './goalsApi';

const g = copy.goals;

type Field = 'name' | 'amount' | 'date' | 'form';

/** Add or edit a goal: Name, Target amount, By (month and year, optional), Icon, Colour (the 12 swatches) and an optional savings account. */
export function GoalSheet({
  goal,
  exponent,
  accounts,
  thisMonth,
  onSave,
  close,
}: {
  goal: GoalRow | null;
  exponent: number;
  accounts: readonly { id: string; name: string; isPot?: boolean }[];
  /** The profile's current month, `YYYY-MM`: the earliest month `By` accepts. */
  thisMonth: string;
  onSave: (input: SaveGoalInput) => Promise<SaveGoalOutcome>;
  close: () => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState(goal?.name ?? '');
  const [amount, setAmount] = useState(goal ? minorToInput(goal.targetMinor, exponent) : '');
  const [by, setBy] = useState(goal?.dueDate ? goal.dueDate.slice(0, 7) : '');
  const [icon, setIcon] = useState(goal?.icon ?? 'PiggyBank');
  const [colour, setColour] = useState(goal?.color ?? 'cat-cyan');
  const [accountId, setAccountId] = useState<string | null>(goal?.accountId ?? null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<{ field: Field; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const amountRef = useRef<ComponentRef<typeof TextInput>>(null);
  const byRef = useRef<ComponentRef<typeof TextInput>>(null);
  const ink = { color: theme.color('on-glass-primary') };
  const checkInk = theme.scheme === 'dark' ? theme.color('bg-canvas') : theme.color('bg-surface');
  const icons = useMemo(() => searchIcons(query), [query]);

  const fail = (field: Field, text: string) => {
    setError({ field, text });
    (field === 'name' ? nameRef : field === 'amount' ? amountRef : field === 'date' ? byRef : null)?.current?.focus();
  };
  const clear = (f: Field) => {
    if (error?.field === f) setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (name.trim() === '') return fail('name', g.errName);
    const parsed = parseAmountInput(amount, exponent);
    if (!parsed.ok || parsed.value <= 0) return fail('amount', g.errAmount);
    const month = by.trim();
    const monthOk = month === '' || (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && (month >= thisMonth || (goal?.dueDate?.slice(0, 7) === month)));
    if (!monthOk) return fail('date', g.errDate);
    setError(null);
    setBusy(true);
    let r: SaveGoalOutcome;
    try {
      r = await onSave({ ...(goal ? { id: goal.id } : {}), name: name.trim(), targetMinor: parsed.value, dueMonth: month === '' ? null : month, icon, color: colour, accountId });
    } catch {
      r = { ok: false, code: 'WRITE_FAILED' };
    } finally {
      setBusy(false);
    }
    if (r.ok) return close();
    if (r.code === 'NAME_REQUIRED') return fail('name', g.errName);
    if (r.code === 'AMOUNT_REQUIRED') return fail('amount', g.errAmount);
    if (r.code === 'DATE_PAST' || r.code === 'DATE_INVALID') return fail('date', g.errDate);
    setError({ field: 'form', text: g.saveFailed });
  };

  const errorText = (f: Field) =>
    error?.field === f ? (
      <Text testID={`goal-error-${f}`} accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>
        {error.text}
      </Text>
    ) : null;
  const input = (invalid: boolean) => [styles.input, textStyle('body'), ink, { borderColor: invalid ? theme.color('semantic-warning') : theme.color('on-glass-secondary') }];

  return (
    <View testID="goal-sheet" style={styles.root}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.gap}>
        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{g.name}</Text>
        <TextInput ref={nameRef} testID="goal-name" accessibilityLabel={g.name} maxLength={GOAL_NAME_MAX} value={name} onChangeText={(t) => { setName(t); clear('name'); }} style={input(error?.field === 'name')} />
        {errorText('name')}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{g.target}</Text>
        <TextInput ref={amountRef} testID="goal-amount" accessibilityLabel={g.target} keyboardType="decimal-pad" value={amount} onChangeText={(t) => { setAmount(t); clear('amount'); }} style={input(error?.field === 'amount')} />
        {errorText('amount')}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{g.by}</Text>
        <TextInput ref={byRef} testID="goal-by" accessibilityLabel={g.by} placeholder={g.byHint} placeholderTextColor={theme.color('on-glass-secondary')} value={by} onChangeText={(t) => { setBy(t); clear('date'); }} style={input(error?.field === 'date')} />
        {errorText('date')}

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{g.icon}</Text>
        <TextInput testID="goal-icon-search" accessibilityLabel={copy.categories.iconSearch} placeholder={copy.categories.iconSearch} placeholderTextColor={theme.color('on-glass-secondary')} value={query} onChangeText={setQuery} style={input(false)} />
        <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={g.icon}>
          {icons.map((i) => (
            <Pressable
              key={i.name}
              testID={`goal-icon-${i.name}`}
              {...controlA11y({ label: i.name.replace(/([a-z])([A-Z])/g, '$1 $2'), role: 'radio', selected: icon === i.name })}
              onPress={() => setIcon(i.name)}
              style={[styles.cell, { borderColor: icon === i.name ? theme.color('accent-primary') : theme.color('on-glass-secondary'), borderWidth: icon === i.name ? 2 : 1 }]}>
              <Icon icon={categoryIcon(i.name)} size={24} selected={icon === i.name} color="on-glass-primary" />
            </Pressable>
          ))}
        </View>

        <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{g.colour}</Text>
        <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={g.colour}>
          {CATEGORY_COLOURS.map((c) => (
            <Pressable
              key={c}
              testID={`goal-colour-${c}`}
              {...controlA11y({ label: colourName(c), role: 'radio', selected: colour === c })}
              onPress={() => setColour(c)}
              style={[styles.swatch, { backgroundColor: theme.color(c as ColorName), borderColor: colour === c ? theme.color('on-glass-primary') : 'transparent' }]}>
              {colour === c ? <Icon icon={Check} size={22} tint={checkInk} /> : null}
            </Pressable>
          ))}
        </View>

        {accounts.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{g.account}</Text>
            <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={g.account}>
              <Chip onGlass role="radio" label={g.noAccount} testID="goal-account-none" selected={accountId === null} onPress={() => setAccountId(null)} />
              {accounts.map((a) => (
                <Chip key={a.id} onGlass role="radio" variant="account" label={a.name} testID={`goal-account-${a.id}`} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
              ))}
            </View>
          </>
        ) : null}
        {errorText('form')}
      </ScrollView>
      <Button label={g.save} testID="goal-save" onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 460 },
  gap: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
