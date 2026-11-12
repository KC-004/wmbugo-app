import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BudgetGroup, BudgetListRow } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { BudgetSheet, type BudgetSheetMode } from './BudgetSheet';
import { BUDGETS_QUERY_KEY, realBudgetsApi, type BudgetsApi, type BudgetsData } from './budgetsApi';
import { LimitBar } from '../../shared/ui/LimitBar';

const GROUPS: readonly { group: BudgetGroup; title: string }[] = [
  { group: 'overall', title: copy.budgets.groupOverall },
  { group: 'fifty_thirty_twenty', title: copy.budgets.groupTemplate },
  { group: 'categories', title: copy.budgets.groupCategories },
];

/**
 * SCR-14 Budgets, shown on the Plan tab until the Plan hub (Epic 6). Budgets are grouped Overall, 50/30/20 and Categories
 * and never added together. Each row is a limit bar counted from the entries; tap a row to edit it.
 */
export function BudgetsScreen({ api = realBudgetsApi, onUseTemplate }: { api?: BudgetsApi; /** The one-tap 50/30/20 split (Story 4.10) hooks in here. */ onUseTemplate?: () => void }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const sheet = useSheet();
  const toast = useToast();
  const q = useQuery({ queryKey: BUDGETS_QUERY_KEY, queryFn: () => api.load() });
  const data = q.data ?? null;

  const open = (start: BudgetSheetMode, d: BudgetsData) => {
    sheet.open({
      id: 'budget',
      title: start.mode === 'add' ? copy.budgets.addTitle : copy.budgets.editTitle,
      body: (close) => (
        <BudgetSheet
          start={start}
          data={d}
          close={close}
          onEditExisting={(id) => void edit(id, d)}
          onSave={async (input) => {
            const r = await api.save(input);
            if (r.ok) {
              await invalidateForEvent(qc, 'BudgetsChanged');
              const saved = r.value;
              toast.show({
                message: copy.budgets.saved,
                undo: {
                  label: copy.common.undo,
                  onUndo: () =>
                    void api
                      .undo({ budgetId: saved.budgetId, created: saved.created, snapshot: saved.snapshot! })
                      .then(async (u) => (u.ok ? invalidateForEvent(qc, 'BudgetsChanged') : toast.show({ message: copy.budgets.undoFailed })))
                      .catch(() => toast.show({ message: copy.budgets.undoFailed })),
                },
              });
            }
            return r;
          }}
        />
      ),
    });
  };

  const edit = async (id: string, d: BudgetsData) => {
    const budget = await api.readForEdit(id).catch(() => null);
    if (budget) open({ mode: 'edit', budget }, d);
  };

  if (q.isError) return <Text style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{copy.budgets.loadError}</Text>;
  if (!data) return null;
  const rows = data.list.rows;

  if (rows.length === 0) {
    return (
      <View testID="budgets-empty" style={styles.empty}>
        <Text style={[textStyle('body'), styles.center, { color: theme.color('text-primary') }]}>{copy.budgets.empty}</Text>
        <Button label={copy.budgets.add} testID="budgets-add" onPress={() => open({ mode: 'add' }, data)} />
        {onUseTemplate ? <Button label={copy.budgets.useTemplate} variant="secondary" testID="budgets-use-503020" onPress={onUseTemplate} /> : null}
      </View>
    );
  }

  return (
    <View testID="budgets-screen" style={styles.list}>
      <Button label={copy.budgets.add} variant="secondary" testID="budgets-add" onPress={() => open({ mode: 'add' }, data)} />
      {GROUPS.map(({ group, title }) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <View key={group} testID={`budgets-group-${group}`} style={styles.group}>
            <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{title}</Text>
            {inGroup.map((r) => (
              <BudgetRow key={r.id} row={r} data={data} onPress={() => void edit(r.id, data)} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function BudgetRow({ row, data, onPress }: { row: BudgetListRow; data: BudgetsData; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={`budget-row-${row.id}`}
      {...controlA11y({ label: `${row.name}, ${row.periodLabel}`, role: 'button' })}
      onPress={onPress}
      style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <LimitBar testID={`limit-${row.id}`} name={row.name} status={row.status} currency={data.currency} locale={data.locale} {...(row.overlapsOverall ? { caption: copy.budgets.alsoCounted } : {})} />
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{row.periodLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { gap: 12, alignItems: 'stretch', paddingVertical: 24 },
  center: { textAlign: 'center' },
  list: { gap: 16 },
  group: { gap: 8 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 6 },
});
