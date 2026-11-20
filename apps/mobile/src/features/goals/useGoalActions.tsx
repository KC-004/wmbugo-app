import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { parseAmountInput, parseExceedsSetAside, shortfallAfterHolding, type CurrencyCode, type GoalRow, type GoalState, type SaveGoalInput } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { moneyText } from '../../shared/ui/moneyText';
import { GoalSheet } from './GoalSheet';
import type { AllocationOutcome, GoalsApi } from './goalsApi';

const g = copy.goals;

/** A goal as the save input that would write it again: the Undo of an edit. */
export const goalAsInput = (goal: GoalRow): SaveGoalInput => ({ id: goal.id, name: goal.name, targetMinor: goal.targetMinor, dueMonth: goal.dueDate ? goal.dueDate.slice(0, 7) : null, icon: goal.icon, color: goal.color, accountId: goal.accountId });

/** The Set aside and Take back sheet: one amount, an error that keeps what was typed, and (for Set aside) the caption that nothing moves. */
function AmountBody({ exponent, money, caption, confirmLabel, onSubmit, close, extra }: { exponent: number; money: (n: number) => string; caption?: string; confirmLabel: string; onSubmit: (minor: number) => Promise<AllocationOutcome>; close: () => void; extra?: (minor: number | null) => string | null }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const ink = { color: theme.color('on-glass-primary') };
  const parsed = parseAmountInput(text, exponent);
  const minor = parsed.ok && parsed.value > 0 ? parsed.value : null;
  const note = extra ? extra(minor) : null;
  const submit = async () => {
    if (busy) return;
    if (minor === null) {
      setError(g.errAmount);
      ref.current?.focus();
      return;
    }
    setBusy(true);
    let r: AllocationOutcome;
    try {
      r = await onSubmit(minor);
    } catch {
      r = { ok: false, code: 'WRITE_FAILED' };
    } finally {
      setBusy(false);
    }
    if (r.ok) return close();
    const only = parseExceedsSetAside(r.code);
    setError(only !== null ? g.errOnly.replace('{amount}', money(only)) : r.code === 'AMOUNT_REQUIRED' ? g.errAmount : g.actionFailed);
  };
  return (
    <View testID="goal-amount-sheet" style={styles.gap}>
      <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{g.amount}</Text>
      <TextInput ref={ref} testID="goal-amount-input" autoFocus accessibilityLabel={g.amount} keyboardType="decimal-pad" value={text} onChangeText={(t) => { setText(t); setError(null); }} style={[styles.input, textStyle('body'), ink, { borderColor: error ? theme.color('semantic-warning') : theme.color('on-glass-secondary') }]} />
      {caption ? <Text style={[textStyle('caption'), { color: theme.color('on-glass-secondary') }]}>{caption}</Text> : null}
      {note ? <Text testID="goal-amount-note" accessibilityLiveRegion="polite" style={[textStyle('caption'), ink]}>{note}</Text> : null}
      {error ? <Text testID="goal-amount-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>{error}</Text> : null}
      <Button label={confirmLabel} testID="goal-amount-confirm" onPress={() => void submit()} />
    </View>
  );
}

function ConfirmBody({ text, action, actionTestID, onConfirm, close }: { text: string; action: string; actionTestID: string; onConfirm: () => void; close: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.gap}>
      <Text style={[textStyle('body'), { color: theme.color('on-glass-primary') }]}>{text}</Text>
      <Button label={action} testID={actionTestID} onPress={() => { close(); onConfirm(); }} />
      <Button label={g.cancel} variant="text" onGlass testID="goal-confirm-cancel" onPress={close} />
    </View>
  );
}

/**
 * What the goals list and a goal's detail do with a goal: the editor and the Set aside and Take back sheets with their toasts
 * and Undo, and the lifecycle changes (pause, resume, complete, archive, restore). Every change refreshes goals, Plan and Home.
 */
export function useGoalActions(api: GoalsApi, display: { currency: CurrencyCode; locale: string; exponent: number }) {
  const sheet = useSheet();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = () => invalidateForEvent(qc, 'GoalsChanged');
  const money = (n: number) => moneyText(n, display.currency, display.locale);
  const failed = () => toast.show({ message: g.actionFailed });

  const openEditor = (goal: GoalRow | null, accounts: readonly { id: string; name: string; isPot?: boolean }[], thisMonth: string) => {
    sheet.open({
      id: 'goal',
      title: goal ? g.editTitle : g.addTitle,
      body: (close) => (
        <GoalSheet
          goal={goal}
          exponent={display.exponent}
          accounts={accounts}
          thisMonth={thisMonth}
          close={close}
          onSave={async (input) => {
            const r = await api.save(input);
            if (!r.ok) return r;
            void refresh();
            const saved = r.value;
            toast.show({
              message: saved.created ? g.added : g.savedToast,
              undo: {
                label: copy.common.undo,
                onUndo: () =>
                  void (saved.created ? api.undoAdd(saved.goalId) : api.save(goalAsInput(goal!)).then((u) => ({ ok: u.ok })))
                    .then(async (u) => (u.ok ? refresh() : toast.show({ message: g.undoFailed })))
                    .catch(() => toast.show({ message: g.undoFailed })),
              },
            });
            return r;
          }}
        />
      ),
    });
  };

  const openAmount = async (goal: GoalRow, kind: 'set_aside' | 'take_back') => {
    // Setting aside more than Free to use shows a polite warning and stays allowed (GOAL-004).
    const free = kind === 'set_aside' ? await api.freeToUse?.().catch(() => null) : null;
    const extra = free ? (minor: number | null): string | null => { const short = minor === null ? null : shortfallAfterHolding(free, minor); return short === null ? null : g.shortWarn.replace('{amount}', money(short)); } : undefined;
    sheet.open({
      id: `goal-${kind}`,
      title: (kind === 'set_aside' ? g.setAsideTitle : g.takeBackTitle).replace('{name}', goal.name),
      body: (close) => (
        <AmountBody
          exponent={display.exponent}
          money={money}
          confirmLabel={kind === 'set_aside' ? g.setAside : g.takeBack}
          {...(kind === 'set_aside' ? { caption: g.setAsideCaption } : {})}
          {...(extra ? { extra } : {})}
          close={close}
          onSubmit={async (minor) => {
            const r = await (kind === 'set_aside' ? api.setAside(goal.id, minor) : api.takeBack(goal.id, minor));
            if (!r.ok) return r;
            void refresh();
            toast.show({
              message: (kind === 'set_aside' ? g.setAsideToast : g.takeBackToast).replace('{amount}', money(minor)).replace('{name}', goal.name),
              undo: {
                label: copy.common.undo,
                onUndo: () =>
                  void api
                    .undoAllocation(r.value.allocationId)
                    .then(async (u) => (u.ok ? refresh() : toast.show({ message: u.code === 'PART_MOVED' ? g.partMoved : g.undoFailed })))
                    .catch(() => toast.show({ message: g.undoFailed })),
              },
            });
            return r;
          }}
        />
      ),
    });
  };

  const change = async (goal: GoalRow, to: GoalState) => {
    // Restoring a goal that holds money again can leave Free to use short: the same warning, never a block. Free to use is read
    // before the change, while the goal's money is still counted as free; read afterwards it would already include it.
    const free = to === 'active' && (goal.state === 'completed' || goal.state === 'archived') && goal.setAsideMinor > 0 ? await api.freeToUse?.().catch(() => null) : null;
    const r = await api.changeState(goal.id, to).catch(() => ({ ok: false as const }));
    if (!r.ok) return failed();
    void refresh();
    const word = to === 'paused' ? g.paused.toLowerCase() : to === 'completed' ? g.completed.toLowerCase() : to === 'archived' ? g.archived.toLowerCase() : 'is active';
    const short = free ? shortfallAfterHolding(free, goal.setAsideMinor) : null;
    const base = g.stateToast.replace('{name}', goal.name).replace('{state}', to === 'active' ? 'is active again' : word);
    toast.show({ message: short === null ? base : `${base} · ${g.shortWarn.replace('{amount}', money(short))}`, undo: { label: copy.common.undo, onUndo: () => void api.changeState(goal.id, goal.state).then(async (u) => (u.ok ? refresh() : toast.show({ message: g.undoFailed }))).catch(() => toast.show({ message: g.undoFailed })) } });
  };

  const confirmComplete = (goal: GoalRow) => {
    sheet.open({
      id: 'goal-complete',
      title: g.markComplete,
      body: (close) => (
        <ConfirmBody
          text={goal.setAsideMinor > 0 ? g.completeConfirm.replace('{name}', goal.name).replace('{amount}', money(goal.setAsideMinor)) : g.completeConfirmNone.replace('{name}', goal.name)}
          action={g.completeAction}
          actionTestID="goal-complete-confirm"
          close={close}
          onConfirm={() => void change(goal, 'completed')}
        />
      ),
    });
  };

  const confirmArchive = (goal: GoalRow) => {
    sheet.open({
      id: 'goal-archive',
      title: g.archive,
      body: (close) => <ConfirmBody text={g.archiveConfirm.replace('{name}', goal.name)} action={g.archiveAction} actionTestID="goal-archive-confirm" close={close} onConfirm={() => void change(goal, 'archived')} />,
    });
  };

  return { openEditor, openAmount, change, confirmComplete, confirmArchive, refresh };
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
