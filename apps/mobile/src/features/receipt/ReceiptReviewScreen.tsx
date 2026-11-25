import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CaretDown, CaretRight, CaretUp, Warning } from 'phosphor-react-native';
import { applyKey, parseAmountInput, UNCATEGORISED_ID, type KeypadKey, type ReceiptDraft } from '@wmbugo/core';
import { amountLabel, controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { minorToInput } from '../../shared/minorInput';
import { invalidateForEvent } from '../../shared/queryClient';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle as roleStyle, type TypeRole } from '../../shared/theme/typography';

/** The review shows a whole receipt on one screen, so its text is two points smaller than the rest of the app (never under the 12 floor). */
const COMPACT: Partial<Record<TypeRole, { size: number; line: number }>> = { body: { size: 14, line: 20 }, 'body-medium': { size: 14, line: 20 }, label: { size: 13, line: 18 }, caption: { size: 12, line: 16 } };
function textStyle(role: TypeRole) {
  const base = roleStyle(role);
  const c = COMPACT[role];
  return c ? { ...base, fontSize: c.size, lineHeight: c.line } : base;
}
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { FocusRing, useFocusRing } from '../../shared/ui/FocusRing';
import { moneyText } from '../../shared/ui/moneyText';
import { ScreenFrame } from '../../shared/ui/ScreenFrame';
import { TopBar } from '../../shared/ui/TopBar';
import { realAddApi, type AddApi } from '../add/addApi';
import type { CategoryRow } from '@wmbugo/core';
import { useDuplicateChoices } from '../add/duplicateChoices';
import { Keypad } from '../add/Keypad';
import { CategoryCell } from '../add/AddParts';
import { CategoryChip } from '../categories/CategoryChip';
import type { ReceiptMatch } from '@wmbugo/core';
import type { AttachTarget } from './receiptApi';
import type { PendingPhoto } from '../../adapters/files/receiptFiles';
import { realReceiptApi, type ReceiptApi, type ReceiptContext } from './receiptApi';
import { addItem, confirmTotal, editItem, initialReview, removeItem, saveInput, setAccount, setCharge, setCurrency, setDate, setItemCategory, setMainCategory, setMerchant, setSubtotal, setTotal, viewOf, type ChargeKind, type ReviewState } from './receiptReviewModel';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `Matches ₹2,340 HDFC debit 6:12 pm` today, `... · 6 Nov, 6:12 pm` on another day (the profile time zone). */
function matchText(template: { today: string; other: string }, atMs: number, localDate: string, todayLocal: string, timezoneId: string): string {
  let h = 0;
  let m = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezoneId, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(atMs).split(':');
    h = Number(parts[0]);
    m = Number(parts[1]);
  } catch {
    // keep midnight
  }
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  if (localDate === todayLocal) return template.today.replace('{time}', time);
  return template.other.replace('{date}', `${Number(localDate.slice(8, 10))} ${MONTHS[Number(localDate.slice(5, 7)) - 1] ?? ''}`).replace('{time}', time);
}

/** A day that exists on the calendar, written `YYYY-MM-DD`. */
const isRealDate = (v: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

/** One item: its name and amount, and (for a line the reader missed) its category. Removing is offered for an item that exists. */
function ItemEditor({ initialName, initialMinor, exponent, categories, initialCategoryId, withCategory, onSave, onRemove }: { initialName: string; initialMinor: number | null; exponent: number; categories: readonly CategoryRow[]; initialCategoryId: string | null; withCategory: boolean; onSave: (name: string, minor: number, categoryId: string | null) => void; onRemove?: () => void }) {
  const theme = useTheme();
  const [name, setName] = useState(initialName);
  const [amount, setAmount] = useState(minorToInput(initialMinor, exponent));
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [problem, setProblem] = useState(false);
  const input = [styles.input, textStyle('body'), { color: theme.color('on-glass-primary'), borderColor: theme.color('on-glass-secondary') }];
  return (
    <View style={styles.editor}>
      <Text style={[textStyle('label'), { color: theme.color('on-glass-primary') }]}>{copy.receiptReview.itemName}</Text>
      <TextInput testID="item-name-input" accessibilityLabel={copy.receiptReview.itemName} value={name} onChangeText={(t) => { setName(t); setProblem(false); }} maxLength={120} style={input} />
      <Text style={[textStyle('label'), { color: theme.color('on-glass-primary') }]}>{copy.receiptReview.itemAmount}</Text>
      <TextInput testID="item-amount-input" accessibilityLabel={copy.receiptReview.itemAmount} value={amount} onChangeText={(t) => { setAmount(t); setProblem(false); }} keyboardType="decimal-pad" style={input} />
      {withCategory ? (
        <View style={styles.wrap}>
          {categories.map((c) => (
            <Chip onGlass key={c.id} label={c.name} testID={`item-category-${c.id}`} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)} />
          ))}
        </View>
      ) : null}
      {problem ? <Text testID="item-error" accessibilityRole="alert" style={[textStyle('caption'), { color: theme.color('on-glass-accent') }]}>{copy.receiptReview.itemInvalid}</Text> : null}
      <Button
        label={copy.common.save}
        testID="item-save"
        onGlass
        onPress={() => {
          const parsed = parseAmountInput(amount.trim() === '' ? '0' : amount.trim(), exponent);
          if (name.trim() === '' || !parsed.ok || parsed.value <= 0) return setProblem(true);
          onSave(name.trim(), parsed.value, categoryId);
        }}
      />
      {onRemove ? <Button label={copy.receiptReview.removeItem} variant="destructive" testID="item-remove" onPress={onRemove} onGlass /> : null}
    </View>
  );
}

/** The amount keypad in a sheet: what is typed shows above the keys, and Done (or Confirm) returns the exact minor units. */
function AmountEditor({ initialMinor, exponent, locale, doneLabel, allowZero = false, onDone }: { initialMinor: number | null; exponent: number; locale: string; doneLabel: string; /** A tax, fee or discount can be corrected to nothing; a total cannot. */ allowZero?: boolean; onDone: (minor: number) => void }) {
  const theme = useTheme();
  const [text, setText] = useState(minorToInput(initialMinor, exponent));
  const parsed = parseAmountInput(text === '' ? '0' : text, exponent);
  const minor = parsed.ok ? parsed.value : null;
  const valid = minor !== null && (allowZero || minor > 0);
  return (
    <View style={styles.editor}>
      <Text testID="amount-editor-text" style={[textStyle('display-amount'), { color: theme.color('on-glass-primary') }]}>
        {text === '' ? '0' : text}
      </Text>
      <Keypad exponent={exponent} locale={locale} onKey={(k: KeypadKey) => setText((t) => applyKey(t, k, exponent))} />
      <Button label={doneLabel} testID="amount-editor-done" {...(!valid ? { disabledReason: copy.receiptReview.totalMissing } : {})} onPress={() => valid && onDone(minor)} onGlass />
    </View>
  );
}

function TextEditor({ label, initial, keyboard, maxLength, validate, onDone }: { label: string; initial: string; keyboard?: 'default' | 'numbers-and-punctuation'; maxLength: number; /** Returns the message to show when the text is not acceptable; the sheet then stays open. */ validate?: (v: string) => string | null; onDone: (v: string) => void }) {
  const theme = useTheme();
  const [v, setV] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <View style={styles.editor}>
      <TextInput
        testID="text-editor-input"
        accessibilityLabel={label}
        value={v}
        onChangeText={(t) => {
          setV(t);
          setProblem(null);
        }}
        maxLength={maxLength}
        keyboardType={keyboard ?? 'default'}
        style={[styles.input, textStyle('body'), { color: theme.color('on-glass-primary'), borderColor: theme.color('on-glass-secondary') }]}
      />
      {problem ? (
        <Text testID="text-editor-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('on-glass-accent') }]}>
          {problem}
        </Text>
      ) : null}
      <Button
        label={copy.common.save}
        testID="text-editor-done"
        onPress={() => {
          const bad = validate?.(v) ?? null;
          setProblem(bad);
          if (!bad) onDone(v);
        }}
        onGlass
      />
    </View>
  );
}

function Row({ label, value, onPress, testID, a11yLabel, warn, children }: { label: string; value?: ReactNode; onPress?: () => void; testID: string; a11yLabel?: string; warn?: boolean; children?: ReactNode }) {
  const theme = useTheme();
  const a11y = controlA11y({ label: a11yLabel ?? label, role: onPress ? 'button' : 'text' });
  const inner = (
    <>
      <Text style={[textStyle('body'), { color: theme.color('text-secondary'), flex: 1 }]}>{label}</Text>
      <View style={styles.value}>{value}</View>
      {children}
      {onPress ? <Icon icon={CaretRight} size={14} tint={theme.color('text-secondary')} /> : null}
    </>
  );
  const box = [styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: warn ? theme.color('semantic-warning') : theme.color('border-hairline') }];
  return onPress ? (
    <Pressable testID={testID} {...a11y} onPress={onPress} style={box}>
      {inner}
    </Pressable>
  ) : (
    <View testID={testID} accessible accessibilityLabel={a11yLabel ?? label} style={box}>
      {inner}
    </View>
  );
}

/** An item's category as a button under its name; what it shows is what TalkBack reads. */
function ItemCategoryButton({ testID, label, unset, onPress, children }: { testID: string; label: string; unset: boolean; onPress: () => void; children?: ReactNode }) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing();
  return (
    <FocusRing focused={focused} radius={layout.touchMin / 2} style={styles.itemCategoryRing}>
      <Pressable testID={testID} {...controlA11y({ label, role: 'button', hint: copy.receiptReview.changeCategory })} onPress={onPress} onFocus={onFocus} onBlur={onBlur} style={[styles.itemCategory, { borderColor: unset ? theme.color('semantic-warning') : theme.color('accent-primary') }]}>
        {children}
        <Text style={[textStyle('caption'), { color: theme.color('text-primary') }]}>{label}</Text>
        <Icon icon={CaretDown} size={12} tint={theme.color('text-secondary')} />
      </Pressable>
    </FocusRing>
  );
}

/** The quick categories, with the chosen one in the last place when it is not among them. */
const withSelected = (quick: readonly CategoryRow[], all: readonly CategoryRow[], selectedId: string): readonly CategoryRow[] => {
  const chosen = all.find((c) => c.id === selectedId);
  if (!chosen || quick.some((c) => c.id === selectedId)) return quick;
  return [...quick.slice(0, -1), chosen];
};

/**
 * The receipt review (SCR-23, Story 10.4): what was read, every field correctable, the allocation rerunning after each edit, and one Save.
 * It is opened with a `ReceiptDraft`; the photo arrives with the photo flow (Story 10.6).
 */
export function ReceiptReviewScreen({ draft, photo, attachTo, onDiscardPhoto, api = realReceiptApi, addApi = realAddApi, onClose, onSaved }: { draft: ReceiptDraft; /** The pending photo (Story 10.6): saved as the entry's attachment, deleted when the receipt is discarded. */ photo?: PendingPhoto; /** Attach mode (Story 10.9): the recorded entry this receipt splits. No match prompt; the footer is `Attach and split`. */ attachTo?: string; onDiscardPhoto?: () => void; api?: ReceiptApi; addApi?: AddApi; onClose: () => void; onSaved?: (transactionId: string) => void }) {
  const theme = useTheme();
  const sheet = useSheet();
  const toast = useToast();
  const qc = useQueryClient();
  const duplicate = useDuplicateChoices(addApi);
  const [ctx, setCtx] = useState<ReceiptContext | null>(null);
  const [state, setState] = useState<ReviewState | null>(null);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submission = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [matches, setMatches] = useState<readonly ReceiptMatch[]>([]);
  const [separate, setSeparate] = useState(false);
  const [target, setTarget] = useState<AttachTarget | null | undefined>(attachTo ? undefined : null);
  const attaching = useRef(false);

  useEffect(() => {
    let live = true;
    void api
      .load(draft.merchant.value)
      .then((c) => {
        if (!live) return;
        if (!c) return setLoadFailed(true);
        setCtx(c);
        setState(initialReview(draft, { mainCategoryId: c.defaultCategoryId, accountId: c.defaultAccountId }));
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [api, draft]);

  // A dry run of the matcher: does this receipt look like a payment that is already recorded? Nothing is written.
  useEffect(() => {
    if (!attachTo) return;
    let live = true;
    void api
      .entry(attachTo)
      .then((t) => live && setTarget(t))
      .catch(() => live && setTarget(null));
    return () => {
      live = false;
    };
  }, [api, attachTo]);

  const matchKey = state ? `${state.draft.merchant.value ?? ''}|${state.draft.total.value ?? ''}|${state.draft.date.value ?? ''}` : '';
  useEffect(() => {
    if (!ctx || !state || attachTo) return;
    let live = true;
    void api
      .matches(state.draft, ctx.timezoneId)
      .then((m) => live && setMatches(m))
      .catch(() => live && setMatches([]));
    return () => {
      live = false;
    };
    // The prompt follows the shop, total and date only.
  }, [api, ctx, matchKey, attachTo]);

  const discardRef = useRef<(() => void) | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Android back asks the same question as the Back arrow: nothing is saved unless the person says so.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Before the review has loaded there is nothing to keep, so Back just closes.
      (discardRef.current ?? closeRef.current)();
      return true;
    });
    return () => sub.remove();
  }, []);

  const view = useMemo(() => (state && ctx ? viewOf(state, ctx.todayLocal) : null), [state, ctx]);
  const update = useCallback((f: (s: ReviewState) => ReviewState) => setState((s) => (s ? f(s) : s)), []);

  if (!ctx || !state || !view)
    return (
      <ScreenFrame testID="receipt-review-loading">
        <TopBar title={copy.receiptReview.title} onBack={onClose} />
        {loadFailed ? (
          <View style={styles.content}>
            <Text testID="receipt-load-failed" accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
              {copy.receiptReview.unreadable}
            </Text>
            <Button label={copy.receiptReview.close} testID="receipt-load-close" onPress={onClose} />
          </View>
        ) : null}
      </ScreenFrame>
    );

  const money = (minor: number) => moneyText(minor, ctx.currency, ctx.locale);
  const catOf = (id: string) => ctx.categories.find((c) => c.id === id);
  const catName = (id: string) => ctx.categories.find((c) => c.id === id)?.name ?? copy.receiptReview.notItemised;
  const accountName = ctx.accounts.find((a) => a.id === state.accountId)?.name ?? copy.receiptReview.cash;

  const editAmount = (id: string, title: string, current: number | null, doneLabel: string, apply: (minor: number) => void, allowZero = false) =>
    sheet.open({ id, title, body: (close) => <AmountEditor initialMinor={current} exponent={ctx.exponent} locale={ctx.locale} doneLabel={doneLabel} allowZero={allowZero} onDone={(m) => { apply(m); close(); }} /> });
  const editText = (id: string, title: string, initial: string, maxLength: number, apply: (v: string) => void, keyboard?: 'numbers-and-punctuation', validate?: (v: string) => string | null) =>
    sheet.open({ id, title, body: (close) => <TextEditor label={title} initial={initial} maxLength={maxLength} {...(keyboard ? { keyboard } : {})} {...(validate ? { validate } : {})} onDone={(v) => { apply(v.trim()); close(); }} /> });

  const pickCategory = (itemIndex: number) =>
    sheet.open({
      id: 'item-category',
      title: copy.receiptReview.changeCategory,
      body: (close) => (
        <View style={styles.wrap}>
          <Chip onGlass label={copy.receiptReview.followMain} testID="pick-category-main" selected={state.itemChoices[itemIndex] === null} onPress={() => { update((st) => setItemCategory(st, itemIndex, null)); close(); }} />
          {ctx.categories.map((c) => (
            <Chip onGlass key={c.id} label={c.name} testID={`pick-category-${c.id}`} selected={state.itemChoices[itemIndex] === c.id} onPress={() => { update((st) => setItemCategory(st, itemIndex, c.id)); close(); }} />
          ))}
        </View>
      ),
    });
  const editItemSheet = (index: number) => {
    const it = state.draft.items[index]!;
    sheet.open({
      id: 'edit-item',
      title: copy.receiptReview.itemTitle,
      body: (close) => (
        <ItemEditor
          initialName={it.name}
          initialMinor={it.amountMinor}
          exponent={ctx.exponent}
          categories={ctx.categories}
          initialCategoryId={null}
          withCategory={false}
          onSave={(name, minor) => { update((st) => editItem(st, index, { name, amountMinor: minor })); close(); }}
          onRemove={() => { update((st) => removeItem(st, index)); close(); }}
        />
      ),
    });
  };
  const addItemSheet = () =>
    sheet.open({
      id: 'add-item',
      title: copy.receiptReview.addItem,
      body: (close) => (
        <ItemEditor initialName="" initialMinor={null} exponent={ctx.exponent} categories={ctx.categories} initialCategoryId={null} withCategory onSave={(name, minor, categoryId) => { update((st) => addItem(st, { name, amountMinor: minor, categoryId })); close(); }} />
      ),
    });

  const d = state.draft;
  const total = d.total.value;
  const holdingForMatch = !attachTo && matches.length > 0 && !separate;
  const splitting = attachTo !== undefined && target ? target : null;
  const exceeds = splitting !== null && total !== null && total > splitting.amountMinor;
  const adjustment = splitting !== null && total !== null && total < splitting.amountMinor ? splitting.amountMinor - total : 0;
  const splitHeader =
    splitting === null
      ? ''
      : matchText({ today: copy.receiptSplit.header, other: copy.receiptSplit.headerOther }, splitting.occurredAtMs, splitting.localDate, ctx.todayLocal, ctx.timezoneId).replace('{amount}', money(splitting.amountMinor)).replace('{account}', splitting.accountName ?? '');

  const matchLine = (m: ReceiptMatch): string => {
    const line = matchText({ today: copy.receiptReview.matchesToday, other: copy.receiptReview.matchesOther }, m.occurredAtMs, m.localDate, ctx.todayLocal, ctx.timezoneId);
    return line.replace('{amount}', money(m.amountMinor)).replace('{account}', m.accountName ?? '').replace(/\s+/g, ' ').trim();
  };

  const discardAll = () => {
    onDiscardPhoto?.();
    toast.show({ message: copy.receiptReview.discarded });
    onClose();
  };

  const doAttach = async (m: { transactionId: string }, itemsMode?: 'replace' | 'keep', photoOnly = false) => {
    const input = saveInput(state, ctx.todayLocal) ?? (photoOnly ? { draft: state.draft, itemCategories: state.itemChoices, mainCategoryId: state.mainCategoryId } : null);
    if (!input || attaching.current) {
      if (!input) setError(view.blocked === 'total' ? copy.receiptReview.saveHintTotal : copy.receiptReview.saveHintMismatch);
      return;
    }
    attaching.current = true;
    setError(null);
    submission.current ??= api.newSubmissionId();
    const r = await api
      .attach({ submissionId: submission.current, transactionId: m.transactionId, draft: input.draft, itemCategories: input.itemCategories, mainCategoryId: input.mainCategoryId, ...(itemsMode ? { itemsMode } : {}), ...(photoOnly ? { photoOnly: true } : {}), ...(photo ? { attachment: { attachmentId: photo.attachmentId, digest: photo.digest, sizeBytes: photo.sizeBytes } } : {}) })
      .catch(() => ({ ok: false as const, code: 'ERROR' }));
    attaching.current = false;
    if (!r.ok) {
      setError(r.code === 'ENTRY_REMOVED' || r.code === 'ENTRY_NOT_FOUND' ? copy.receiptSplit.removed : copy.receiptReview.attachFailed);
      return;
    }
    await invalidateForEvent(qc, 'TransactionsChanged').catch(() => undefined);
    toast.show({
      message: copy.receiptReview.attached,
      undo: { label: copy.common.undo, onUndo: () => void api.undoAttach(r.value.undo).then(() => { onDiscardPhoto?.(); return invalidateForEvent(qc, 'TransactionsChanged'); }).catch(() => undefined) },
    });
    onSaved?.(m.transactionId);
    onClose();
  };

  const attachToMatch = async (m: ReceiptMatch) => {
    const old = await api.itemCount(m.transactionId).catch(() => 0);
    if (old === 0) return void doAttach(m);
    sheet.open({
      id: 'replace-items',
      title: copy.receiptReview.replaceTitle.replace('{old}', String(old)).replace('{new}', String(d.items.length)),
      body: (close) => (
        <View style={styles.editor}>
          <Button label={copy.receiptReview.replaceItems} testID="replace-items" onPress={() => { close(); void doAttach(m, 'replace'); }} onGlass />
          <Button label={copy.receiptReview.keepCurrentItems} variant="secondary" testID="keep-items" onPress={() => { close(); void doAttach(m, 'keep'); }} onGlass />
        </View>
      ),
    });
  };
  const discard = () =>
    sheet.open({
      id: 'receipt-discard',
      title: copy.receiptReview.discardTitle,
      body: (close) => (
        <View style={styles.editor}>
          <Text style={[textStyle('body'), { color: theme.color('on-glass-primary') }]}>{copy.receiptReview.discardBody}</Text>
          <Button label={copy.receiptReview.discard} variant="destructive" testID="discard-confirm" onPress={() => { close(); onDiscardPhoto?.(); onClose(); }} onGlass />
          <Button label={copy.receiptReview.keepEditing} variant="text" testID="discard-keep" onPress={close} onGlass />
        </View>
      ),
    });

  discardRef.current = discard;

  const save = async () => {
    const input = saveInput(state, ctx.todayLocal);
    if (!input || savingRef.current) return;
    savingRef.current = true;
    setError(null);
    submission.current ??= api.newSubmissionId();
    const r = await api.save({ submissionId: submission.current, ...input, createCash: input.accountId === null, ...(photo ? { attachment: { attachmentId: photo.attachmentId, digest: photo.digest, sizeBytes: photo.sizeBytes } } : {}), ...(separate ? { keepSeparate: true } : {}) }).catch(() => ({ ok: false as const, code: 'ERROR' }));
    if (!r.ok) {
      savingRef.current = false;
      setError(r.code === 'CURRENCY_DIFFERS' ? copy.receiptReview.currencyDiffers.replace('{currency}', d.currency.value ?? '') : r.code === 'DATE_INVALID' ? copy.receiptReview.dateInvalid : copy.receiptReview.saveFailed);
      return;
    }
    await invalidateForEvent(qc, 'TransactionsChanged').catch(() => undefined);
    const id = r.value.transactionId;
    if (r.value.result === 'POSSIBLE_DUPLICATE') duplicate.offer(id);
    else toast.show({ message: copy.receiptReview.saved, undo: { label: copy.common.undo, onUndo: () => void api.remove(id).then(() => invalidateForEvent(qc, 'TransactionsChanged')).catch(() => undefined) } });
    onSaved?.(id);
    onClose();
  };

  const chargeRows = (kind: ChargeKind, label: string) =>
    d[kind].map((c, i) => (
      <Row key={`${kind}-${i}`} testID={`row-${kind}-${i}`} label={`${kind === 'taxes' && view.allocation.taxIncluded ? copy.receiptReview.taxIncluded : label}${c.label && c.label.toLowerCase() !== label.toLowerCase() ? ` · ${c.label}` : ''}`} a11yLabel={readValue(label, money(c.value))} value={<Amount amountMinor={c.value} currency={ctx.currency} direction={kind === 'discounts' ? 'income' : 'neutral'} locale={ctx.locale} />} onPress={() => editAmount(`edit-${kind}-${i}`, label, c.value, copy.common.save, (m) => update((s) => setCharge(s, kind, i, m)), true)} />
    ));

  const mismatchText = copy.receiptReview.mismatch.replace('{read}', money(view.readMinor)).replace('{total}', money(total ?? 0));
  const blockedReason = view.blocked === 'total' ? copy.receiptReview.saveHintTotal : view.blocked === 'mismatch' ? copy.receiptReview.saveHintMismatch : undefined;
  const dateText = view.date;
  // Spoken as "7 Nov"; another year is said too.
  const spokenDate = isRealDate(dateText) ? `${Number(dateText.slice(8, 10))} ${MONTHS[Number(dateText.slice(5, 7)) - 1]}${dateText.slice(0, 4) === ctx.todayLocal.slice(0, 4) ? '' : ` ${dateText.slice(0, 4)}`}` : dateText;
  const readValue = (field: string, value: string) => copy.receiptReview.editValue.replace('{field}', field).replace('{value}', value);
  const foreign = d.currency.value !== null && d.currency.value.trim().toUpperCase() !== ctx.currency;
  // Cash is a choice of its own while no Cash account exists yet: saving with it creates one.
  const accountChoices: readonly { id: string | null; name: string }[] = [...ctx.accounts, ...(ctx.cashAccountId === null ? [{ id: null, name: copy.receiptReview.cash }] : [])];
  const shownCategories = showAll ? ctx.categories : withSelected(ctx.quick, ctx.categories, state.mainCategoryId);
  const chips = shownCategories.map((c) => <CategoryCell key={c.id} category={c} wide onGlass={false} selected={state.mainCategoryId === c.id} onPress={() => update((s) => setMainCategory(s, c.id))} />);

  return (
    <ScreenFrame testID="receipt-review">
      <TopBar title={copy.receiptReview.title} onBack={discard} backTestID="receipt-close" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text testID="receipt-intro" style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.intro}</Text>
        {splitting ? (
          <Text testID="split-header" accessibilityRole="header" style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{splitHeader}</Text>
        ) : null}
        {attachTo && target === null ? <Text testID="split-removed" accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{copy.receiptSplit.removed}</Text> : null}

        {holdingForMatch ? (
          <View testID="match-prompt" accessibilityRole="alert" style={[styles.matchBox, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('accent-primary') }]}>
            {matches.map((m) => (
              <View key={m.transactionId} style={styles.matchRow}>
                <Text testID={`match-${m.transactionId}`} style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{matchLine(m)}</Text>
                <Button label={copy.receiptReview.attachToIt} testID={`attach-${m.transactionId}`} onPress={() => void attachToMatch(m)} />
              </View>
            ))}
          </View>
        ) : null}
        <Row testID="row-merchant" label={copy.receiptReview.merchant} a11yLabel={readValue(copy.receiptReview.merchant, d.merchant.value ?? copy.receiptReview.merchantMissing)} value={<Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{d.merchant.value ?? copy.receiptReview.merchantMissing}</Text>} onPress={() => editText('edit-merchant', copy.receiptReview.merchant, d.merchant.value ?? '', 120, (v) => update((s) => setMerchant(s, v)))} />

        <Row
          testID="row-date"
          label={copy.receiptReview.date}
          a11yLabel={view.dateUncertain ? copy.receiptReview.dateReadout.replace('{date}', spokenDate) : copy.receiptReview.dateReadoutSure.replace('{date}', spokenDate)}
          value={
            <View style={styles.inline}>
              {view.dateUncertain ? <Icon icon={Warning} tint={theme.color('semantic-warning')} /> : null}
              <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{dateText}</Text>
              {view.dateUncertain ? <Text testID="date-unsure" style={[textStyle('caption'), { color: theme.color('semantic-warning') }]}>{copy.receiptReview.dateUnsure}</Text> : null}
            </View>
          }
          onPress={() => editText('edit-date', copy.receiptReview.date, dateText, 10, (v) => update((s) => setDate(s, v)), 'numbers-and-punctuation', (v) => (!isRealDate(v.trim()) ? copy.receiptReview.dateInvalid : v.trim() > ctx.todayLocal ? copy.receiptReview.dateFuture : null))}
        />

        {foreign ? (
          <>
            <Row testID="row-currency" warn label={copy.receiptReview.currency} a11yLabel={copy.receiptReview.currencyReadout.replace('{currency}', d.currency.value ?? '').replace('{profile}', ctx.currency)} value={<Text style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>{d.currency.value}</Text>} onPress={() => { setError(null); update((s) => setCurrency(s, ctx.currency)); }} />
            <Text testID="currency-hint" style={[textStyle('caption'), { color: theme.color('semantic-warning') }]}>{copy.receiptReview.currencyHint.replace(/\{profile\}/g, ctx.currency)}</Text>
          </>
        ) : null}

        <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.paidWith}</Text>
        <View style={styles.wrap}>
          {picking ? (
            accountChoices.map((a) => <Chip key={a.id ?? 'cash'} variant="paid-with" label={a.name} testID={`account-option-${a.id ?? 'cash'}`} selected={a.id === state.accountId} onPress={() => { update((s) => setAccount(s, a.id)); setPicking(false); }} />)
          ) : (
            <Chip variant="paid-with" label={accountName} selected testID="paid-with-chip" onPress={() => accountChoices.some((a) => a.id !== state.accountId) && setPicking(true)} />
          )}
        </View>

        <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.category}</Text>
        <View style={styles.wrap} testID="category-chips">
          {chips}
          {ctx.categories.length > ctx.quick.length ? <Chip label={showAll ? copy.add.fewer : copy.add.more} testID="category-more" onPress={() => setShowAll((v) => !v)} /> : null}
        </View>

        <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.categoryTotals}</Text>
        {view.categoryRows.map((r) => (
          <Row key={r.categoryId} testID={`total-${r.categoryId}`} label={catName(r.categoryId)} a11yLabel={copy.receiptReview.categoryTotalReadout.replace('{name}', catName(r.categoryId)).replace('{amount}', amountLabel({ amountMinor: r.amountMinor, currency: ctx.currency, locale: ctx.locale, inline: true }))} value={<Amount amountMinor={r.amountMinor} currency={ctx.currency} direction="expense" locale={ctx.locale} />} />
        ))}
        {view.allocation.notItemised > 0 ? (
          <View testID="not-itemised" accessible accessibilityLabel={`${copy.receiptReview.notItemisedRow.replace('{amount}', money(view.allocation.notItemised))}. ${copy.receiptReview.notItemisedHint}`} style={[styles.row, styles.grey, { borderColor: theme.color('border-hairline') }]}>
            <View style={{ flex: 1 }}>
              <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.notItemisedRow.replace('{amount}', money(view.allocation.notItemised))}</Text>
              <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.notItemisedHint}</Text>
            </View>
          </View>
        ) : null}

        {d.items.length > 0 ? (
          <Pressable testID="items-toggle" {...controlA11y({ label: copy.receiptReview.items.replace('{n}', String(d.items.length)), role: 'button', expanded: itemsOpen })} onPress={() => setItemsOpen((v) => !v)} style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
            <View style={{ flex: 1 }}>
              <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.receiptReview.items.replace('{n}', String(d.items.length))}</Text>
              {itemsOpen ? null : <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.itemsHint}</Text>}
            </View>
            <Icon icon={itemsOpen ? CaretUp : CaretDown} size={14} tint={theme.color('text-secondary')} />
          </Pressable>
        ) : null}
        {itemsOpen ? (
          <View testID="items-list" style={[styles.itemsCard, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          {view.allocation.items.map((it, position) => {
              const src = d.items[it.index]!;
              return (
                <View
                  key={it.index}
                  testID={`item-${it.index}`}
                  accessible
                  accessibilityLabel={`${src.name}, ${money(it.allocatedAmount)}, ${catName(it.categoryId)}`}
                  accessibilityActions={[{ name: 'changeCategory', label: copy.receiptReview.changeCategory }]}
                  onAccessibilityAction={(e) => e.nativeEvent.actionName === 'changeCategory' && pickCategory(it.index)}
                  style={[styles.itemRow, position > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color('border-hairline') } : null]}>
                  <Pressable testID={`item-edit-${it.index}`} {...controlA11y({ label: copy.receiptReview.editField.replace('{field}', src.name), role: 'button' })} onPress={() => editItemSheet(it.index)} style={styles.itemTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{src.name}</Text>
                      {src.discountMinor > 0 ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.itemDiscount.replace('{amount}', money(src.discountMinor))}</Text> : null}
                    </View>
                    <Amount amountMinor={it.allocatedAmount} currency={ctx.currency} direction="expense" locale={ctx.locale} />
                  </Pressable>
                  <ItemCategoryButton testID={`item-chip-${it.index}`} label={it.categoryId === UNCATEGORISED_ID ? copy.receiptReview.chooseCategory : copy.receiptReview.categoryFor.replace('{name}', catName(it.categoryId))} unset={it.categoryId === UNCATEGORISED_ID} onPress={() => pickCategory(it.index)}>
                    {it.categoryId === UNCATEGORISED_ID ? null : <CategoryChip categoryId={it.categoryId} icon={catOf(it.categoryId)?.icon ?? 'Tag'} colour={catOf(it.categoryId)?.colorToken ?? 'cat-sky'} size={20} />}
                  </ItemCategoryButton>
                </View>
              );
            })}
          </View>
        ) : null}
        {itemsOpen && view.allocation.notItemised > 0 ? (
          <View style={styles.addItem}>
            <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.receiptReview.addItemHint}</Text>
            <Button label={copy.receiptReview.addItem} variant="secondary" testID="add-item" onPress={addItemSheet} />
          </View>
        ) : null}

        {d.subtotal.value !== null ? <Row testID="row-subtotal" label={copy.receiptReview.subtotal} a11yLabel={readValue(copy.receiptReview.subtotal, money(d.subtotal.value))} value={<Amount amountMinor={d.subtotal.value} currency={ctx.currency} direction="neutral" locale={ctx.locale} />} onPress={() => editAmount('edit-subtotal', copy.receiptReview.subtotal, d.subtotal.value, copy.common.save, (m) => update((s) => setSubtotal(s, m)), true)} /> : null}
        {chargeRows('taxes', copy.receiptReview.tax)}
        {chargeRows('fees', copy.receiptReview.fees)}
        {chargeRows('discounts', copy.receiptReview.discount)}

        <Row
          testID="row-total"
          warn={view.totalNeedsConfirm}
          label={copy.receiptReview.total}
          a11yLabel={total === null ? copy.receiptReview.totalMissing : view.totalNeedsConfirm ? copy.receiptReview.totalReadoutConfirm.replace('{amount}', money(total)) : copy.receiptReview.totalReadout.replace('{amount}', money(total))}
          value={
            <View style={styles.inline}>
              {view.totalNeedsConfirm ? <Icon icon={Warning} tint={theme.color('semantic-warning')} /> : null}
              {total === null ? <Text style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>{copy.receiptReview.totalMissing}</Text> : <Amount amountMinor={total} currency={ctx.currency} direction="expense" role="body-medium" locale={ctx.locale} />}
            </View>
          }
          onPress={() => editAmount('edit-total', copy.receiptReview.total, total, view.totalNeedsConfirm ? copy.receiptReview.confirm : copy.common.save, (m) => update((s) => (m === total ? confirmTotal(s) : setTotal(s, m))))}
        />
        {view.totalNeedsConfirm && total !== null ? <Text testID="total-confirm-hint" style={[textStyle('caption'), { color: theme.color('semantic-warning') }]}>{copy.receiptReview.totalConfirm}</Text> : null}

        {view.blocked === 'mismatch' ? (
          <Text testID="mismatch-warning" accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
            {mismatchText}
          </Text>
        ) : null}
        {adjustment > 0 ? <Text testID="split-tip" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.receiptSplit.tip.replace('{amount}', money(adjustment))}</Text> : null}
        {exceeds && splitting ? <Text testID="split-exceeds" accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{copy.receiptSplit.exceeds.replace('{receipt}', money(total ?? 0)).replace('{entry}', money(splitting.amountMinor))}</Text> : null}
        {error ? <Text testID="save-error" accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{error}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
        {attachTo ? (
          <View style={styles.matchChoices}>
            <Button label={copy.receiptSplit.attachAndSplit} testID="split-attach" {...(target === undefined || target === null ? { disabledReason: copy.receiptSplit.removed } : exceeds ? { disabledReason: copy.receiptSplit.exceeds.replace('{receipt}', money(total ?? 0)).replace('{entry}', money(target.amountMinor)) } : blockedReason ? { disabledReason: blockedReason } : {})} onPress={() => void attachToMatch({ transactionId: attachTo } as ReceiptMatch)} />
            {exceeds ? <Button label={copy.receiptSplit.photoOnly} variant="secondary" testID="split-photo-only" onPress={() => void doAttach({ transactionId: attachTo }, undefined, true)} /> : null}
          </View>
        ) : holdingForMatch ? (
          <View style={styles.matchChoices}>
            <Button label={copy.receiptReview.keepSeparate} variant="secondary" testID="keep-separate" onPress={() => setSeparate(true)} />
            <Button label={copy.receiptReview.discardReceipt} variant="destructive" testID="match-discard" onPress={discardAll} />
          </View>
        ) : (
          <Button label={copy.receiptReview.save} testID="receipt-save" {...(blockedReason ? { disabledReason: blockedReason } : {})} onPress={() => void save()} />
        )}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 6, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, minHeight: layout.touchMin, paddingVertical: 4 },
  grey: { opacity: 0.8 },
  addItem: { gap: 4 },
  itemsCard: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 4 },
  itemRow: { paddingVertical: 6 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: layout.touchMin },
  itemCategoryRing: { alignSelf: 'flex-start' },
  itemCategory: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: layout.touchMin, borderWidth: 1, borderRadius: layout.touchMin / 2, paddingLeft: 8, paddingRight: 12 },
  value: { alignItems: 'flex-end', flexShrink: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  editor: { gap: 12, paddingBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  footer: { padding: 12, borderTopWidth: 1 },
  matchBox: { borderWidth: 2, borderRadius: radii.md, padding: 12, gap: 8 },
  matchRow: { gap: 8 },
  matchChoices: { gap: 8 },
});
