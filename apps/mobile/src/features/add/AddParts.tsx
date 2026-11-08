import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PAYMENT_METHODS, type AccountRow, type CategoryRow, type PaymentMethod } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { resolveColor } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Chip } from '../../shared/ui/Chip';
import type { AddKind } from './addApi';
import { categoryIcon } from './categoryIcons';

const KINDS: readonly AddKind[] = ['expense', 'income', 'transfer'];
const KIND_LABEL: Readonly<Record<AddKind, string>> = { expense: copy.add.expense, income: copy.add.income, transfer: copy.add.transfer };

const PAYMENT_LABEL: Readonly<Record<PaymentMethod, string>> = {
  upi: copy.add.payUpi,
  card: copy.add.payCard,
  cash: copy.add.payCash,
  bank_transfer: copy.add.payBank,
  other: copy.add.payOther,
};

/** Expense / Income / Transfer as a radio group "Entry type", each read "Option n of 3"; vertical at large text. */
export function KindSegments({ kind, vertical, onChoose }: { kind: AddKind; vertical: boolean; onChoose: (k: AddKind) => void }) {
  return (
    <View style={vertical ? styles.column : styles.row} accessibilityRole="radiogroup" accessibilityLabel={copy.add.typeLabel}>
      {KINDS.map((k, i) => (
        <Chip
          onGlass
          key={k}
          label={KIND_LABEL[k]}
          variant="period"
          role="radio"
          hint={copy.add.position.replace('{n}', String(i + 1))}
          testID={`kind-${k}`}
          selected={kind === k}
          onPress={() => onChoose(k)}
        />
      ))}
    </View>
  );
}

/** Quick categories (most used first) with More for the full list; `Error: category required` sits under them. */
export function CategoryChips({
  quick,
  all,
  showAll,
  selectedId,
  error,
  onToggleAll,
  onPick,
}: {
  quick: readonly CategoryRow[];
  all: readonly CategoryRow[];
  showAll: boolean;
  selectedId: string | null;
  error: boolean;
  onToggleAll: () => void;
  onPick: (id: string) => void;
}) {
  const theme = useTheme();
  const listed = showAll ? all : quick;
  const chips = listed.map((c) => (
    <Chip onGlass key={c.id} label={c.name} icon={categoryIcon(c.icon)} testID={`category-${c.id}`} selected={selectedId === c.id} onPress={() => onPick(c.id)} />
  ));
  const more = all.length > quick.length ? <Chip onGlass label={showAll ? copy.add.fewer : copy.add.more} testID="category-more" onPress={onToggleAll} /> : null;
  return (
    <>
      <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('on-glass-primary') }]}>{copy.add.category}</Text>
      {showAll ? (
        <View style={styles.wrap} testID="category-chips">
          {chips}
          {more}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="category-chips" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.strip}>
          {chips}
          {more}
        </ScrollView>
      )}
      {error ? (
        <Text testID="category-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('on-glass-accent') }]}>
          {copy.add.categoryRequired}
        </Text>
      ) : null}
    </>
  );
}

/** The account chip: the chosen account (tap to choose another when there are several), or Cash when none exists yet. */
export function AccountChip({
  accounts,
  loaded,
  selectedId,
  picking,
  onTogglePicking,
  onPick,
}: {
  accounts: readonly AccountRow[];
  loaded: boolean;
  selectedId: string | null;
  picking: boolean;
  onTogglePicking: () => void;
  onPick: (id: string) => void;
}) {
  const current = accounts.find((a) => a.id === selectedId) ?? null;
  return (
    <View style={styles.wrap}>
      {loaded && accounts.length === 0 ? (
        <Chip onGlass label={copy.add.cashNew} variant="account" testID="account-chip" selected onPress={() => undefined} />
      ) : picking ? (
        accounts.map((a) => <Chip onGlass key={a.id} label={a.name} variant="account" testID={`account-option-${a.id}`} selected={a.id === selectedId} onPress={() => onPick(a.id)} />)
      ) : current ? (
        <Chip onGlass label={current.name} variant="account" testID="account-chip" selected onPress={() => accounts.length > 1 && onTogglePicking()} />
      ) : null}
    </View>
  );
}

/** The To account for a transfer (From is the account chip above it), or `+ New account` with fewer than two. */
export function TransferTo({
  accounts,
  fromId,
  toId,
  sameError,
  onPick,
  onNewAccount,
}: {
  accounts: readonly AccountRow[];
  fromId: string | null;
  toId: string | null;
  sameError: boolean;
  onPick: (id: string) => void;
  onNewAccount?: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      <Text style={[textStyle('label'), { color: theme.color('on-glass-primary') }]}>{copy.add.to}</Text>
      <View style={styles.wrap} testID="to-accounts">
        {accounts
          .filter((a) => a.id !== fromId)
          .map((a) => (
            <Chip onGlass key={a.id} label={a.name} variant="account" testID={`to-option-${a.id}`} selected={a.id === toId} onPress={() => onPick(a.id)} />
          ))}
        {accounts.length < 2 ? <Chip onGlass label={copy.add.newAccount} variant="account" testID="to-new-account" onPress={() => onNewAccount?.()} /> : null}
      </View>
      {sameError ? (
        <Text testID="same-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), { color: theme.color('on-glass-accent') }]}>
          {copy.add.sameAccount}
        </Text>
      ) : null}
    </>
  );
}

export interface DetailsValues {
  readonly merchant: string;
  readonly date: string;
  readonly time: string;
  readonly note: string;
  readonly payment: PaymentMethod | null;
  readonly fee: string;
  readonly feeCategoryId: string;
}

export type DetailsChange = Partial<DetailsValues> & { dateEdited?: boolean };

/**
 * The optional details: merchant, date and time (default now), note, and either the payment method
 * (expense, income) or the fee and its category (transfer).
 */
export function DetailsPanel({
  kind,
  values,
  error,
  quick,
  categories,
  onChange,
}: {
  kind: AddKind;
  values: DetailsValues;
  error: 'date' | 'fee' | null;
  quick: readonly CategoryRow[];
  categories: readonly CategoryRow[];
  onChange: (change: DetailsChange) => void;
}) {
  const theme = useTheme();
  const label = [textStyle('label'), { color: theme.color('on-glass-primary') }];
  const alert = [textStyle('caption'), { color: theme.color('on-glass-accent') }];
  const input = [styles.input, textStyle('body'), { color: theme.color('on-glass-primary'), backgroundColor: resolveColor('dark', 'bg-surface'), borderColor: theme.color('on-glass-secondary') }];
  const transfer = kind === 'transfer';
  const feeCategories = quick.concat(categories.filter((c) => !quick.some((q) => q.id === c.id)));
  return (
    <View style={styles.details} testID="details">
      {transfer ? null : (
        <>
          <Text style={label}>{copy.add.merchant}</Text>
          <TextInput testID="merchant-input" accessibilityLabel={copy.add.merchant} value={values.merchant} onChangeText={(t) => onChange({ merchant: t })} maxLength={120} style={input} />
        </>
      )}
      <Text style={label}>{copy.add.date}</Text>
      <TextInput testID="date-input" accessibilityLabel={copy.add.date} value={values.date} onChangeText={(t) => onChange({ date: t, dateEdited: true })} keyboardType="numbers-and-punctuation" style={input} />
      <Text style={label}>{copy.add.time}</Text>
      <TextInput testID="time-input" accessibilityLabel={copy.add.time} value={values.time} onChangeText={(t) => onChange({ time: t, dateEdited: true })} keyboardType="numbers-and-punctuation" style={input} />
      {error === 'date' ? (
        <Text testID="date-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={alert}>
          {copy.add.dateInvalid}
        </Text>
      ) : null}
      <Text style={label}>{copy.add.note}</Text>
      <TextInput testID="note-input" accessibilityLabel={copy.add.note} value={values.note} onChangeText={(t) => onChange({ note: t })} maxLength={500} multiline style={input} />
      {transfer ? (
        <>
          <Text style={label}>{copy.add.fee}</Text>
          <TextInput testID="fee-input" accessibilityLabel={copy.add.fee} value={values.fee} onChangeText={(t) => onChange({ fee: t })} keyboardType="decimal-pad" style={input} />
          {error === 'fee' ? (
            <Text testID="fee-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={alert}>
              {copy.add.feeInvalid}
            </Text>
          ) : null}
          {values.fee.trim() !== '' ? (
            <>
              <Text style={label}>{copy.add.feeCategory}</Text>
              <View style={styles.wrap}>
                {feeCategories.map((c) => (
                  <Chip onGlass key={c.id} label={c.name} testID={`fee-category-${c.id}`} selected={values.feeCategoryId === c.id} onPress={() => onChange({ feeCategoryId: c.id })} />
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : (
        <>
          <Text style={label}>{copy.add.payment}</Text>
          <View style={styles.wrap}>
            {PAYMENT_METHODS.map((m) => (
              <Chip onGlass key={m} label={PAYMENT_LABEL[m]} variant="paid-with" testID={`payment-${m}`} selected={values.payment === m} onPress={() => onChange({ payment: values.payment === m ? null : m })} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  column: { flexDirection: 'column', alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  strip: { flexDirection: 'row', gap: 4, paddingRight: 8 },
  details: { gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
