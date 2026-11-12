import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { kindsOverlap, typeChangeNote, UNCATEGORISED_ID, type CategoryRow, type RemapEntry, type RemapPreview } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { Amount } from '../../shared/ui/Amount';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import type { EntriesPage } from './categoriesApi';

export type ArchiveMode = 'archive' | 'merge' | 'delete';

export const PAGE = 20;

/** A Need, a Want, Not classified. */
const typePhrase = (t: string): string => (t === 'Not classified' ? t : copy.categories.typeArticle.replace('{type}', t).replace(/^A /, 'a '));
const AS_TYPE: Readonly<Record<string, string>> = { Need: copy.categories.asNeed, Want: copy.categories.asWant, 'Not classified': copy.categories.asNone };

/** `40 entries use Fuel.` / `52 entries use Transport and its 2 subcategories.` */
export function usageLine(p: RemapPreview): string {
  const c = copy.categories;
  const entries = p.entries === 1 ? c.entriesOne : c.entriesMany.replace('{n}', String(p.entries));
  if (p.subcategories > 0) return (p.subcategories === 1 ? c.useWithSubsOne : c.useWithSubsMany).replace('{entries}', entries).replace('{name}', p.name).replace('{subs}', String(p.subcategories));
  if (p.entries === 0) return c.useNone.replace('{name}', p.name);
  return (p.entries === 1 ? c.useOne : c.useMany).replace('{n}', String(p.entries)).replace('{name}', p.name);
}

/** The categories a merge can move into: not itself or its own subcategories, not Uncategorised, and a kind that can share entries. */
export function mergeTargets(from: CategoryRow, rows: readonly CategoryRow[]): CategoryRow[] {
  return rows.filter((c) => c.id !== from.id && c.parentId !== from.id && c.id !== UNCATEGORISED_ID && kindsOverlap(from.kind, c.kind));
}

/**
 * Archive, merge or delete one category. Nothing is written until the last button. Archive shows how many entries use the
 * category and lists them, with `Keep them in X` (default) or `Move them to another category`; the move reads exactly what
 * will change before Confirm. Delete is only offered for a category nothing uses.
 */
export function ArchiveSheet({
  mode,
  row,
  categories,
  load,
  loadEntries,
  onArchive,
  onMerge,
  onDelete,
  close,
}: {
  mode: ArchiveMode;
  row: CategoryRow;
  categories: readonly CategoryRow[];
  load: () => Promise<RemapPreview | null>;
  loadEntries: (limit: number, offset: number) => Promise<EntriesPage>;
  onArchive: () => Promise<string | null>;
  onMerge: (target: CategoryRow, entries: number) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
  close: () => void;
}) {
  const theme = useTheme();
  const ink = { color: theme.color('on-glass-primary') };
  const muted = { color: theme.color('on-glass-secondary') };
  const [preview, setPreview] = useState<RemapPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [moving, setMoving] = useState(mode === 'merge');
  const [target, setTarget] = useState<CategoryRow | null>(null);
  const [page, setPage] = useState<EntriesPage | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(0);

  useEffect(() => {
    let live = true;
    void load()
      .then((p) => live && setPreview(p))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // The preview is read once when the sheet opens.
  }, []);

  const fetchPage = async () => {
    try {
      const next = await loadEntries(PAGE + 1, loaded.current);
      const rows = next.rows.slice(0, PAGE);
      loaded.current += rows.length;
      setMore(next.rows.length > PAGE);
      setPage((cur) => (cur ? { ...next, rows: [...cur.rows, ...rows] } : { ...next, rows }));
    } catch {
      setError(copy.categories.actionFailed);
    }
  };
  useEffect(() => {
    if (mode !== 'delete') void fetchPage();
  }, []);

  const targets = useMemo(() => mergeTargets(row, categories), [row, categories]);
  const note = target ? typeChangeNote(row, target) : null;

  const finish = async (go: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    let problem: string | null;
    try {
      problem = await go();
    } catch {
      problem = copy.categories.actionFailed;
    } finally {
      setBusy(false);
    }
    if (problem) setError(problem);
    else close();
  };

  if (failed) return <Text testID="archive-error" style={[textStyle('body'), ink]}>{copy.categories.actionFailed}</Text>;
  if (!preview) return <View testID="archive-sheet" />;

  if (mode === 'delete') {
    return (
      <View testID="archive-sheet" style={styles.root}>
        <Text testID="archive-delete-text" style={[textStyle('body'), ink]}>{copy.categories.deleteConfirm.replace('{name}', preview.name)}</Text>
        {error ? <Text testID="archive-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button label={copy.categories.delete} testID="archive-delete" onPress={() => void finish(onDelete)} />
          <Button label={copy.categories.cancel} variant="text" onGlass testID="archive-cancel" onPress={close} />
        </View>
      </View>
    );
  }

  const mergeLine = target
    ? (preview.entries === 0 ? copy.categories.mergePreviewNone : preview.entries === 1 ? copy.categories.mergePreviewOne : copy.categories.mergePreviewMany.replace('{n}', String(preview.entries))).replace('{from}', row.name).replace('{to}', target.name)
    : null;

  return (
    <View testID="archive-sheet" style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled">
        <Text testID="archive-usage" style={[textStyle('body-medium'), ink]}>{usageLine(preview)}</Text>

        {preview.endingBudgets.length > 0 ? (
          <Text testID="archive-budget-ends" style={[textStyle('body'), ink]}>
            {preview.endingBudgets.map((n) => copy.budgets.endsAfter.replace('{name}', n)).join(' ')}
          </Text>
        ) : null}

        {mode === 'archive' ? (
          <View style={styles.row} accessibilityRole="radiogroup">
            <Chip onGlass role="radio" label={copy.categories.keepThem.replace('{name}', row.name)} testID="archive-keep" selected={!moving} onPress={() => { setMoving(false); setTarget(null); setError(null); }} />
            <Chip onGlass role="radio" label={copy.categories.moveThem} testID="archive-move" selected={moving} onPress={() => { setMoving(true); setError(null); }} />
          </View>
        ) : null}

        {moving ? (
          targets.length === 0 ? (
            <Text style={[textStyle('caption'), muted]}>{copy.categories.noTargets}</Text>
          ) : (
            <>
              <Text accessibilityRole="header" style={[textStyle('label'), ink]}>{copy.categories.moveTo}</Text>
              <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={copy.categories.moveTo}>
                {targets.map((c) => (
                  <Chip key={c.id} onGlass role="radio" label={c.name} testID={`archive-target-${c.id}`} selected={target?.id === c.id} onPress={() => { setTarget(c); setError(null); }} />
                ))}
              </View>
            </>
          )
        ) : null}

        {mergeLine ? <Text testID="archive-merge-text" style={[textStyle('body'), ink]}>{mergeLine}</Text> : null}
        {note && target ? (
          <Text testID="archive-type-note" style={[textStyle('body'), ink]}>
            {copy.categories.typeChange
              .replace('{from}', row.name)
              .replace('{fromType}', typePhrase(note.fromType))
              .replace('{to}', target.name)
              .replace('{toType}', typePhrase(note.toType))
              .replace('{asType}', AS_TYPE[note.toType] ?? note.toType)}
          </Text>
        ) : null}

        {page && page.rows.length > 0 ? (
          <View testID="archive-entries" style={styles.entries}>
            {page.rows.map((e) => (
              <EntryLine key={e.id} entry={e} page={page} />
            ))}
            {more ? <Button label={copy.categories.showMore} variant="text" onGlass testID="archive-more" onPress={() => void fetchPage()} /> : null}
          </View>
        ) : null}
      </ScrollView>
      {error ? <Text testID="archive-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>{error}</Text> : null}
      {moving ? (
        <Button label={copy.categories.confirm} testID="archive-confirm" disabledReason={target ? undefined : copy.categories.moveTo} onPress={() => (target ? void finish(() => onMerge(target, preview.entries)) : undefined)} />
      ) : (
        <Button label={copy.categories.archive} testID="archive-go" onPress={() => void finish(onArchive)} />
      )}
    </View>
  );
}

function EntryLine({ entry, page }: { entry: RemapEntry; page: EntriesPage }) {
  const theme = useTheme();
  const ink = { color: theme.color('on-glass-primary') };
  const muted = { color: theme.color('on-glass-secondary') };
  return (
    <View testID={`archive-entry-${entry.id}`} style={styles.entry}>
      <View style={styles.flex}>
        <Text style={[textStyle('body'), ink]} numberOfLines={1}>{entry.merchant ?? copy.categories.entryNoMerchant}</Text>
        <Text style={[textStyle('caption'), muted]}>{entry.localDate}</Text>
      </View>
      <Amount amountMinor={entry.amountMinor} currency={page.currency} locale={page.locale} direction={entry.type === 'income' ? 'income' : 'expense'} role="body" color="on-glass-primary" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 420 },
  gap: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { gap: 8 },
  entries: { gap: 4 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  flex: { flex: 1 },
});
