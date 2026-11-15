import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { dayMonthLabel, type BillRule, type BillKind, type SaveRecurringRuleInput } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { BillSheet, type BillPickers, type BillSheetMode } from './BillSheet';
import type { BillsApi } from './billsApi';

const b = copy.bills;

/** A rule as the save input that would write it again: the Undo of an edit. */
export const ruleAsInput = (r: BillRule): SaveRecurringRuleInput => ({
  id: r.id,
  title: r.title,
  expectedAmountMinor: r.expectedAmountMinor,
  cadence: r.cadence,
  customEvery: r.customEvery,
  customUnit: r.customUnit,
  anchorDate: r.anchorDate,
  accountId: r.accountId,
  categoryId: r.categoryId,
  kind: r.kind,
  paidTo: r.paidTo,
  endsOn: r.endsOn,
});

function ConfirmBody({ text, action, actionTestID, cancelTestID, onConfirm, close }: { text: string; action: string; actionTestID: string; cancelTestID: string; onConfirm: () => void; close: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.gap}>
      <Text style={[textStyle('body'), { color: theme.color('on-glass-primary') }]}>{text}</Text>
      <Button label={action} testID={actionTestID} onPress={() => { close(); onConfirm(); }} />
      <Button label={b.cancel} variant="text" onGlass testID={cancelTestID} onPress={close} />
    </View>
  );
}

/**
 * What the bills list and a bill's detail do with a bill: the editor sheet with its toast and Undo, and the confirmations
 * for Mark as paid, End and Delete. Every change refreshes the bills, Plan and Home areas through `RecurringChanged`.
 */
export function useBillActions(api: BillsApi) {
  const sheet = useSheet();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = () => invalidateForEvent(qc, 'RecurringChanged');
  const failed = () => toast.show({ message: b.actionFailed });

  const openEditor = (start: BillSheetMode, pickers: BillPickers, onSaved?: (ruleId: string) => void) => {
    sheet.open({
      id: 'bill',
      title: start.mode === 'add' ? b.addTitle : b.editTitle,
      body: (close) => (
        <BillSheet
          start={start}
          pickers={pickers}
          close={close}
          onSave={async (input) => {
            const r = await api.save(input);
            if (!r.ok) return r;
            await refresh();
            onSaved?.(r.value.ruleId);
            const saved = r.value;
            const previous = start.mode === 'edit' ? ruleAsInput(start.rule) : null;
            toast.show({
              message: saved.created ? b.added : b.savedToast,
              undo: {
                label: copy.common.undo,
                onUndo: () =>
                  void (previous ? api.save(previous).then((u) => ({ ok: u.ok })) : api.remove(saved.ruleId))
                    .then(async (u) => (u.ok ? refresh() : toast.show({ message: b.undoFailed })))
                    .catch(() => toast.show({ message: b.undoFailed })),
              },
            });
            return r;
          }}
        />
      ),
    });
  };

  const confirmMarkPaid = (rule: { id: string; title: string }, dueDate: string, onDone?: () => void) => {
    sheet.open({
      id: 'bill-mark',
      title: b.markAsPaid,
      body: (close) => (
        <ConfirmBody
          text={b.markConfirm.replace('{name}', rule.title).replace('{date}', dayMonthLabel(dueDate))}
          action={b.markAction}
          actionTestID="bill-mark-confirm"
          cancelTestID="bill-mark-cancel"
          close={close}
          onConfirm={() =>
            void (async () => {
              const r = await api.markPaid(rule.id, dueDate).catch(() => ({ ok: false as const }));
              if (!r.ok) return failed();
              await refresh();
              onDone?.();
              toast.show({ message: b.markedToast, undo: { label: copy.common.undo, onUndo: () => void api.unmarkPaid(rule.id, dueDate).then(refresh).catch(() => toast.show({ message: b.undoFailed })) } });
            })()
          }
        />
      ),
    });
  };

  const confirmEnd = (rule: { id: string; title: string }, onDone?: () => void) => {
    sheet.open({
      id: 'bill-end',
      title: b.end,
      body: (close) => (
        <ConfirmBody
          text={b.endConfirm.replace('{name}', rule.title)}
          action={b.endAction}
          actionTestID="bill-end-confirm"
          cancelTestID="bill-end-cancel"
          close={close}
          onConfirm={() =>
            void (async () => {
              const r = await api.end(rule.id).catch(() => ({ ok: false as const }));
              if (!r.ok) return failed();
              await refresh();
              onDone?.();
              toast.show({ message: b.endedToast });
            })()
          }
        />
      ),
    });
  };

  const confirmDelete = (rule: { id: string; title: string }, onDone?: () => void) => {
    sheet.open({
      id: 'bill-delete',
      title: b.delete,
      body: (close) => (
        <ConfirmBody
          text={b.deleteConfirm.replace('{name}', rule.title)}
          action={b.deleteAction}
          actionTestID="bill-delete-confirm"
          cancelTestID="bill-delete-cancel"
          close={close}
          onConfirm={() =>
            void (async () => {
              const r = await api.remove(rule.id).catch(() => ({ ok: false as const }));
              if (!r.ok) return failed();
              await refresh();
              onDone?.();
              toast.show({ message: b.deletedToast, undo: { label: copy.common.undo, onUndo: () => void api.restore(rule.id).then(refresh).catch(() => toast.show({ message: b.undoFailed })) } });
            })()
          }
        />
      ),
    });
  };

  const pause = async (rule: { id: string; title: string }) => {
    const r = await api.pause(rule.id).catch(() => ({ ok: false as const }));
    if (!r.ok) return failed();
    await refresh();
    toast.show({ message: b.pausedToast.replace('{name}', rule.title), undo: { label: copy.common.undo, onUndo: () => void api.resume(rule.id).then(refresh).catch(() => toast.show({ message: b.undoFailed })) } });
  };

  const resume = async (rule: { id: string; title: string }) => {
    const r = await api.resume(rule.id).catch(() => ({ ok: false as const }));
    if (!r.ok) return failed();
    await refresh();
    const d = await api.loadDetail(rule.id).catch(() => null);
    const next = d && d !== 'missing' ? d.detail.row.nextDue : null;
    toast.show({ message: next ? b.resumedToast.replace('{name}', rule.title).replace('{date}', dayMonthLabel(next)) : b.resumedPlain.replace('{name}', rule.title) });
  };

  return { openEditor, confirmMarkPaid, confirmEnd, confirmDelete, pause, resume, refresh };
}

export type { BillKind };

const styles = StyleSheet.create({ gap: { gap: 12 } });
