import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Warning } from 'phosphor-react-native';
import { leftToAssign, parseAmountInput, type CurrencyCode, type SplitRow } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';

export interface SplitCategory {
  readonly id: string;
  readonly name: string;
}

export interface SplitStart {
  readonly transactionId: string;
  /** What the rows must add up to (the new amount when it is being changed). */
  readonly totalMinor: number;
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly locale: string;
  readonly categories: readonly SplitCategory[];
  /** The rows to start from; a single row with no amount for an entry that is not split yet. */
  readonly rows: readonly { categoryId: string; amountMinor: number | null; notItemised?: boolean }[];
}

interface Row {
  key: number;
  categoryId: string;
  text: string;
  notItemised: boolean;
}

/**
 * The split editor (Story 3.7): rows of a category and an amount, "Left to assign" as a polite live region (announced
 * after 500 ms of quiet), Fill for the remainder, and Save only when the rows add up exactly. Nothing is ever balanced
 * automatically. A "Not itemised" row (from a receipt) is grey and counts as assigned.
 */
export function SplitSheet({
  start,
  onSave,
  close,
}: {
  start: SplitStart;
  onSave: (rows: SplitRow[]) => Promise<{ ok: boolean; code?: string }>;
  close: () => void;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // The rows scroll in what is left above the keyboard (the sheet title, the remainder and Save stay in view).
  const rowsMax = Math.max(140, height - keyboard - insets.top - insets.bottom - 280);
  const keyRef = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    start.rows.map((r) => ({ key: keyRef.current++, categoryId: r.categoryId, text: r.amountMinor === null ? '' : minorToInput(r.amountMinor, start.exponent), notItemised: r.notItemised === true })),
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const ink = { color: theme.color('on-glass-primary') };
  const muted = { color: theme.color('on-glass-secondary') };

  const amounts = rows.map((r) => {
    if (r.text.trim() === '') return 0;
    const p = parseAmountInput(r.text, start.exponent);
    return p.ok ? p.value : 0;
  });
  const left = leftToAssign(start.totalMinor, amounts);
  const nameOf = (id: string) => start.categories.find((c) => c.id === id)?.name ?? id;

  // "Left to assign" is read out once typing pauses.
  const [spoken, setSpoken] = useState(left);
  useEffect(() => {
    const h = setTimeout(() => setSpoken(left), 500);
    return () => clearTimeout(h);
  }, [left]);

  const target = focused !== null && rows[focused] ? focused : rows.length - 1;
  const fillTarget = rows[target];
  // Fill gives the remainder to the focused row (or the last one): its own amount plus what is left.
  const fillMinor = fillTarget ? (amounts[target] ?? 0) + left : 0;
  const canFill = left > 0 && !!fillTarget && !fillTarget.notItemised;

  const say = (minor: number) => amountLabel({ amountMinor: Math.abs(minor), currency: start.currency, locale: start.locale });
  const spokenLeft = `${copy.split.leftToAssign} ${spoken < 0 ? `${say(spoken)} ${copy.split.tooMuch.toLowerCase()}` : say(spoken)}`;
  const fillLabel = canFill ? copy.split.fillLabel.replace('{amount}', say(left)).replace('{category}', nameOf(fillTarget!.categoryId)) : copy.split.fill;

  const save = async () => {
    if (busy.current || left !== 0) return;
    busy.current = true;
    try {
      const out: SplitRow[] = rows.map((r, i) => ({ categoryId: r.categoryId, amountMinor: amounts[i]!, ...(r.notItemised ? { memo: 'not_itemised' } : {}) }));
      if (out.some((r) => r.amountMinor <= 0)) {
        setError(copy.split.amountRequired);
        return;
      }
      const r = await onSave(out);
      if (r.ok) close();
      else setError(r.code === 'ENTRY_REMOVED' ? copy.detail.removedError : copy.split.saveError);
    } catch {
      setError(copy.split.saveError);
    } finally {
      busy.current = false;
    }
  };

  return (
    <View testID="split-sheet">
      <View testID="left-to-assign" accessible accessibilityLiveRegion="polite" accessibilityLabel={spokenLeft} style={styles.inline}>
        <Text style={[textStyle('body-medium'), ink]}>{copy.split.leftToAssign}</Text>
        <Amount amountMinor={Math.max(0, left)} currency={start.currency} direction="neutral" locale={start.locale} color="on-glass-primary" />
        {left < 0 ? (
          <View testID="too-much" style={styles.inline}>
            <Icon icon={Warning} size={18} color="on-glass-accent" />
            <Amount amountMinor={-left} currency={start.currency} direction="neutral" locale={start.locale} color="on-glass-accent" />
            <Text style={[textStyle('body-medium'), ink]}>{copy.split.tooMuch.toLowerCase()}</Text>
          </View>
        ) : null}
      </View>
      <ScrollView style={[styles.scroll, { maxHeight: rowsMax }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {rows.map((r, i) => (
          <View key={r.key} testID={`split-row-${i}`} style={[styles.row, r.notItemised ? styles.greyRow : null]}>
            {r.notItemised ? (
              <Text style={[textStyle('body-medium'), muted]}>{copy.split.notItemised}</Text>
            ) : (
              <Chip onGlass label={nameOf(r.categoryId)} variant="quick-category" testID={`split-category-${i}`} selected hint={copy.split.chooseCategory} onPress={() => setPicking(picking === i ? null : i)} />
            )}
            <TextInput
              testID={`split-amount-${i}`}
              accessibilityLabel={`${copy.add.amountLabel} ${i + 1}`}
              value={r.text}
              editable={!r.notItemised}
              keyboardType="decimal-pad"
              onFocus={() => setFocused(i)}
              onChangeText={(t) => {
                setError(null);
                setRows((all) => all.map((x) => (x.key === r.key ? { ...x, text: t } : x)));
              }}
              style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]}
            />
            {rows.length > 1 && !r.notItemised ? (
              <Button label={copy.split.removeRow} variant="text" onGlass testID={`split-remove-${i}`} onPress={() => { setRows((all) => all.filter((x) => x.key !== r.key)); setFocused(null); setPicking(null); }} />
            ) : null}
            {picking === i ? (
              <View style={styles.chips}>
                {start.categories.map((c) => (
                  <Chip
                    key={c.id}
                    onGlass
                    label={c.name}
                    variant="quick-category"
                    testID={`split-pick-${i}-${c.id}`}
                    selected={c.id === r.categoryId}
                    onPress={() => {
                      setRows((all) => all.map((x) => (x.key === r.key ? { ...x, categoryId: c.id } : x)));
                      setPicking(null);
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <View style={styles.inline}>
          <Button label={copy.split.addRow} variant="secondary-on-footer" testID="split-add-row" onPress={() => setRows((all) => [...all, { key: keyRef.current++, categoryId: start.categories.find((c) => !all.some((x) => x.categoryId === c.id))?.id ?? start.categories[0]!.id, text: '', notItemised: false }])} />
          <Pressable
            testID="split-fill"
            accessibilityRole="button"
            accessibilityLabel={fillLabel}
            accessibilityState={{ disabled: !canFill }}
            onPress={() => {
              if (!canFill) return;
              setRows((all) => all.map((x, i) => (i === target ? { ...x, text: minorToInput(fillMinor, start.exponent) } : x)));
              setSpoken(0);
            }}
            style={[styles.fill2, { borderColor: theme.color('on-glass-secondary'), opacity: canFill ? 1 : 0.5 }]}>
            <Text style={[textStyle('label'), ink]}>{copy.split.fill}</Text>
          </Pressable>
        </View>

        {error ? (
          <Text testID="split-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), ink]}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label={copy.split.save}
          testID="split-save"
          onPress={() => void save()}
          disabledReason={left !== 0 ? copy.split.assignHint.replace('{amount}', say(left)) : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 0 },
  content: { gap: 12, paddingVertical: 8 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4 },
  row: { gap: 8 },
  greyRow: { opacity: 0.7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  fill2: { minHeight: layout.touchMin, minWidth: layout.touchMin, paddingHorizontal: 16, borderWidth: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: 8 },
});
