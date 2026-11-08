import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ACCOUNT_TYPES, buildNewAccount, type AccountType, type BuildAccountError, type NewAccount } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';

export const TYPE_LABEL: Readonly<Record<AccountType, string>> = {
  cash: copy.accounts.typeCash,
  bank: copy.accounts.typeBank,
  wallet: copy.accounts.typeWallet,
  savings_pot: copy.accounts.typeSavings,
  card: copy.accounts.typeCard,
};

const ERROR_COPY: Readonly<Record<BuildAccountError, string>> = {
  NAME_REQUIRED: copy.accounts.nameRequired,
  NAME_TOO_LONG: copy.accounts.nameRequired,
  AMOUNT_INVALID: copy.accounts.balanceInvalid,
  AMOUNT_NEGATIVE: copy.accounts.balanceInvalid,
  AMOUNT_TOO_LARGE: copy.accounts.balanceTooLarge,
  EXCESS_DECIMALS: copy.accounts.balanceExcess,
};

export interface AccountFormProps {
  /** Profile currency exponent, for exact parsing of the balance. */
  exponent: number;
  submitLabel: string;
  onSubmit: (account: NewAccount) => void;
  /** Shown as a secondary action (onboarding's "Skip for now"). */
  onSkip?: () => void;
  /** An error from saving (the form keeps what was typed). */
  saveError?: string | null;
}

/**
 * "Where's most of your money?": a type, a name and a rough balance (or none). An empty name shows
 * `Error: name required`, keeps everything typed, and moves focus to the name field; nothing is saved.
 */
export function AccountForm({ exponent, submitLabel, onSubmit, onSkip, saveError }: AccountFormProps) {
  const theme = useTheme();
  const [type, setType] = useState<AccountType>('bank');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<BuildAccountError | null>(null);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const balanceRef = useRef<ComponentRef<typeof TextInput>>(null);

  const submit = () => {
    const built = buildNewAccount({ name, type, balanceText: balance, exponent });
    if (!built.ok) {
      setError(built.code);
      (built.code === 'NAME_REQUIRED' || built.code === 'NAME_TOO_LONG' ? nameRef : balanceRef).current?.focus();
      return;
    }
    setError(null);
    onSubmit(built.value);
  };

  const nameBad = error === 'NAME_REQUIRED' || error === 'NAME_TOO_LONG';
  const balanceBad = error !== null && !nameBad;
  const border = (bad: boolean) => ({ borderColor: bad ? theme.color('semantic-expense') : theme.color('border-control') });
  const ink = { color: theme.color('text-primary') };

  return (
    <View style={styles.gap} testID="account-form">
      <View style={styles.chips}>
        {ACCOUNT_TYPES.map((t) => (
          <Chip key={t} label={TYPE_LABEL[t]} variant="account" testID={`account-type-${t}`} selected={type === t} onPress={() => setType(t)} />
        ))}
      </View>

      <Text style={[textStyle('label'), ink]}>{copy.accounts.nameLabel}</Text>
      <TextInput
        ref={nameRef}
        testID="account-name"
        accessibilityLabel={copy.accounts.nameLabel}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={80}
        style={[styles.input, textStyle('body'), ink, border(nameBad)]}
      />
      {nameBad ? (
        <Text testID="account-name-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
          {ERROR_COPY[error as BuildAccountError]}
        </Text>
      ) : null}

      <Text style={[textStyle('label'), ink]}>{type === 'card' ? copy.accounts.balanceLabelCard : copy.accounts.balanceLabel}</Text>
      <TextInput
        ref={balanceRef}
        testID="account-balance"
        accessibilityLabel={type === 'card' ? copy.accounts.balanceLabelCard : copy.accounts.balanceLabel}
        accessibilityHint={copy.accounts.roughIsFine}
        placeholder={copy.accounts.roughIsFine}
        placeholderTextColor={theme.color('text-secondary')}
        value={balance}
        onChangeText={setBalance}
        keyboardType="decimal-pad"
        style={[styles.input, textStyle('body'), ink, border(balanceBad)]}
      />
      {balanceBad ? (
        <Text testID="account-balance-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
          {ERROR_COPY[error as BuildAccountError]}
        </Text>
      ) : (
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.accounts.roughIsFine}</Text>
      )}

      {saveError ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
          {`${saveError} ${copy.errors.nothingSaved}`}
        </Text>
      ) : null}

      <View style={styles.row}>
        {onSkip ? <Button label={copy.accounts.skip} variant="text" onPress={onSkip} testID="account-skip" /> : <View />}
        <Button label={submitLabel} onPress={submit} testID="account-submit" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
});
