import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { adjustmentDelta, ADJUST_REASONS, parseAmountInput, type AccountType, type AdjustReason, type CurrencyCode } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';

/**
 * Adjust balance: "what does this account really hold today?" with a live preview of the difference, a required
 * reason, and a short note for Other. Writes through \`onSave\`; the screen owns Undo and the refresh.
 */
export function AdjustBalancePanel({
  type,
  currentMinor,
  exponent,
  currency,
  locale,
  onSave,
  onCancel,
}: {
  type: AccountType;
  /** The ledger balance now (signed; a card owing money is negative). */
  currentMinor: number;
  exponent: number;
  currency: CurrencyCode;
  locale: string;
  onSave: (input: { actualMinor: number; reason: AdjustReason; note: string }) => Promise<{ ok: boolean; code?: string }>;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [reason, setReason] = useState<AdjustReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const card = type === 'card';
  const label = card ? copy.adjust.owedLabel : copy.adjust.actualLabel;
  const ink = { color: theme.color('text-primary') };

  const parsed = text.trim() === '' ? null : parseAmountInput(text, exponent);
  const delta = parsed && parsed.ok ? adjustmentDelta(type, currentMinor, parsed.value) : null;
  // A card reads "You owe X more" (its balance goes more negative); an asset reads "Adjust up by X".
  const [lead, tail] = card ? (delta !== null && delta < 0 ? copy.adjust.cardMore : copy.adjust.cardLess).split('{amount}') : [delta !== null && delta > 0 ? copy.adjust.up : copy.adjust.down, ''];

  const save = async () => {
    if (busy.current) return;
    if (!parsed) return setError(copy.accountDetail.amountRequired);
    if (!parsed.ok) return setError(parsed.code === 'EXCESS_DECIMALS' ? copy.accounts.balanceExcess : parsed.code === 'AMOUNT_TOO_LARGE' ? copy.accounts.balanceTooLarge : copy.accounts.balanceInvalid);
    if (delta === 0) return setError(copy.adjust.matches);
    if (!reason) return setError(copy.adjust.reasonRequired);
    busy.current = true;
    try {
      const r = await onSave({ actualMinor: parsed.value, reason, note });
      if (!r.ok) setError(r.code === 'NO_CHANGE' ? copy.adjust.matches : copy.accountDetail.saveError);
    } catch {
      setError(copy.accountDetail.saveError);
    } finally {
      busy.current = false;
    }
  };

  return (
    <View testID="adjust-panel" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body-medium'), ink]}>{label}</Text>
      <TextInput
        testID="adjust-input"
        accessibilityLabel={label}
        accessibilityHint={copy.accounts.roughIsFine}
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        keyboardType="decimal-pad"
        autoFocus
        style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('border-control') }]}
      />

      {delta !== null ? (
        delta === 0 ? (
          <Text testID="adjust-preview" accessibilityLiveRegion="polite" style={[textStyle('body'), ink]}>{copy.adjust.matches}</Text>
        ) : (
          <View testID="adjust-preview" accessibilityLiveRegion="polite" style={styles.inline}>
            <Text style={[textStyle('body'), ink]}>{lead}</Text>
            <Amount amountMinor={Math.abs(delta)} currency={currency} direction="neutral" locale={locale} />
            {tail ? <Text style={[textStyle('body'), ink]}>{tail}</Text> : null}
          </View>
        )
      ) : null}

      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.adjust.reason}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={copy.adjust.reason} style={styles.chips}>
        {ADJUST_REASONS.map((r) => (
          <Chip
            key={r.id}
            testID={`adjust-reason-${r.id}`}
            label={r.label}
            selected={reason === r.id}
            onPress={() => {
              setReason(r.id);
              setError(null);
            }}
          />
        ))}
      </View>
      {reason === 'other' ? (
        <TextInput
          testID="adjust-note"
          accessibilityLabel={copy.adjust.note}
          placeholder={copy.adjust.note}
          placeholderTextColor={theme.color('text-secondary')}
          value={note}
          maxLength={200}
          onChangeText={setNote}
          style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('border-control') }]}
        />
      ) : null}

      {error ? (
        <Text testID="adjust-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
          {error}
        </Text>
      ) : null}
      <View style={styles.inline}>
        <Button label={copy.adjust.save} onPress={() => void save()} testID="adjust-save" />
        <Button label={copy.common.cancel} variant="text" onPress={onCancel} testID="adjust-cancel" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
