import { useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretDown, CaretUp } from 'phosphor-react-native';
import { budgetTypeCaption, UNCATEGORISED_ID, type CategoryRow } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { CATEGORIES_QUERY_KEY, realCategoriesApi, type CategoriesApi } from './categoriesApi';
import { CategoryChip } from './CategoryChip';
import { CategorySheet, type CategorySheetMode } from './CategorySheet';

const CAPTION: Readonly<Record<'Need' | 'Want' | 'Not classified', string>> = {
  Need: copy.categories.need,
  Want: copy.categories.want,
  'Not classified': copy.categories.notClassified,
};

interface Line {
  readonly row: CategoryRow;
  readonly parent: CategoryRow | null;
  /** The categories this one can swap places with, in order. */
  readonly siblings: readonly CategoryRow[];
}

/** Top-level categories of a kind in their order, each followed by its subcategories (indented by the row). */
export function linesFor(rows: readonly CategoryRow[], segment: 'expense' | 'income'): Line[] {
  // A Both category is listed in both segments.
  const tops = rows.filter((r) => (r.kind === segment || r.kind === 'mixed') && r.parentId === null);
  const lines: Line[] = [];
  for (const top of tops) {
    lines.push({ row: top, parent: null, siblings: tops });
    const children = rows.filter((r) => r.parentId === top.id);
    for (const child of children) lines.push({ row: child, parent: top, siblings: children });
  }
  return lines;
}

/**
 * SCR-18 Categories: a Spending / Income switch, then the categories in their order with a 40dp icon chip, the name and
 * (for spending) Need / Want / Not classified. Tap a row to edit it. Move up / Move down (and TalkBack actions) reorder;
 * subcategories travel with their parent. `Uncategorised` is the system fallback and has no controls.
 */
export function CategoriesScreen({ api = realCategoriesApi }: { api?: CategoriesApi }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const sheet = useSheet();
  const toast = useToast();
  const [segment, setSegment] = useState<'expense' | 'income'>('expense');
  const q = useQuery({ queryKey: CATEGORIES_QUERY_KEY, queryFn: () => api.load() });
  const rows = q.data?.rows ?? null;

  const open = (start: CategorySheetMode) => {
    if (!rows) return;
    sheet.open({
      id: 'category',
      title: start.mode === 'add' ? copy.categories.addTitle : copy.categories.editTitle,
      body: (close) => (
        <CategorySheet
          start={start}
          categories={rows}
          close={close}
          onSave={async (input) => {
            const r = await api.save(input);
            if (r.ok) {
              await invalidateForEvent(qc, 'CategoriesChanged');
              toast.show({ message: start.mode === 'add' ? copy.categories.added.replace('{name}', input.name.trim().replace(/\s+/g, ' ')) : copy.categories.saved });
            }
            return r;
          }}
        />
      ),
    });
  };

  const move = async (line: Line, direction: 'up' | 'down') => {
    const r = await api.move(line.row.id, direction, segment);
    if (!r.ok) return;
    await invalidateForEvent(qc, 'CategoriesChanged');
    AccessibilityInfo.announceForAccessibility(copy.categories.moved.replace('{name}', line.row.name).replace('{n}', String(r.value.position)).replace('{of}', String(r.value.of)));
  };

  if (q.isError) return <Text style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{copy.categories.loadError}</Text>;
  if (!rows) return null;
  const lines = linesFor(rows, segment);

  return (
    <View style={styles.gap} testID="categories-screen">
      <View style={styles.segments} accessibilityRole="radiogroup">
        <Chip role="radio" variant="period" label={copy.categories.spending} testID="categories-segment-expense" selected={segment === 'expense'} onPress={() => setSegment('expense')} />
        <Chip role="radio" variant="period" label={copy.categories.income} testID="categories-segment-income" selected={segment === 'income'} onPress={() => setSegment('income')} />
      </View>
      <Button label={copy.categories.add} variant="secondary" testID="categories-add" onPress={() => open({ mode: 'add', kind: segment })} />
      {lines.map((line) => {
        const { row, parent, siblings } = line;
        const system = row.id === UNCATEGORISED_ID;
        const i = siblings.findIndex((s) => s.id === row.id);
        const typeCaption = segment === 'expense' ? CAPTION[budgetTypeCaption(row.budgetType)] : null;
        const also = row.kind === 'mixed' ? (segment === 'expense' ? copy.categories.alsoIncome : copy.categories.alsoSpending) : null;
        const caption = [typeCaption, also].filter(Boolean).join(' · ') || null;
        const spoken = [row.name, parent ? copy.categories.subcategoryOf.replace('{parent}', parent.name) : null, caption].filter(Boolean).join(', ');
        return (
          <View key={row.id} style={[styles.line, parent && styles.indent]}>
            <Pressable
              testID={`category-row-${row.id}`}
              {...controlA11y({ label: spoken, role: system ? 'text' : 'button' })}
              accessibilityActions={system ? undefined : [...(i > 0 ? [{ name: 'moveUp', label: copy.categories.moveUp }] : []), ...(i < siblings.length - 1 ? [{ name: 'moveDown', label: copy.categories.moveDown }] : [])]}
              onAccessibilityAction={(e) => void move(line, e.nativeEvent.actionName === 'moveUp' ? 'up' : 'down')}
              onPress={system ? undefined : () => open({ mode: 'edit', row })}
              style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
              <CategoryChip categoryId={row.id} icon={row.icon} colour={row.colorToken} />
              <View style={styles.text}>
                <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{row.name}</Text>
                {caption ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{caption}</Text> : null}
              </View>
            </Pressable>
            {system ? null : (
              <View style={styles.moves}>
                <MoveButton testID={`category-up-${row.id}`} label={`${copy.categories.moveUp} ${row.name}`} icon={CaretUp} hidden={i <= 0} onPress={() => void move(line, 'up')} />
                <MoveButton testID={`category-down-${row.id}`} label={`${copy.categories.moveDown} ${row.name}`} icon={CaretDown} hidden={i >= siblings.length - 1} onPress={() => void move(line, 'down')} />
              </View>
            )}
          </View>
        );
      })}
      {segment === 'expense' ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.categories.systemNote}</Text> : null}
    </View>
  );
}

function MoveButton({ label, icon, hidden, onPress, testID }: { label: string; icon: typeof CaretUp; hidden: boolean; onPress: () => void; testID: string }) {
  if (hidden) return <View style={styles.moveSlot} />;
  return (
    <Pressable testID={testID} {...controlA11y({ label, role: 'button' })} onPress={onPress} style={styles.moveSlot}>
      <Icon icon={icon} size={20} color="text-secondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  segments: { flexDirection: 'row', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  indent: { marginLeft: 24 },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radii.md, padding: 8, minHeight: layout.touchMin },
  text: { flex: 1 },
  moves: { flexDirection: 'row' },
  moveSlot: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
});
