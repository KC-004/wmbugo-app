import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { realGoalsApi, transferGoalKey, type GoalsApi } from './goalsApi';

const g = copy.goals;

/**
 * The goal part of a savings transfer's detail (Story 6.7): `Count toward a goal` with a goal picker when it has none, or
 * `For Goa trip` with `Remove` once tagged. One transfer counts toward one goal only. Nothing shows for any other entry, and
 * a failed read shows nothing rather than an error.
 */
export function TransactionGoalSection({ transactionId, api = realGoalsApi }: { transactionId: string; api?: GoalsApi }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const sheet = useSheet();
  const toast = useToast();
  const q = useQuery({ queryKey: transferGoalKey(transactionId), queryFn: () => api.forTransfer(transactionId) });
  const state = q.data;
  const refresh = () => invalidateForEvent(qc, 'GoalsChanged');
  if (!state) return null;

  if (state.goal) {
    const goal = state.goal;
    return (
      <View testID="transfer-goal" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{g.forGoal.replace('{name}', goal.name)}</Text>
        <Button
          label={g.removeTag}
          variant="text"
          testID="transfer-goal-remove"
          onPress={() =>
            void api
              .removeTag(transactionId)
              .then(async (r) => {
                if (!r.ok) return toast.show({ message: g.tagFailed });
                void refresh();
                toast.show({ message: g.untagToast.replace('{name}', goal.name), undo: { label: copy.common.undo, onUndo: () => void api.countToward(transactionId, goal.goalId).then(async (u) => (u.ok ? refresh() : toast.show({ message: g.undoFailed }))).catch(() => toast.show({ message: g.undoFailed })) } });
              })
              .catch(() => toast.show({ message: g.tagFailed }))
          }
        />
      </View>
    );
  }
  if (!state.canCount || state.goals.length === 0) return null;
  const pick = (goalId: string, name: string, close: () => void) => {
    close();
    void api
      .countToward(transactionId, goalId)
      .then(async (r) => {
        if (!r.ok) return toast.show({ message: r.code === 'NOT_GOALS_ACCOUNT' ? g.wrongPot : g.tagFailed });
        void refresh();
        toast.show({ message: g.tagToast.replace('{name}', name), undo: { label: copy.common.undo, onUndo: () => void api.removeTag(transactionId).then(async (u) => (u.ok ? refresh() : toast.show({ message: g.undoFailed }))).catch(() => toast.show({ message: g.undoFailed })) } });
      })
      .catch(() => toast.show({ message: g.tagFailed }));
  };
  return (
    <View testID="transfer-goal-offer" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Button
        label={g.countToward}
        variant="secondary"
        testID="transfer-goal-count"
        onPress={() =>
          sheet.open({
            id: 'transfer-goal-pick',
            title: g.pickGoal,
            body: (close) => (
              <View style={styles.gap}>
                {state.goals.map((x) => (
                  <Button key={x.id} label={x.name} variant="secondary" onGlass testID={`transfer-goal-pick-${x.id}`} onPress={() => pick(x.id, x.name, close)} />
                ))}
              </View>
            ),
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  gap: { gap: 8 },
});
