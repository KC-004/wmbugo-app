import { BackHandler, FlatList, Pressable, SectionList, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FunnelSimple, MagnifyingGlass, X } from 'phosphor-react-native';
import {
  ACTIVITY_PAGE_SIZE,
  activeFilterCount,
  dayHeading,
  isFiltered,
  isFlatSort,
  longDate,
  type ActivityDay,
  type ActivityQuery,
  type ActivityRow,
  type CurrencyCode,
} from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { announce } from '../../shared/a11y/announce';
import { invalidateForEvent } from '../../shared/queryClient';
import { useToast } from '../../shared/feedback/ToastHost';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { useSheet } from '../../shared/feedback/SheetHost';
import { EMPTY_ACTIVITY_FILTER, useUiStore, type DatePreset } from '../../shared/state/uiStore';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { ScreenHeader, IconButton } from '../shell/ScreenHeader';
import { realAddApi, type AddApi } from '../add/addApi';
import { ActivityFilterSheet } from './ActivityFilterSheet';
import { ActivityRowView } from './ActivityRowView';
import { HeldRowActions } from './HeldRowActions';
import { BulkMoveSheet } from './BulkMoveSheet';
import { ACTIVITY_QUERY_KEY, realActivityApi, type ActivityApi, type ActivityOptions } from './activityApi';

const SEARCH_DEBOUNCE_MS = 300;

type ChipSpec = { key: string; label: string; remove: (q: ActivityQuery) => ActivityQuery; clearsPreset?: boolean };

/** Labels of the active filters, one removable chip each. */
function activeChips(q: ActivityQuery, preset: DatePreset, o: ActivityOptions | null): ChipSpec[] {
  const out: ChipSpec[] = [];
  if (q.fromDate || q.toDate) {
    const label = preset === 'period' ? copy.activity.thisPeriod : preset === '7d' ? copy.activity.lastWeek : preset === '30d' ? copy.activity.lastMonth : `${q.fromDate ?? ''} – ${q.toDate ?? ''}`;
    out.push({
      key: 'date',
      label,
      clearsPreset: true,
      remove: (x) => {
        const { fromDate: _a, toDate: _b, ...rest } = x;
        void _a;
        void _b;
        return rest;
      },
    });
  }
  for (const id of q.accountIds ?? []) out.push({ key: `account-${id}`, label: o?.accounts.find((a) => a.id === id)?.name ?? id, remove: (x) => ({ ...x, accountIds: (x.accountIds ?? []).filter((v) => v !== id) }) });
  for (const id of q.categoryIds ?? []) out.push({ key: `category-${id}`, label: o?.categories.find((c) => c.id === id)?.name ?? id, remove: (x) => ({ ...x, categoryIds: (x.categoryIds ?? []).filter((v) => v !== id) }) });
  const typeLabel = { expense: copy.activity.typeExpense, income: copy.activity.typeIncome, transfer: copy.activity.typeTransfer, refund: copy.activity.typeRefund } as const;
  for (const t of q.types ?? []) out.push({ key: `type-${t}`, label: typeLabel[t], remove: (x) => ({ ...x, types: (x.types ?? []).filter((v) => v !== t) }) });
  const statusLabel = { waiting: copy.activity.statusWaiting, check: copy.activity.statusCheck, 'needs-category': copy.activity.statusNeedsCategory, guessed: copy.activity.statusGuessed, reversed: copy.activity.statusReversed } as const;
  for (const s of q.statuses ?? []) out.push({ key: `status-${s}`, label: statusLabel[s], remove: (x) => ({ ...x, statuses: (x.statuses ?? []).filter((v) => v !== s) }) });
  if (q.minMinor !== undefined || q.maxMinor !== undefined) {
    out.push({
      key: 'amount',
      label: copy.activity.filterAmount,
      remove: (x) => {
        const { minMinor: _a, maxMinor: _b, ...rest } = x;
        void _a;
        void _b;
        return rest;
      },
    });
  }
  if (q.showRejected) {
    out.push({
      key: 'rejected',
      label: copy.activity.showRejected,
      remove: (x) => {
        const { showRejected: _a, ...rest } = x;
        void _a;
        return rest;
      },
    });
  }
  return out;
}

/** Activity: saved entries grouped under day headers with that day's "Spent" total; search, filters and sort. */
export function ActivityScreen({
  api = realActivityApi,
  onAccounts,
  onProfile,
  onAdd,
  duplicateApi = realAddApi,
  onOpen,
  onDeleteRow,
  onRecategorise,
}: {
  api?: ActivityApi;
  onAccounts: () => void;
  onProfile: () => void;
  onAdd: () => void;
  /** Keep both / Merge for a flagged entry. */
  duplicateApi?: Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'>;
  /** Opens an entry's detail. */
  onOpen?: (transactionId: string) => void;
  /** TalkBack custom actions on a row: Delete (Reject for a captured entry) and Recategorise. */
  onDeleteRow?: (row: ActivityRow) => void;
  onRecategorise?: (row: ActivityRow) => void;
}) {
  const theme = useTheme();
  const sheet = useSheet();
  const toast = useToast();
  const qc = useQueryClient();
  // Selection mode (Story 3.9): null when off.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const filter = useUiStore((s) => s.activityFilter);
  const setFilter = useUiStore((s) => s.setActivityFilter);
  const query = filter.query;
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [searching, setSearching] = useState((query.search ?? '') !== '');
  const [text, setText] = useState(query.search ?? '');

  // Results follow typing after a short pause.
  useEffect(() => {
    if (text === (query.search ?? '')) return;
    const h = setTimeout(() => {
      const { search: _s, ...rest } = query;
      void _s;
      setFilter({ ...filter, query: text.trim() === '' ? rest : { ...rest, search: text } });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [text]);

  const key = useMemo(() => JSON.stringify(query), [query]);
  const q = useQuery({ queryKey: [...ACTIVITY_QUERY_KEY, limit, key], queryFn: () => api.load(limit, query), placeholderData: (prev) => prev });
  const options = useQuery({ queryKey: [...ACTIVITY_QUERY_KEY, 'options'], queryFn: async () => (api.options ? api.options() : null) });
  const d = q.data ?? null;
  const filtered = isFiltered(query);
  const flat = isFlatSort(query);
  const n = activeFilterCount(query);
  const resultCount = d?.days.reduce((c, day) => c + day.rows.length, 0) ?? 0;

  useEffect(() => {
    if (!selected) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [selected !== null]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = async () => {
    const all = api.ids ? await api.ids(query) : (d?.days.flatMap((day) => day.rows.map((r) => r.id)) ?? []);
    setSelected(new Set(all));
    announce(copy.bulk.selected.replace('{n}', String(all.length)));
  };

  const openMove = () => {
    const ids = [...(selected ?? [])];
    const cats = (options.data?.categories ?? []).filter((c) => c.id !== 'cat_uncategorised');
    if (ids.length === 0 || !api.bulkPreview || !api.bulkMove) return;
    sheet.open({
      id: 'bulk-move',
      title: copy.bulk.moveTo.replace('{n}', String(ids.length)),
      body: (close) => (
        <BulkMoveSheet
          categories={cats}
          preview={(categoryId) => api.bulkPreview!(ids, categoryId)}
          close={close}
          onConfirm={async (categoryId, toName) => {
            const r = await api.bulkMove!(ids, categoryId).catch(() => ({ ok: false as const, code: 'FAILED' }));
            if (!r.ok) return false;
            const previous = r.value.previous;
            await invalidateForEvent(qc, 'TransactionsChanged');
            setSelected(null);
            toast.show({
              message: copy.bulk.moved.replace('{n}', String(r.value.movedIds.length)).replace('{to}', toName),
              undo: {
                label: copy.common.undo,
                onUndo: () =>
                  void api.bulkUndo!(previous)
                    .then(async () => {
                      await invalidateForEvent(qc, 'TransactionsChanged');
                    })
                    .catch(() => toast.show({ message: copy.add.removeFailed })),
              },
            });
            return true;
          }}
        />
      ),
    });
  };

  const clearAll = () => {
    setText('');
    setFilter(EMPTY_ACTIVITY_FILTER);
  };
  const closeSearch = () => {
    setSearching(false);
    setText('');
    const { search: _s, ...rest } = query;
    void _s;
    if (query.search) setFilter({ ...filter, query: rest });
  };

  const openFilters = () => {
    const o = options.data;
    if (!o) return;
    const search = query.search ? { search: query.search } : {};
    sheet.open({
      id: 'activity-filters',
      title: copy.activity.filters,
      body: (close) => (
        <ActivityFilterSheet
          initial={query}
          datePreset={filter.datePreset}
          options={o}
          exponent={2}
          count={(x) => (api.count ? api.count({ ...x, ...search }) : Promise.resolve(0))}
          onApply={(next, preset) => {
            close();
            setFilter({ query: { ...next, ...search }, datePreset: preset });
          }}
        />
      ),
    });
  };

  const removeChip = (c: ChipSpec) => {
    const next = c.remove(query);
    setFilter({ query: next, datePreset: c.clearsPreset ? null : filter.datePreset });
    void (api.count ? api.count(next) : Promise.resolve(0)).then((count) => announce(`${copy.activity.filterRemoved}. ${count} ${(count === 1 ? copy.activity.result : copy.activity.results).toLowerCase()}`));
  };

  const selectionBar = selected ? (
    <View testID="selection-bar" style={[styles.selectionBar, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <IconButton label={copy.bulk.cancel} onPress={() => setSelected(null)} testID="selection-cancel">
        <Icon icon={X} />
      </IconButton>
      <Text testID="selection-count" accessibilityLiveRegion="polite" style={[textStyle('title-sm'), { color: theme.color('text-primary') }, styles.flex]}>
        {copy.bulk.selected.replace('{n}', String(selected.size))}
      </Text>
      <Button label={copy.bulk.selectAll} variant="text" onPress={() => void selectAll()} testID="selection-all" />
      <Button label={copy.bulk.moveTo.replace('{n}', String(selected.size))} onPress={openMove} disabledReason={selected.size === 0 ? copy.bulk.selectSome : undefined} testID="selection-move" />
    </View>
  ) : null;

  const header = selectionBar ?? (searching ? (
    <View style={styles.searchRow}>
      <IconButton label={copy.nav.back} onPress={closeSearch} testID="search-back">
        <Icon icon={ArrowLeft} />
      </IconButton>
      <TextInput
        testID="search-input"
        accessibilityLabel={copy.activity.searchLabel}
        placeholder={copy.activity.searchPlaceholder}
        placeholderTextColor={theme.color('text-secondary')}
        value={text}
        onChangeText={setText}
        autoFocus
        returnKeyType="search"
        style={[styles.searchInput, textStyle('body'), { color: theme.color('text-primary'), borderColor: theme.color('border-control') }]}
      />
      {text !== '' ? <Button label={copy.activity.clear} variant="text" onPress={() => setText('')} testID="search-clear" /> : null}
    </View>
  ) : (
    <ScreenHeader
      title={copy.nav.activity}
      onAccounts={onAccounts}
      onProfile={onProfile}
      actions={
        <View style={styles.headerActions}>
          {api.bulkMove ? <Button label={copy.bulk.select} variant="text" onPress={() => setSelected(new Set())} testID="header-select" /> : null}
          <IconButton label={copy.activity.searchLabel} onPress={() => setSearching(true)} testID="header-search">
            <Icon icon={MagnifyingGlass} />
          </IconButton>
        </View>
      }
    />
  ));

  const onAccent = theme.scheme === 'dark' ? theme.color('bg-canvas') : theme.color('bg-surface');
  const chipsRow = (
    <View testID="filter-row" style={styles.chipsRow}>
      <Pressable testID="filters-button" accessibilityRole="button" accessibilityLabel={`${copy.activity.filters}, ${n}`} onPress={openFilters} style={styles.filtersBtn}>
        <Icon icon={FunnelSimple} size={18} />
        <Text style={[textStyle('label'), { color: theme.color('text-primary') }]}>{`${copy.activity.filters} · ${n}`}</Text>
      </Pressable>
      {activeChips(query, filter.datePreset, options.data ?? null).map((c) => (
        <Pressable
          key={c.key}
          testID={`chip-${c.key}`}
          accessibilityRole="button"
          accessibilityLabel={`${copy.activity.removeFilter}: ${c.label}`}
          onPress={() => removeChip(c)}
          style={[styles.activeChip, { backgroundColor: theme.color('accent-primary') }]}>
          <Text style={[textStyle('label'), { color: onAccent }]}>{c.label}</Text>
          <Icon icon={X} size={14} tint={onAccent} />
        </Pressable>
      ))}
      {n >= 2 ? <Button label={copy.activity.clearAll} variant="text" onPress={clearAll} testID="chips-clear-all" /> : null}
    </View>
  );

  const skeleton = (
    <View style={styles.pad} testID="activity-skeleton">
      <Skeleton height={56} />
      <Skeleton height={56} />
      <Skeleton height={56} />
    </View>
  );

  const rowFor = (item: ActivityRow, date: string, data: NonNullable<typeof d>, showDate = false) => (
    <ActivityRowView
      row={item}
      date={date}
      currency={data.currency}
      locale={data.locale}
      showDate={showDate}
      footer={item.held ? <HeldRowActions transactionId={item.id} api={duplicateApi} /> : undefined}
      onPress={selected ? () => toggle(item.id) : onOpen ? () => onOpen(item.id) : undefined}
      onLongPress={api.bulkMove && !selected && item.kind !== 'adjustment' ? () => setSelected(new Set([item.id])) : undefined}
      selection={selected ? { selected: selected.has(item.id) } : undefined}
      actions={onDeleteRow && onRecategorise && item.kind !== 'adjustment' ? [{ name: 'recategorise', label: copy.detail.recategorise }, { name: 'delete', label: item.captured ? copy.detail.reject : copy.detail.delete }] : undefined}
      onAction={(name) => (name === 'delete' ? onDeleteRow?.(item) : onRecategorise?.(item))}
    />
  );

  if (d && resultCount === 0 && !filtered) {
    return (
      <View style={styles.fill}>
        <View style={styles.pad}>{header}</View>
        <EmptyState sentence={copy.activity.empty} actionLabel={copy.activity.addExpense} onAction={onAdd} />
      </View>
    );
  }

  const footer = d?.hasMore ? <Button label={copy.activity.showEarlier} variant="secondary" testID="activity-show-earlier" onPress={() => setLimit((x) => x + ACTIVITY_PAGE_SIZE)} /> : undefined;

  return (
    <View style={styles.fill}>
      <View style={styles.pad}>{header}</View>
      {chipsRow}
      <Reveal loading={q.isLoading} skeleton={skeleton} fill>
        {d && resultCount === 0 ? (
          <View testID="no-matches" style={styles.noMatches}>
            <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{`${copy.activity.noMatches} · ${copy.activity.clearAll}`}</Text>
            <Button label={copy.activity.clearAll} variant="secondary" onPress={clearAll} testID="no-matches-clear" />
          </View>
        ) : d && flat ? (
          <FlatList
            testID="activity-list"
            data={d.days.flatMap((day) => day.rows)}
            keyExtractor={(r) => r.id}
            contentContainerStyle={styles.list}
            ListFooterComponent={footer}
            renderItem={({ item }) => rowFor(item, item.localDate, d, true)}
          />
        ) : d ? (
          <SectionList
            testID="activity-list"
            sections={d.days.map((day) => ({ day, data: day.rows as ActivityRow[] }))}
            keyExtractor={(r) => r.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.list}
            ListFooterComponent={footer}
            renderSectionHeader={({ section }) => <DayHeader day={section.day} today={d.today} currency={d.currency} locale={d.locale} />}
            renderItem={({ item, section }) => rowFor(item, section.day.localDate, d)}
          />
        ) : q.isError ? (
          <View style={styles.pad}>
            <ErrorBlock cause={copy.activity.loadError} onRetry={() => void q.refetch()} alternative={{ label: copy.activity.addExpense, onPress: onAdd }} />
          </View>
        ) : null}
      </Reveal>
    </View>
  );
}

function DayHeader({ day, today, currency, locale }: { day: ActivityDay; today: string; currency: CurrencyCode; locale: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const spoken = `${longDate(day.localDate)}, ${amountLabel({ amountMinor: day.spentMinor, currency, locale, kind: 'spent', inline: true })}`;
  return (
    <View
      testID={`day-${day.localDate}`}
      accessible
      accessibilityRole="header"
      accessibilityLabel={spoken}
      style={[styles.dayHeader, fontScale >= 1.3 ? styles.column : styles.between]}>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{dayHeading(day.localDate, today)}</Text>
      <View style={styles.spent}>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.activity.spent}</Text>
        <Amount amountMinor={day.spentMinor} currency={currency} direction="neutral" role="caption" locale={locale} color="text-secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
  dayHeader: { paddingTop: 12, paddingBottom: 4, gap: 2 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  column: { flexDirection: 'column', alignItems: 'flex-start' },
  spent: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 64 },
  searchInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 48 },
  filtersBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingRight: 4 },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 12, borderRadius: radii.full },
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  selectionBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 4 },
  noMatches: { padding: 16, gap: 12, alignItems: 'flex-start' },
});
