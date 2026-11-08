import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  applyKey,
  instantFromLocal,
  keypadKeyFromHardware,
  parseAmountInput,
  toLocalDate,
  PAYMENT_METHODS,
  type KeypadKey,
  type PaymentMethod,
} from '@wmbugo/core';
import { announce } from '../../shared/a11y/announce';
import { systemClock } from '../../adapters/startApp';
import { typedAmountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { invalidateForEvent } from '../../shared/queryClient';
import { useToast } from '../../shared/feedback/ToastHost';
import { useUiStore } from '../../shared/state/uiStore';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { OTHER_CATEGORY_ID } from '@wmbugo/core';
import { realAddApi, type AddApi, type AddData, type AddKind } from './addApi';
import { categoryIcon } from './categoryIcons';
import { Keypad } from './Keypad';

const QUICK_COUNT = 6;

const PAYMENT_LABEL: Readonly<Record<PaymentMethod, string>> = {
  upi: copy.add.payUpi,
  card: copy.add.payCard,
  cash: copy.add.payCash,
  bank_transfer: copy.add.payBank,
  other: copy.add.payOther,
};

type FieldError = 'amount' | 'category' | 'date' | 'same' | 'fee' | null;

const KINDS: readonly AddKind[] = ['expense', 'income', 'transfer'];
const KIND_LABEL: Readonly<Record<AddKind, string>> = { expense: copy.add.expense, income: copy.add.income, transfer: copy.add.transfer };

function wallParts(nowMs: number, tz: string): { date: string; time: string } {
  const d = toLocalDate(nowMs, tz);
  let time = '00:00';
  try {
    time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(nowMs);
  } catch {
    // keep midnight; the field stays editable
  }
  return { date: d.ok ? d.value : '1970-01-01', time };
}

/**
 * The Add sheet: segmented Expense/Income, quick-category chips (most used first, fixed while open), the
 * account chip, the typed amount and the keypad. Save writes through `RecordManualEntry`; the toast offers
 * Undo. The draft (amount, type, category) lives in memory only.
 */
export function AddSheet({
  api = realAddApi,
  close,
  onNewAccount,
  now = systemClock.nowMs,
}: {
  api?: AddApi;
  close: () => void;
  /** Opens the add-account screen (the sheet closes first). */
  onNewAccount?: () => void;
  now?: () => number;
}) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const draft = useUiStore((s) => s.addDraft);
  const setDraft = useUiStore((s) => s.setAddDraft);
  const { height, fontScale } = useWindowDimensions();

  const [data, setData] = useState<AddData | null>(null);
  const [kind, setKind] = useState<AddKind>(draft.kind);
  const [text, setText] = useState(draft.typedText);
  const [categoryId, setCategoryId] = useState<string | null>(draft.categoryId);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [feeText, setFeeText] = useState('');
  const [feeCategoryId, setFeeCategoryId] = useState(OTHER_CATEGORY_ID);
  const [warned, setWarned] = useState<string | null>(null);
  const [pickingAccount, setPickingAccount] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');

  const accountTouched = useRef(false);
  const dateTouched = useRef(false);
  const saving = useRef(false);
  const amountRef = useRef<ComponentRef<typeof TextInput>>(null);

  // Load categories and accounts for the type. The quick order is fixed for as long as this sheet is open.
  useEffect(() => {
    let live = true;
    void api.load(kind).then((d) => {
      if (!live || !d) return;
      setData(d);
      if (!accountTouched.current) setAccountId(d.defaultAccountId);
      if (!dateTouched.current) {
        const w = wallParts(now(), d.timezoneId);
        setDateText(w.date);
        setTimeText(w.time);
      }
    });
    return () => {
      live = false;
    };
  }, [api, kind, now]);

  useEffect(() => {
    if (kind !== 'transfer' || !data) return;
    if (toAccountId === null || toAccountId === accountId) {
      setToAccountId(data.accounts.find((a) => a.id !== accountId)?.id ?? null);
    }
  }, [kind, data, accountId, toAccountId]);

  const refresh = useCallback(() => invalidateForEvent(qc, 'TransactionsChanged'), [qc]);

  const exponent = data?.exponent ?? 2;
  const locale = data?.locale ?? 'en';
  const parsed = parseAmountInput(text, exponent);
  const minor = parsed.ok ? parsed.value : 0;

  const press = (key: KeypadKey) => {
    const next = applyKey(text, key, exponent);
    if (key === 'clear') {
      // Clear discards the whole draft (the type stays where it is).
      setText('');
      setCategoryId(null);
      setDraft({ typedText: '', categoryId: null });
      setError(null);
      return;
    }
    setText(next);
    setDraft({ typedText: next });
    if (error === 'amount') setError(null);
  };

  const chooseKind = (next: AddKind) => {
    if (next === kind) return;
    setKind(next);
    setCategoryId(null);
    setShowAllCategories(false);
    setError(null);
    setWarned(null);
    setSaveError(null);
    setDraft({ kind: next, categoryId: null });
    if (next === 'transfer') announce(copy.add.transferSelected);
  };

  const chooseCategory = (id: string) => {
    setCategoryId(id);
    setDraft({ categoryId: id });
    if (error === 'category') setError(null);
    if (!accountTouched.current) {
      void api.defaultAccountFor(id).then((a) => {
        if (a && !accountTouched.current) setAccountId(a);
      });
    }
  };

  const save = async (another: boolean) => {
    if (saving.current || !data) return;
    if (!parsed.ok || parsed.value <= 0) {
      setError('amount');
      amountRef.current?.focus();
      return;
    }
    if (kind === 'transfer') {
      await saveTransfer(another);
      return;
    }
    if (!categoryId) {
      setError('category');
      return;
    }
    let occurredAtMs: number | undefined;
    if (details && dateTouched.current) {
      const at = instantFromLocal(dateText, timeText, data.timezoneId);
      if (at === null) {
        setError('date');
        return;
      }
      occurredAtMs = at;
    }
    saving.current = true;
    setSaveError(null);
    try {
      const r = await api.record({
        kind,
        amountMinor: parsed.value,
        categoryId,
        accountId: data.accounts.length === 0 ? null : accountId,
        ...(merchant.trim() ? { merchant } : {}),
        ...(note.trim() ? { note } : {}),
        ...(payment ? { paymentMethod: payment } : {}),
        ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
      });
      if (!r.ok) {
        setSaveError(copy.add.saveError);
        return;
      }
      const id = r.value.transactionId;
      await refresh();
      toast.show({
        message: copy.add.saved,
        undo: {
          label: copy.common.undo,
          onUndo: () => void api.remove(id).then(() => refresh()),
        },
      });
      setDraft({ typedText: '', categoryId: null });
      if (another) {
        setText('');
        setMerchant('');
        setNote('');
        setPayment(null);
        dateTouched.current = false;
        setError(null);
        // The account just used is now known, so a new Cash account is picked up for the next entry.
        void api.load(kind).then((d) => {
          if (!d) return;
          setData(d);
          if (!accountTouched.current) setAccountId(r.value.accountId);
        });
        amountRef.current?.focus();
      } else {
        close();
      }
    } finally {
      saving.current = false;
    }
  };

  const saveTransfer = async (another: boolean) => {
    if (!data || !parsed.ok) return;
    if (!accountId || !toAccountId || accountId === toAccountId) {
      setError('same');
      return;
    }
    let occurredAtMs: number | undefined;
    if (details && dateTouched.current) {
      const at = instantFromLocal(dateText, timeText, data.timezoneId);
      if (at === null) {
        setError('date');
        return;
      }
      occurredAtMs = at;
    }
    let fee: { amountMinor: number; categoryId: string } | undefined;
    if (feeText.trim() !== '') {
      const f = parseAmountInput(feeText.trim(), exponent);
      if (!f.ok || f.value <= 0) {
        setError('fee');
        return;
      }
      fee = { amountMinor: f.value, categoryId: feeCategoryId };
    }
    // A non-blocking warning when the amount is above the balance on record: the next Save goes ahead.
    const from = data.accounts.find((a) => a.id === accountId);
    const key = `${accountId}:${parsed.value}`;
    if (from && !from.balanceNotSet && from.type !== 'card' && parsed.value > from.postingsMinor && !data.blockTransfers && warned !== key) {
      setWarned(key);
      return;
    }
    saving.current = true;
    setSaveError(null);
    try {
      const r = await api.recordTransfer({
        amountMinor: parsed.value,
        fromAccountId: accountId,
        toAccountId,
        ...(note.trim() ? { note } : {}),
        ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
        ...(fee ? { fee } : {}),
      });
      if (!r.ok) {
        if (r.code === 'SAME_ACCOUNT') setError('same');
        else if (r.code === 'INSUFFICIENT_FUNDS') setSaveError(copy.add.insufficient);
        else setSaveError(copy.add.saveError);
        return;
      }
      const ids = [r.value.transactionId, ...(r.value.feeTransactionId ? [r.value.feeTransactionId] : [])];
      await refresh();
      toast.show({
        message: copy.add.saved,
        undo: { label: copy.common.undo, onUndo: () => void Promise.all(ids.map((i) => api.remove(i))).then(() => refresh()) },
      });
      setDraft({ typedText: '', categoryId: null });
      setWarned(null);
      if (another) {
        setText('');
        setNote('');
        setFeeText('');
        dateTouched.current = false;
        setError(null);
        void api.load(kind).then((d) => d && setData(d));
        amountRef.current?.focus();
      } else {
        close();
      }
    } finally {
      saving.current = false;
    }
  };

  const ink = { color: theme.color('on-glass-primary') };
  const secondary = { color: theme.color('on-glass-secondary') };
  const inputStyle = [styles.input, textStyle('body'), { color: theme.color('text-primary'), backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-control') }];

  const quick = (data?.quick ?? []).slice(0, QUICK_COUNT);
  const listed = showAllCategories ? (data?.categories ?? []) : quick;
  const currentAccount = data?.accounts.find((a) => a.id === accountId) ?? null;
  const noAccounts = data !== null && data.accounts.length === 0;

  return (
    <View>
    <ScrollView style={{ maxHeight: height * 0.62 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={fontScale >= 1.3 ? styles.column : styles.row} accessibilityRole="radiogroup" accessibilityLabel={copy.add.typeLabel}>
        {KINDS.map((k, i) => (
          <Chip
            key={k}
            label={KIND_LABEL[k]}
            variant="period"
            role="radio"
            hint={copy.add.position.replace("{n}", String(i + 1))}
            testID={`kind-${k}`}
            selected={kind === k}
            onPress={() => chooseKind(k)}
          />
        ))}
      </View>

      {kind === 'transfer' ? null : <Text style={[textStyle('label'), ink]}>{copy.add.category}</Text>}
      {kind === 'transfer' ? null : (
      <View style={styles.wrap} testID="category-chips">
        {listed.map((c) => (
          <Chip key={c.id} label={c.name} icon={categoryIcon(c.icon)} testID={`category-${c.id}`} selected={categoryId === c.id} onPress={() => chooseCategory(c.id)} />
        ))}
        {data && data.categories.length > quick.length ? (
          <Chip label={showAllCategories ? copy.add.fewer : copy.add.more} testID="category-more" onPress={() => setShowAllCategories((v) => !v)} />
        ) : null}
      </View>
      )}
      {error === 'category' ? (
        <Text testID="category-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('on-glass-accent') }]}>
          {copy.add.categoryRequired}
        </Text>
      ) : null}

      <Text style={[textStyle('label'), ink]}>{kind === 'transfer' ? copy.add.from : kind === 'income' ? copy.add.receivedIn : copy.add.paidFrom}</Text>
      <View style={styles.wrap}>
        {noAccounts ? (
          <Chip label={copy.add.cashNew} variant="account" testID="account-chip" selected onPress={() => undefined} />
        ) : pickingAccount ? (
          (data?.accounts ?? []).map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              variant="account"
              testID={`account-option-${a.id}`}
              selected={a.id === accountId}
              onPress={() => {
                accountTouched.current = true;
                setAccountId(a.id);
                setPickingAccount(false);
              }}
            />
          ))
        ) : currentAccount ? (
          <Chip label={currentAccount.name} variant="account" testID="account-chip" selected onPress={() => setPickingAccount((data?.accounts.length ?? 0) > 1)} />
        ) : null}
      </View>

      {kind === 'transfer' && data ? (
        <>
          <Text style={[textStyle('label'), ink]}>{copy.add.to}</Text>
          <View style={styles.wrap} testID="to-accounts">
            {data.accounts
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  variant="account"
                  testID={`to-option-${a.id}`}
                  selected={a.id === toAccountId}
                  onPress={() => {
                    setToAccountId(a.id);
                    setWarned(null);
                    if (error === 'same') setError(null);
                  }}
                />
              ))}
            {data.accounts.length < 2 ? <Chip label={copy.add.newAccount} variant="account" testID="to-new-account" onPress={() => onNewAccount?.()} /> : null}
          </View>
          {error === 'same' ? (
            <Text testID="same-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), { color: theme.color('on-glass-accent') }]}>
              {copy.add.sameAccount}
            </Text>
          ) : null}
        </>
      ) : null}

      <View
        testID="typed-amount"
        accessible
        accessibilityLabel={`${copy.add.amountLabel} ${typedAmountLabel(text, data?.currency ?? 'INR')}`}
        accessibilityLiveRegion="polite"
        style={styles.amount}>
        {data ? (
          <Amount amountMinor={minor} currency={data.currency} direction={kind === 'income' ? 'income' : kind === 'transfer' ? 'neutral' : 'expense'} role="display-amount" locale={locale} color={error === 'amount' ? 'semantic-expense' : 'text-primary'} />
        ) : null}
      </View>
      {/* Takes hardware number keys and Backspace; the soft keyboard stays closed (the keypad is the input). */}
      <TextInput
        ref={amountRef}
        testID="amount-input"
        accessibilityLabel={copy.add.amountLabel}
        autoFocus
        showSoftInputOnFocus={false}
        caretHidden
        value=""
        onChangeText={() => undefined}
        onKeyPress={(e) => {
          const key = keypadKeyFromHardware(e.nativeEvent.key);
          if (key) press(key);
        }}
        style={styles.hiddenInput}
      />
      {error === 'amount' ? (
        <Text testID="amount-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), { color: theme.color('on-glass-accent') }]}>
          {copy.add.amountRequired}
        </Text>
      ) : null}

      <Keypad exponent={exponent} locale={locale} onKey={press} />

      <Button
        label={details ? copy.add.detailsHide : copy.add.detailsShow}
        variant="text"
        onGlass
        onPress={() => setDetails((v) => !v)}
        testID="details-toggle"
      />
      {details ? (
        <View style={styles.details} testID="details">
          {kind === 'transfer' ? null : (
            <>
              <Text style={[textStyle('label'), ink]}>{copy.add.merchant}</Text>
              <TextInput testID="merchant-input" accessibilityLabel={copy.add.merchant} value={merchant} onChangeText={setMerchant} maxLength={120} style={inputStyle} />
            </>
          )}
          <Text style={[textStyle('label'), ink]}>{copy.add.date}</Text>
          <TextInput
            testID="date-input"
            accessibilityLabel={copy.add.date}
            value={dateText}
            onChangeText={(t) => {
              dateTouched.current = true;
              setDateText(t);
              if (error === 'date') setError(null);
            }}
            keyboardType="numbers-and-punctuation"
            style={inputStyle}
          />
          <Text style={[textStyle('label'), ink]}>{copy.add.time}</Text>
          <TextInput
            testID="time-input"
            accessibilityLabel={copy.add.time}
            value={timeText}
            onChangeText={(t) => {
              dateTouched.current = true;
              setTimeText(t);
              if (error === 'date') setError(null);
            }}
            keyboardType="numbers-and-punctuation"
            style={inputStyle}
          />
          {error === 'date' ? (
            <Text testID="date-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('on-glass-accent') }]}>
              {copy.add.dateInvalid}
            </Text>
          ) : null}
          <Text style={[textStyle('label'), ink]}>{copy.add.note}</Text>
          <TextInput testID="note-input" accessibilityLabel={copy.add.note} value={note} onChangeText={setNote} maxLength={500} multiline style={inputStyle} />
          {kind === 'transfer' ? (
            <>
              <Text style={[textStyle('label'), ink]}>{copy.add.fee}</Text>
              <TextInput
                testID="fee-input"
                accessibilityLabel={copy.add.fee}
                value={feeText}
                onChangeText={(t) => {
                  setFeeText(t);
                  if (error === 'fee') setError(null);
                }}
                keyboardType="decimal-pad"
                style={inputStyle}
              />
              {error === 'fee' ? (
                <Text testID="fee-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('on-glass-accent') }]}>
                  {copy.add.feeInvalid}
                </Text>
              ) : null}
              {feeText.trim() !== '' ? (
                <>
                  <Text style={[textStyle('label'), ink]}>{copy.add.feeCategory}</Text>
                  <View style={styles.wrap}>
                    {(data?.quick ?? []).concat((data?.categories ?? []).filter((c) => !(data?.quick ?? []).some((q) => q.id === c.id))).map((c) => (
                      <Chip key={c.id} label={c.name} testID={`fee-category-${c.id}`} selected={feeCategoryId === c.id} onPress={() => setFeeCategoryId(c.id)} />
                    ))}
                  </View>
                </>
              ) : null}
            </>
          ) : (
            <Text style={[textStyle('label'), ink]}>{copy.add.payment}</Text>
          )}
          <View style={styles.wrap}>
            {(kind === 'transfer' ? [] : PAYMENT_METHODS).map((m) => (
              <Chip key={m} label={PAYMENT_LABEL[m]} variant="paid-with" testID={`payment-${m}`} selected={payment === m} onPress={() => setPayment(payment === m ? null : m)} />
            ))}
          </View>
        </View>
      ) : null}

      {warned ? (
        <Text testID="transfer-warning" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[textStyle('body'), secondary]}>
          {copy.add.warnAboveBalance}
        </Text>
      ) : null}
      {saveError ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), secondary]}>
          {`${saveError} ${copy.errors.nothingSaved}`}
        </Text>
      ) : null}

    </ScrollView>
    <View style={[styles.footer, { backgroundColor: theme.color('glass-fallback') }]} testID="add-footer">
      <Button label={copy.add.saveAnother} variant="secondary-on-footer" onPress={() => void save(true)} testID="save-another" />
      <Button label={copy.add.save} onPress={() => void save(false)} testID="save" />
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  column: { flexDirection: 'column', alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  amount: { alignItems: 'center', paddingVertical: 4 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  details: { gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12 },
});
