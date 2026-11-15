import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, PanResponder, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DotsSixVertical } from 'phosphor-react-native';
import { defaultHomeLayout, resolveHomeLayout, sameHomeLayout, type HomeLayoutEntry } from '@wmbugo/core';
import { announce } from '../../shared/a11y/announce';
import { copy } from '../../shared/copy';
import { ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { TopBar } from '../../shared/ui/TopBar';
import { realSettingsApi, SETTINGS_QUERY_KEY, type SettingsApi, type SettingsData } from '../settings/settingsApi';
import { EDITABLE_CARDS, REGISTERED_FOR_LAYOUT, type CardId, type HomeCardDef } from './cardRegistry';
import { HOME_BUDGETS_KEY } from './HomeCards';

const DEFAULT_ROW_HEIGHT = 96;
const CARD_BY_ID = new Map<string, HomeCardDef>(EDITABLE_CARDS.map((c) => [c.id, c]));

/** The new index of a row dragged by `dy` pixels, given each row's height (a drag moves past a neighbour once it is over half of it). */
export function indexAfterDrag(from: number, dy: number, heights: readonly number[]): number {
  let idx = from;
  let rest = dy;
  if (dy > 0) {
    while (idx < heights.length - 1 && rest > heights[idx + 1]! / 2) {
      rest -= heights[idx + 1]!;
      idx += 1;
    }
  } else {
    while (idx > 0 && -rest > heights[idx - 1]! / 2) {
      rest += heights[idx - 1]!;
      idx -= 1;
    }
  }
  return idx;
}

/** Moves one entry to a new index (a copy; nothing else changes). */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

function Row({
  entry,
  index,
  total,
  caption,
  heights,
  orderRef,
  onMove,
  onToggleHidden,
  onSize,
}: {
  entry: HomeLayoutEntry;
  index: number;
  total: number;
  caption: string | null;
  /** Each row's measured height by card id (a row keeps its height when it moves). */
  heights: { current: Record<string, number> };
  /** The card ids in their current order, for the drag arithmetic. */
  orderRef: { current: readonly string[] };
  onMove: (from: number, to: number) => void;
  onToggleHidden: (index: number) => void;
  onSize: (index: number, size: 'full' | 'compact') => void;
}) {
  const theme = useTheme();
  const def = CARD_BY_ID.get(entry.cardId)!;
  const name = def.editTitle;
  const indexRef = useRef(index);
  indexRef.current = index;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // A vertical scroll must not steal a drag that has started.
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          const hs = orderRef.current.map((id) => heights.current[id] ?? DEFAULT_ROW_HEIGHT);
          const to = indexAfterDrag(indexRef.current, g.dy, hs);
          if (to !== indexRef.current) onMove(indexRef.current, to);
        },
      }),
    [heights, orderRef, onMove],
  );
  const first = index === 0;
  const last = index === total - 1;
  return (
    <View
      testID={`edit-row-${entry.cardId}`}
      onLayout={(e) => {
        heights.current[entry.cardId] = e.nativeEvent.layout.height;
      }}
      style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.rowTop}>
        {/* The handle is the focusable stop of the row, so Move up and Move down are offered here as TalkBack actions. */}
        <View
          testID={`edit-handle-${entry.cardId}`}
          accessible
          accessibilityLabel={`${copy.home.edit.dragHandle}, ${name}`}
          accessibilityActions={[
            { name: 'moveUp', label: copy.home.edit.moveUp },
            { name: 'moveDown', label: copy.home.edit.moveDown },
          ]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'moveUp' && !first) onMove(index, index - 1);
            if (e.nativeEvent.actionName === 'moveDown' && !last) onMove(index, index + 1);
          }}
          {...pan.panHandlers}
          style={styles.handle}>
          <Icon icon={DotsSixVertical} size={24} color="text-secondary" />
        </View>
        <View style={styles.rowText}>
          <Text style={[textStyle('body-medium'), { color: theme.color(entry.hidden ? 'text-secondary' : 'text-primary') }]}>{name}</Text>
          {entry.hidden ? <Text testID={`edit-hidden-${entry.cardId}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.home.edit.hidden}</Text> : null}
          {caption ? <Text testID={`edit-caption-${entry.cardId}`} style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{caption}</Text> : null}
        </View>
        <Switch
          testID={`edit-hide-${entry.cardId}`}
          value={entry.hidden}
          onValueChange={() => onToggleHidden(index)}
          accessibilityLabel={`${copy.home.edit.hide} ${name}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: entry.hidden }}
          style={styles.switch}
        />
      </View>
      <View style={styles.rowActions}>
        <Button
          label={copy.home.edit.moveUp}
          variant="text"
          testID={`edit-up-${entry.cardId}`}
          onPress={() => !first && onMove(index, index - 1)}
          {...(first ? { disabledReason: copy.home.edit.alreadyTop } : {})}
        />
        <Button
          label={copy.home.edit.moveDown}
          variant="text"
          testID={`edit-down-${entry.cardId}`}
          onPress={() => !last && onMove(index, index + 1)}
          {...(last ? { disabledReason: copy.home.edit.alreadyBottom } : {})}
        />
        {def.sizes.length > 1 ? (
          <View style={styles.sizes}>
            <Chip label={copy.home.edit.compact} role="radio" selected={entry.size === 'compact'} onPress={() => onSize(index, 'compact')} testID={`edit-size-compact-${entry.cardId}`} />
            <Chip label={copy.home.edit.full} role="radio" selected={entry.size === 'full'} onPress={() => onSize(index, 'full')} testID={`edit-size-full-${entry.cardId}`} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Edit Home (SCR-05, Story 5.6): `Am I okay?` pinned first, then every editable card in the saved order with a handle, Move up
 * and Move down, a Hide switch and, for Budgets and Top categories, a Compact or Full choice. Reordering never needs drag. The
 * layout is saved once when the screen closes, and not at all when nothing changed.
 */
export function HomeEditScreen({ settingsApi = realSettingsApi, onBack }: { settingsApi?: SettingsApi; onBack: () => void }) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => settingsApi.load() });
  const saved = q.data?.settings.homeLayout ?? null;
  const resolved = useMemo(() => resolveHomeLayout(REGISTERED_FOR_LAYOUT, saved), [saved]);
  // What was saved when the screen opened: later refreshes of the settings must not move the "nothing changed" baseline.
  const initialRef = useRef<HomeLayoutEntry[] | null>(null);
  if (q.data && initialRef.current === null) initialRef.current = resolved;
  const initial = initialRef.current ?? resolved;
  const [layout, setLayout] = useState<HomeLayoutEntry[] | null>(null);
  const heights = useRef<Record<string, number>>({});
  const orderRef = useRef<readonly string[]>([]);
  useEffect(() => {
    if (q.data && layout === null) setLayout(initial);
  }, [q.data, layout, initial]);

  // What each card shows right now, from what Home already loaded, so a card that is off today says when it will show.
  const captionFor = (def: HomeCardDef): string | null => {
    if (!def.whenHidden) return null;
    const budgets = qc.getQueryData<{ categoryBudgets: unknown[]; nws: unknown } | null>(HOME_BUDGETS_KEY);
    if (budgets === undefined) return null;
    const visible = def.id === 'nws' ? budgets?.nws != null : (budgets?.categoryBudgets.length ?? 0) > 0;
    return visible ? null : def.whenHidden;
  };

  const latest = useRef({ layout, initial });
  latest.current = { layout, initial };
  orderRef.current = (layout ?? []).map((e) => e.cardId);
  const savedOnce = useRef(false);
  /** One write, only when something changed; a layout equal to the PRD order is stored as the default. */
  const flush = useCallback(async (): Promise<boolean> => {
    const { layout: l, initial: i } = latest.current;
    if (savedOnce.current || l === null || sameHomeLayout(l, i)) return true;
    savedOnce.current = true;
    const next = sameHomeLayout(l, defaultHomeLayout(REGISTERED_FOR_LAYOUT)) ? null : l;
    const r = await settingsApi.saveHomeLayout(next).catch(() => ({ ok: false }));
    if (r.ok) {
      qc.setQueryData<SettingsData | null>(SETTINGS_QUERY_KEY, (d) => (d ? { ...d, settings: { ...d.settings, homeLayout: next } } : d));
      return true;
    }
    savedOnce.current = false;
    toast.show({ message: copy.home.edit.saveError });
    return false;
  }, [qc, settingsApi, toast]);

  // Back leaves only once the layout is saved; if saving fails the screen stays open with the edits so Back can try again.
  const back = useCallback(async () => {
    if (await flush()) onBack();
  }, [flush, onBack]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void back();
      return true;
    });
    return () => sub.remove();
  }, [back]);
  // Any other way out (a swipe, the navigator) still saves a changed layout.
  // Only on a real unmount: a changed identity of `flush` must never save a half-edited layout.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      void flushRef.current();
    },
    [],
  );

  // The position counts the pinned hero: the first editable card is position 2 of N + 1.
  const move = useCallback((from: number, to: number) => {
    const l = latest.current.layout;
    if (!l || from === to) return;
    const name = CARD_BY_ID.get(l[from]!.cardId)!.editTitle;
    announce(copy.home.edit.movedTo.replace('{name}', name).replace('{n}', String(to + 2)).replace('{total}', String(l.length + 1)));
    const next = moveEntry(l, from, to);
    latest.current = { ...latest.current, layout: next };
    setLayout(next);
  }, []);
  const toggleHidden = useCallback((index: number) => {
    const l = latest.current.layout;
    if (!l) return;
    const e = l[index]!;
    announce((e.hidden ? copy.home.edit.nowShown : copy.home.edit.nowHidden).replace('{name}', CARD_BY_ID.get(e.cardId)!.editTitle));
    const next = l.map((x, i) => (i === index ? { ...x, hidden: !x.hidden } : x));
    latest.current = { ...latest.current, layout: next };
    setLayout(next);
  }, []);
  const setSize = useCallback((index: number, size: 'full' | 'compact') => {
    const l = latest.current.layout;
    if (!l) return;
    const next = l.map((x, i) => (i === index ? { ...x, size } : x));
    latest.current = { ...latest.current, layout: next };
    setLayout(next);
  }, []);

  const reset = () => {
    if (!layout) return;
    const previous = layout;
    const fresh = defaultHomeLayout(REGISTERED_FOR_LAYOUT);
    latest.current = { ...latest.current, layout: fresh };
    setLayout(fresh);
    toast.show({
      message: copy.home.edit.resetDone,
      undo: {
        label: copy.common.undo,
        onUndo: () => {
          // Undo only undoes the reset: edits made after it stand.
          if (latest.current.layout !== fresh) return;
          latest.current = { ...latest.current, layout: previous };
          setLayout(previous);
        },
      },
    });
  };

  return (
    <View testID="home-edit" style={styles.fill}>
      <TopBar title={copy.home.edit.title} onBack={() => void back()} backTestID="home-edit-back" />
      <ScrollView contentContainerStyle={styles.pad}>
        <View testID="edit-pinned" accessible accessibilityLabel={`${copy.home.edit.pinned}, ${copy.home.edit.pinnedCaption}`} style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.home.edit.pinned}</Text>
          <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.home.edit.pinnedCaption}</Text>
        </View>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.home.edit.toCheckNote}</Text>

        {q.isError || (q.isSuccess && !q.data) ? (
          <ErrorBlock cause={copy.home.edit.loadError} onRetry={() => void q.refetch()} />
        ) : layout === null ? (
          <View testID="home-edit-skeleton" style={styles.list}>
            <Skeleton height={96} />
            <Skeleton height={96} />
          </View>
        ) : (
          <View style={styles.list}>
            {layout.map((e, i) => (
              <Row key={e.cardId} entry={e} index={i} total={layout.length} caption={captionFor(CARD_BY_ID.get(e.cardId)!)} heights={heights} orderRef={orderRef} onMove={move} onToggleHidden={toggleHidden} onSize={setSize} />
            ))}
          </View>
        )}

        <Button label={copy.home.edit.reset} variant="text" onPress={reset} testID="home-edit-reset" />
      </ScrollView>
    </View>
  );
}

export type { CardId };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  list: { gap: 12 },
  row: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  handle: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  switch: { minWidth: 48, minHeight: 48 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  sizes: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
});
