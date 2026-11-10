import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check } from 'phosphor-react-native';
import { CATEGORY_COLOURS, CATEGORY_NAME_MAX, parseKindInUse, UNCATEGORISED_ID, type BudgetType, type CategoryKind, type CategoryRow } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { categoryIcon, searchIcons } from '../add/categoryIcons';
import type { SaveOutcome } from './categoriesApi';

export type CategorySheetMode = { readonly mode: 'add'; readonly kind: CategoryKind } | { readonly mode: 'edit'; readonly row: CategoryRow };

function kindInUseText(side: 'income' | 'spending', n: number): string {
  const c = copy.categories;
  if (side === 'income') return n === 1 ? c.inUseIncomeOne : c.inUseIncomeMany.replace('{n}', String(n));
  return n === 1 ? c.inUseSpendingOne : c.inUseSpendingMany.replace('{n}', String(n));
}

/** `cat-olive` is read as "Olive". */
export const colourName = (token: string): string => token.replace(/^cat-/, '').replace(/^./, (c) => c.toUpperCase());

type FieldError = { readonly field: 'name'; readonly text: string } | { readonly field: 'form'; readonly text: string };

/**
 * Add or edit a category: Name (focused, 30 characters), Icon (searchable grid), Colour (the 12 palette swatches, no
 * free colour), Type (Need / Want / Not set) and, when adding a spending category, Subcategory of. A subcategory starts
 * with its parent's colour and type, both editable. Nothing is written until Save; an error keeps everything typed.
 */
export function CategorySheet({
  start,
  categories,
  onSave,
  close,
}: {
  start: CategorySheetMode;
  categories: readonly CategoryRow[];
  onSave: (input: { id?: string; name: string; kind: CategoryKind; icon: string; colour: string; budgetType: BudgetType | null; parentId: string | null }) => Promise<SaveOutcome>;
  close: () => void;
}) {
  const theme = useTheme();
  const editing = start.mode === 'edit' ? start.row : null;
  const [usedFor, setUsedFor] = useState<CategoryKind>(editing ? editing.kind : start.mode === 'add' ? start.kind : 'expense');
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? 'DotsThree');
  const [colour, setColour] = useState(editing?.colorToken ?? 'cat-sky');
  const [type, setType] = useState<BudgetType | null>(editing?.budgetType ?? null);
  const [parentId, setParentId] = useState<string | null>(editing?.parentId ?? null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const ink = { color: theme.color('on-glass-primary') };
  const checkInk = theme.scheme === 'dark' ? theme.color('bg-canvas') : theme.color('bg-surface');
  const muted = { color: theme.color('on-glass-secondary') };

  const parents = useMemo(() => categories.filter((c) => c.kind === 'expense' && c.parentId === null && c.id !== UNCATEGORISED_ID), [categories]);
  const icons = useMemo(() => searchIcons(query), [query]);
  // A subcategory (existing, or being added under a parent) follows its parent's kind and has no Used for of its own.
  const isSub = editing ? editing.parentId !== null : parentId !== null;
  const kind: CategoryKind = usedFor;
  const isSpending = kind !== 'income';
  const canPickParent = isSpending && editing === null;

  const pickParent = (id: string | null) => {
    setParentId(id);
    const parent = parents.find((p) => p.id === id);
    if (parent) {
      setColour(parent.colorToken);
      setType(parent.budgetType);
    }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    let r: SaveOutcome;
    try {
      r = await onSave({ ...(editing ? { id: editing.id } : {}), name, kind, icon, colour, budgetType: isSpending ? type : null, parentId });
    } catch {
      r = { ok: false, code: 'WRITE_FAILED' };
    } finally {
      setBusy(false);
    }
    if (r.ok) {
      close();
      return;
    }
    const trimmed = name.trim();
    const inUse = parseKindInUse(r.code);
    if (r.code === 'NAME_REQUIRED') setError({ field: 'name', text: copy.categories.nameRequired });
    else if (r.code === 'NAME_TOO_LONG') setError({ field: 'name', text: copy.categories.nameTooLong });
    else if (r.code === 'NAME_TAKEN') setError({ field: 'name', text: copy.categories.nameTaken.replace('{name}', trimmed) });
    else if (inUse) setError({ field: 'form', text: kindInUseText(inUse.side, inUse.count) });
    else setError({ field: 'form', text: `${copy.categories.saveFailed} ${copy.errors.nothingSaved}` });
    if (r.code === 'NAME_REQUIRED' || r.code === 'NAME_TOO_LONG' || r.code === 'NAME_TAKEN') nameRef.current?.focus();
  };

  return (
    <View testID="category-sheet" style={styles.root}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.gap}>
        <Text style={[textStyle('label'), ink]}>{copy.categories.name}</Text>
        <TextInput
          ref={nameRef}
          testID="category-name"
          autoFocus
          accessibilityLabel={copy.categories.name}
          value={name}
          maxLength={CATEGORY_NAME_MAX}
          onChangeText={(t) => {
            setName(t);
            if (error?.field === 'name') setError(null);
          }}
          style={[styles.input, textStyle('body'), ink, { borderColor: error?.field === 'name' ? theme.color('semantic-warning') : theme.color('on-glass-secondary') }]}
        />
        {error ? (
          <Text testID="category-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>
            {error.text}
          </Text>
        ) : null}

        {isSub ? null : (
          <>
            <Text style={[textStyle('label'), ink]}>{copy.categories.usedFor}</Text>
            <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={copy.categories.usedFor}>
              <Chip onGlass role="radio" label={copy.categories.usedSpending} testID="category-used-expense" selected={usedFor === 'expense'} onPress={() => { setUsedFor('expense'); setError(null); }} />
              <Chip onGlass role="radio" label={copy.categories.usedIncome} testID="category-used-income" selected={usedFor === 'income'} onPress={() => { setUsedFor('income'); setType(null); setParentId(null); setError(null); }} />
              <Chip onGlass role="radio" label={copy.categories.usedBoth} testID="category-used-mixed" selected={usedFor === 'mixed'} onPress={() => { setUsedFor('mixed'); setError(null); }} />
            </View>
          </>
        )}

        <Text style={[textStyle('label'), ink]}>{copy.categories.icon}</Text>
        <TextInput
          testID="category-icon-search"
          accessibilityLabel={copy.categories.iconSearch}
          placeholder={copy.categories.iconSearch}
          placeholderTextColor={theme.color('on-glass-secondary')}
          value={query}
          onChangeText={setQuery}
          style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]}
        />
        <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={copy.categories.icon}>
          {icons.map((i) => (
            <Pressable
              key={i.name}
              testID={`category-icon-${i.name}`}
              {...controlA11y({ label: i.name.replace(/([a-z])([A-Z])/g, '$1 $2'), role: 'radio', selected: icon === i.name })}
              onPress={() => setIcon(i.name)}
              style={[styles.cell, { borderColor: icon === i.name ? theme.color('accent-primary') : theme.color('on-glass-secondary'), borderWidth: icon === i.name ? 2 : 1 }]}>
              <Icon icon={categoryIcon(i.name)} size={24} selected={icon === i.name} color="on-glass-primary" />
            </Pressable>
          ))}
          {icons.length === 0 ? <Text style={[textStyle('caption'), muted]}>{copy.categories.iconNone}</Text> : null}
        </View>

        <Text style={[textStyle('label'), ink]}>{copy.categories.colour}</Text>
        <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={copy.categories.colour}>
          {CATEGORY_COLOURS.map((c) => (
            <Pressable
              key={c}
              testID={`category-colour-${c}`}
              {...controlA11y({ label: colourName(c), role: 'radio', selected: colour === c })}
              onPress={() => setColour(c)}
              style={[styles.swatch, { backgroundColor: theme.color(c as ColorName), borderColor: colour === c ? theme.color('on-glass-primary') : 'transparent' }]}>
              {colour === c ? <Icon icon={Check} size={22} tint={checkInk} /> : null}
            </Pressable>
          ))}
        </View>

        {isSpending ? (
          <>
            <Text style={[textStyle('label'), ink]}>{copy.categories.type}</Text>
            <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={copy.categories.type}>
              <Chip onGlass role="radio" label={copy.categories.need} testID="category-type-need" selected={type === 'need'} onPress={() => setType('need')} />
              <Chip onGlass role="radio" label={copy.categories.want} testID="category-type-want" selected={type === 'want'} onPress={() => setType('want')} />
              <Chip onGlass role="radio" label={copy.categories.notSet} testID="category-type-none" selected={type === null} onPress={() => setType(null)} />
            </View>
            {type === null ? <Text style={[textStyle('caption'), muted]}>{copy.categories.typeHint}</Text> : null}
          </>
        ) : null}

        {canPickParent ? (
          <>
            <Text style={[textStyle('label'), ink]}>{copy.categories.subOf}</Text>
            <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={copy.categories.subOf}>
              <Chip onGlass role="radio" label={copy.categories.noParent} testID="category-parent-none" selected={parentId === null} onPress={() => pickParent(null)} />
              {parents.map((p) => (
                <Chip onGlass role="radio" key={p.id} label={p.name} testID={`category-parent-${p.id}`} selected={parentId === p.id} onPress={() => pickParent(p.id)} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
      <Button label={copy.categories.save} testID="category-save" onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 420 },
  gap: { gap: 8, paddingBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: layout.touchMin, height: layout.touchMin, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: layout.touchMin, height: layout.touchMin, borderRadius: layout.touchMin / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
