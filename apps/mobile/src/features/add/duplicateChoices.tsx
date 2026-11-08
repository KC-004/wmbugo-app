import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Chip } from '../../shared/ui/Chip';
import type { AddApi } from './addApi';

type DuplicateApi = Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'>;

/** "Which category?": the two categories as chips, the confirmed entry's first and selected by default. */
function CategoryChoice({ options, onChoose }: { options: readonly { id: string; name: string }[]; onChoose: (id: string) => void }) {
  const theme = useTheme();
  return (
    <View testID="merge-category-sheet" style={styles.gap}>
      <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('on-glass-primary') }]}>{copy.duplicate.whichCategory}</Text>
      <View style={styles.chips}>
        {options.map((o, i) => (
          <Chip key={o.id} onGlass label={o.name} variant="quick-category" selected={i === 0} testID={`merge-category-${o.id}`} onPress={() => onChoose(o.id)} />
        ))}
      </View>
    </View>
  );
}

/**
 * The two ways to answer "Looks like this is already recorded": Keep both, or Merge (asking which category when the two
 * differ). Used by the Add sheet's toast and by the flagged entry in Activity, so both paths do exactly the same.
 */
export function useDuplicateChoices(api: DuplicateApi) {
  const toast = useToast();
  const sheet = useSheet();
  const qc = useQueryClient();
  const refresh = useCallback(() => invalidateForEvent(qc, 'TransactionsChanged'), [qc]);

  const undoable = useCallback(
    (message: string, transactionId: string) => {
      toast.show({
        message,
        undo: {
          label: copy.common.undo,
          onUndo: () =>
            void api
              .undoResolution(transactionId)
              .then(async (r) => {
                await refresh();
                if (!r.ok) toast.show({ message: copy.duplicate.failed });
              })
              .catch(() => toast.show({ message: copy.duplicate.failed })),
        },
      });
    },
    [api, toast, refresh],
  );

  const keepBoth = useCallback(
    async (transactionId: string) => {
      const r = await api.keepBoth(transactionId).catch(() => ({ ok: false }));
      await refresh();
      if (!r.ok) return toast.show({ message: copy.duplicate.failed });
      undoable(copy.duplicate.keptBoth, transactionId);
    },
    [api, toast, refresh, undoable],
  );

  const doMerge = useCallback(
    async (transactionId: string, categoryId?: string) => {
      const r = await api.merge(transactionId, categoryId).catch(() => ({ ok: false }));
      await refresh();
      if (!r.ok) return toast.show({ message: copy.duplicate.failed });
      undoable(copy.duplicate.merged, transactionId);
    },
    [api, toast, refresh, undoable],
  );

  const merge = useCallback(
    async (transactionId: string) => {
      const info = await api.duplicateInfo(transactionId).catch(() => null);
      if (!info) return toast.show({ message: copy.duplicate.failed });
      if (info.categoriesDiffer && info.heldCategory && info.confirmedCategory) {
        sheet.open({
          id: 'merge-category',
          title: copy.duplicate.whichCategory,
          body: (close) => (
            <CategoryChoice
              options={[info.confirmedCategory!, info.heldCategory!]}
              onChoose={(id) => {
                close();
                void doMerge(transactionId, id);
              }}
            />
          ),
        });
        return;
      }
      await doMerge(transactionId);
    },
    [api, toast, sheet, doMerge],
  );

  /** The toast after a save that looks like a duplicate. */
  const offer = useCallback(
    (transactionId: string) => {
      toast.show({
        message: copy.duplicate.looksRecorded,
        choices: [
          { label: copy.duplicate.keepBoth, onChoose: () => void keepBoth(transactionId) },
          { label: copy.duplicate.merge, onChoose: () => void merge(transactionId) },
        ],
      });
    },
    [toast, keepBoth, merge],
  );

  return { offer, keepBoth, merge };
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
