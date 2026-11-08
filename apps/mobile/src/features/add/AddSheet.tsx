import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  applyKey,
  instantFromLocal,
  keypadKeyFromHardware,
  parseAmountInput,
  toLocalDate,
  type KeypadKey,
  type PaymentMethod,
} from '@wmbugo/core';
import { announce } from '../../shared/a11y/announce';
import { systemClock } from '../../adapters/startApp';
import { typedAmountLabel } from '../../shared/a11y/labels';
import { minorToInput } from '../../shared/minorInput';
import { copy } from '../../shared/copy';
import { invalidateForEvent } from '../../shared/queryClient';
import { useToast } from '../../shared/feedback/ToastHost';
import { useUiStore } from '../../shared/state/uiStore';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { OTHER_CATEGORY_ID } from '@wmbugo/core';
import { realAddApi, type AddApi, type AddData, type AddKind } from './addApi';
import { AccountChip, CategoryChips, DetailsPanel, KindSegments, TransferTo } from './AddParts';
import { useDuplicateChoices } from './duplicateChoices';
import { Keypad } from './Keypad';
import { startSaveTiming } from './saveTiming';

const QUICK_COUNT = 6;

type FieldError = 'amount' | 'category' | 'date' | 'same' | 'fee' | 'from' | null;

/** Opened from an account: what the sheet starts with. From is `accountId`; Pay card bill also fixes To. */
export interface AddPreset {
  readonly kind: AddKind;
  readonly accountId: string | null;
  readonly toAccountId?: string;
  readonly lockTo?: boolean;
  /** Starts the amount at this (minor units). */
  readonly amountMinor?: number | null;
  /** What the card owes: a bigger payment gets a note about the extra credit. */
  readonly owedMinor?: number | null;
  /** Shown while the amount is empty. */
  readonly hint?: string;
}

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
 * account chip, the typed amount and the keypad. Save writes through `SubmitCapture`; the toast offers
 * Undo. The draft (amount, type, category) lives in memory only.
 */
export function AddSheet({
  api = realAddApi,
  close,
  onNewAccount,
  preset,
  now = systemClock.nowMs,
}: {
  api?: AddApi;
  close: () => void;
  /** Opens the add-account screen (the sheet closes first). */
  onNewAccount?: () => void;
  /** Opened from an account: the type and the account (the From side of a transfer) are chosen already, the amount is empty. */
  preset?: AddPreset;
  now?: () => number;
}) {
  const theme = useTheme();
  const toast = useToast();
  const duplicate = useDuplicateChoices(api);
  const qc = useQueryClient();
  const draft = useUiStore((s) => s.addDraft);
  const setDraft = useUiStore((s) => s.setAddDraft);
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<AddData | null>(null);
  const [kind, setKind] = useState<AddKind>(preset?.kind ?? draft.kind);
  const [text, setText] = useState(preset ? '' : draft.typedText);
  const [categoryId, setCategoryId] = useState<string | null>(preset ? null : draft.categoryId);
  const [accountId, setAccountId] = useState<string | null>(preset?.accountId ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(preset?.toAccountId ?? null);
  const [owedWarned, setOwedWarned] = useState<string | null>(null);
  const presetApplied = useRef(false);
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

  const accountTouched = useRef(preset !== undefined);
  const dateTouched = useRef(false);
  const saving = useRef(false);
  /** One id per save: kept across a failed attempt so a retry cannot write twice, dropped once a save succeeds. */
  const submission = useRef<string | null>(null);
  const amountRef = useRef<ComponentRef<typeof TextInput>>(null);

  // Load categories and accounts for the type. The quick order is fixed for as long as this sheet is open.
  useEffect(() => {
    let live = true;
    void api.load(kind).then((d) => {
      if (!live || !d) return;
      setData(d);
      if (!accountTouched.current) setAccountId(d.defaultAccountId);
      if (preset?.amountMinor && !presetApplied.current) {
        presetApplied.current = true;
        setText(minorToInput(preset.amountMinor, d.exponent));
      }
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
    if (preset?.lockTo) return;
    if (toAccountId === null || toAccountId === accountId) {
      setToAccountId(data.accounts.find((a) => a.id !== accountId)?.id ?? null);
    }
  }, [kind, data, accountId, toAccountId]);

  /** Undo: removes the entries; if that fails the toast says so, so nobody thinks it was undone. */
  const undo = async (ids: readonly string[]) => {
    const results = await Promise.all(ids.map((i) => api.remove(i).catch(() => ({ ok: false }))));
    await refresh();
    if (results.some((r) => !r.ok)) toast.show({ message: copy.add.removeFailed });
  };

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
    if (!categoryId || !data.categories.some((c) => c.id === categoryId)) {
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
    const done = startSaveTiming(kind);
    try {
      submission.current ??= api.newSubmissionId();
      const r = await api.record({
        submissionId: submission.current,
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
      // Saved, never blocked; if it looks like something already recorded it waits, counted nowhere, for the user's answer.
      if (r.value.result === 'POSSIBLE_DUPLICATE') duplicate.offer(id);
      else
        toast.show({
          message: copy.add.saved,
          undo: {
            label: copy.common.undo,
            onUndo: () => void undo([id]),
          },
        });
      done();
      setDraft({ typedText: '', categoryId: null });
      submission.current = null;
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
    if (preset?.lockTo && !accountId) {
      setError('from');
      return;
    }
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
    // Paying more than the card owes is allowed: the extra sits on the card as credit. Tell once, then go ahead.
    const owedKey = `${accountId}:${parsed.value}`;
    if (preset?.lockTo && preset.owedMinor !== undefined && preset.owedMinor !== null && parsed.value > preset.owedMinor && owedWarned !== owedKey) {
      setOwedWarned(owedKey);
      return;
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
    const done = startSaveTiming('transfer');
    try {
      submission.current ??= api.newSubmissionId();
      const r = await api.recordTransfer({
        submissionId: submission.current,
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
        undo: { label: copy.common.undo, onUndo: () => void undo(ids) },
      });
      done();
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


  return (
    <View>
    <ScrollView style={{ maxHeight: Math.max(280, height - insets.top - 190) }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <KindSegments kind={kind} vertical={fontScale >= 1.3} onChoose={chooseKind} />

      {kind === 'transfer' ? null : (
        <CategoryChips
          quick={(data?.quick ?? []).slice(0, QUICK_COUNT)}
          all={data?.categories ?? []}
          showAll={showAllCategories}
          selectedId={categoryId}
          error={error === 'category'}
          onToggleAll={() => setShowAllCategories((v) => !v)}
          onPick={chooseCategory}
        />
      )}

      <View style={styles.inline}>
      <Text style={[textStyle('label'), ink]}>{kind === 'transfer' ? copy.add.from : kind === 'income' ? copy.add.receivedIn : copy.add.paidFrom}</Text>
      <AccountChip
        accounts={(data?.accounts ?? []).filter((a) => !preset?.lockTo || a.type !== 'card')}
        loaded={data !== null}
        selectedId={accountId}
        picking={pickingAccount}
        onTogglePicking={() => setPickingAccount((v) => !v)}
        onPick={(id) => {
          accountTouched.current = true;
          setAccountId(id);
          setPickingAccount(false);
        }}
      />
      </View>

      {kind === 'transfer' && data ? (
        <TransferTo
          accounts={data.accounts}
          fromId={accountId}
          toId={toAccountId}
          sameError={error === 'same'}
          locked={preset?.lockTo === true}
          onNewAccount={onNewAccount}
          onPick={(id) => {
            setToAccountId(id);
            setWarned(null);
            if (error === 'same') setError(null);
          }}
        />
      ) : null}

      <View
        testID="typed-amount"
        accessible
        accessibilityLabel={`${copy.add.amountLabel} ${typedAmountLabel(text, data?.currency ?? 'INR')}`}
        accessibilityLiveRegion="polite"
        style={styles.amount}>
        {data ? (
          <Amount amountMinor={minor} currency={data.currency} direction={kind === 'income' ? 'income' : kind === 'transfer' ? 'neutral' : 'expense'} role="display-amount" locale={locale} color={error === 'amount' ? 'on-glass-accent' : 'on-glass-primary'} />
        ) : null}
      </View>
      {/* Takes hardware number keys and Backspace; the soft keyboard stays closed (the keypad is the input). */}
      <TextInput
        ref={amountRef}
        testID="amount-input"
        accessible={false}
        importantForAccessibility="no"
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

      <Keypad
        exponent={exponent}
        locale={locale}
        onKey={press}
        trailing={
          <Button label={details ? copy.add.detailsHide : copy.add.detailsShow} variant="text" onGlass onPress={() => setDetails((v) => !v)} testID="details-toggle" />
        }
      />
      {details ? (
        <DetailsPanel
          kind={kind}
          values={{ merchant, date: dateText, time: timeText, note, payment, fee: feeText, feeCategoryId }}
          error={error === 'date' || error === 'fee' ? error : null}
          quick={data?.quick ?? []}
          categories={data?.categories ?? []}
          onChange={(c) => {
            if (c.merchant !== undefined) setMerchant(c.merchant);
            if (c.note !== undefined) setNote(c.note);
            if (c.payment !== undefined) setPayment(c.payment);
            if (c.feeCategoryId !== undefined) setFeeCategoryId(c.feeCategoryId);
            if (c.date !== undefined) setDateText(c.date);
            if (c.time !== undefined) setTimeText(c.time);
            if (c.dateEdited) dateTouched.current = true;
            if (c.fee !== undefined) setFeeText(c.fee);
            if ((c.date !== undefined || c.time !== undefined) && error === 'date') setError(null);
            if (c.fee !== undefined && error === 'fee') setError(null);
          }}
        />
      ) : null}

      {error === 'from' ? (
        <Text testID="from-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), { color: theme.color('on-glass-accent') }]}>
          {copy.add.payFromRequired}
        </Text>
      ) : null}
      {preset?.hint && text === '' ? <Text testID="preset-hint" style={[textStyle('body'), secondary]}>{preset.hint}</Text> : null}
      {kind === 'transfer' && owedWarned !== null && owedWarned === `${accountId}:${parsed.ok ? parsed.value : ''}` ? (
        <Text testID="owed-warning" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[textStyle('body'), secondary]}>
          {copy.add.moreThanOwed}
        </Text>
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
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  amount: { alignItems: 'center', paddingVertical: 4 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12 },
});
