import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { parseAmountInput, type ActivityQuery, type ActivitySort, type ActivityStatusFilter, type ActivityType } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import type { DatePreset } from '../../shared/state/uiStore';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import type { ActivityOptions } from './activityApi';

const TYPES: readonly [ActivityType, string][] = [
  ['expense', copy.activity.typeExpense],
  ['income', copy.activity.typeIncome],
  ['transfer', copy.activity.typeTransfer],
  ['refund', copy.activity.typeRefund],
];
const STATUSES: readonly [ActivityStatusFilter, string][] = [
  ['waiting', copy.activity.statusWaiting],
  ['check', copy.activity.statusCheck],
  ['needs-category', copy.activity.statusNeedsCategory],
  ['guessed', copy.activity.statusGuessed],
  ['reversed', copy.activity.statusReversed],
];
const SORTS: readonly [ActivitySort, string][] = [
  ['newest', copy.activity.sortNewest],
  ['oldest', copy.activity.sortOldest],
  ['amount', copy.activity.sortAmount],
  ['merchant', copy.activity.sortMerchant],
];

const addDays = (date: string, n: number) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);

/** The date range a preset means, today being the local date. */
export function rangeOfPreset(preset: Exclude<DatePreset, null | 'custom'>, o: Pick<ActivityOptions, 'today' | 'period'>): { fromDate: string; toDate: string } {
  if (preset === 'period') return { fromDate: o.period.start, toDate: o.period.end };
  return { fromDate: addDays(o.today, preset === '7d' ? -6 : -29), toDate: o.today };
}

const toggle = <T,>(list: readonly T[] | undefined, v: T): T[] => ((list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]);

/**
 * Filters and sort. Nothing applies until "Show N results"; Back or swipe closes without changes (the sheet host's
 * own dismissal). \`Reset\` clears the draft. The count is asked from the same query Activity runs.
 */
export function ActivityFilterSheet({
  initial,
  datePreset: initialPreset,
  options,
  exponent,
  count,
  onApply,
}: {
  initial: ActivityQuery;
  datePreset: DatePreset;
  options: ActivityOptions;
  exponent: number;
  count: (q: ActivityQuery) => Promise<number>;
  onApply: (q: ActivityQuery, preset: DatePreset) => void;
}) {
  const theme = useTheme();
  const [q, setQ] = useState<ActivityQuery>(initial);
  const [preset, setPreset] = useState<DatePreset>(initialPreset);
  const [from, setFrom] = useState(initial.fromDate ?? '');
  const [to, setTo] = useState(initial.toDate ?? '');
  const [min, setMin] = useState(minorToInput(initial.minMinor ?? null, exponent));
  const [max, setMax] = useState(minorToInput(initial.maxMinor ?? null, exponent));
  const [n, setN] = useState<number | null>(null);
  const ink = { color: theme.color('on-glass-primary') };
  const muted = { color: theme.color('on-glass-secondary') };

  // The draft with what is typed in the amount and custom date fields folded in.
  const draft = (): ActivityQuery => {
    const next: { -readonly [K in keyof ActivityQuery]: ActivityQuery[K] } = { ...q };
    delete next.minMinor;
    delete next.maxMinor;
    const a = min.trim() === '' ? null : parseAmountInput(min, exponent);
    const b = max.trim() === '' ? null : parseAmountInput(max, exponent);
    if (a?.ok) next.minMinor = a.value;
    if (b?.ok) next.maxMinor = b.value;
    if (preset === 'custom') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) next.fromDate = from;
      else delete next.fromDate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) next.toDate = to;
      else delete next.toDate;
    }
    return next;
  };

  useEffect(() => {
    let live = true;
    void count(draft()).then((c) => live && setN(c));
    return () => {
      live = false;
    };
  }, [q, preset, from, to, min, max]);

  const section = (title: string, children: React.ReactNode) => (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[textStyle('label'), muted]}>{title}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );

  const setRange = (p: DatePreset) => {
    setPreset(p);
    if (p === null) {
      setQ((v) => {
        const { fromDate: _f, toDate: _t, ...rest } = v;
        void _f;
        void _t;
        return rest;
      });
    } else if (p !== 'custom') setQ((v) => ({ ...v, ...rangeOfPreset(p, options) }));
  };

  const active = options.accounts.filter((a) => a.status === 'active');
  const archived = options.accounts.filter((a) => a.status === 'archived');
  const accountChip = (a: (typeof options.accounts)[number]) => (
    <Chip key={a.id} onGlass label={a.name} variant="account" testID={`filter-account-${a.id}`} selected={q.accountIds?.includes(a.id) ?? false} onPress={() => setQ((v) => ({ ...v, accountIds: toggle(v.accountIds, a.id) }))} />
  );

  return (
    <View testID="filter-sheet" style={styles.fill}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {section(
          copy.activity.filterDate,
          <>
            {([['period', copy.activity.thisPeriod], ['7d', copy.activity.lastWeek], ['30d', copy.activity.lastMonth], ['custom', copy.activity.custom]] as const).map(([p, label]) => (
              <Chip key={p} onGlass label={label} variant="period" testID={`filter-date-${p}`} selected={preset === p} onPress={() => setRange(preset === p ? null : p)} />
            ))}
          </>,
        )}
        {preset === 'custom' ? (
          <View style={styles.row}>
            <TextInput testID="filter-from" accessibilityLabel={copy.activity.customFrom} placeholder={copy.activity.customFrom} placeholderTextColor={theme.color('on-glass-secondary')} value={from} onChangeText={setFrom} style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]} />
            <TextInput testID="filter-to" accessibilityLabel={copy.activity.customTo} placeholder={copy.activity.customTo} placeholderTextColor={theme.color('on-glass-secondary')} value={to} onChangeText={setTo} style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]} />
          </View>
        ) : null}

        {section(copy.activity.filterAccounts, <>{active.map(accountChip)}</>)}
        {archived.length > 0 ? section(copy.activity.archivedAccounts, <>{archived.map(accountChip)}</>) : null}
        {section(
          copy.activity.filterCategories,
          <>
            {options.categories.map((c) => (
              <Chip key={c.id} onGlass label={c.name} variant="quick-category" testID={`filter-category-${c.id}`} selected={q.categoryIds?.includes(c.id) ?? false} onPress={() => setQ((v) => ({ ...v, categoryIds: toggle(v.categoryIds, c.id) }))} />
            ))}
          </>,
        )}
        {section(
          copy.activity.filterType,
          <>
            {TYPES.map(([t, label]) => (
              <Chip key={t} onGlass label={label} variant="period" testID={`filter-type-${t}`} selected={q.types?.includes(t) ?? false} onPress={() => setQ((v) => ({ ...v, types: toggle(v.types, t) }))} />
            ))}
          </>,
        )}
        {section(
          copy.activity.filterStatus,
          <>
            {STATUSES.map(([s, label]) => (
              <Chip key={s} onGlass label={label} variant="period" testID={`filter-status-${s}`} selected={q.statuses?.includes(s) ?? false} onPress={() => setQ((v) => ({ ...v, statuses: toggle(v.statuses, s) }))} />
            ))}
          </>,
        )}

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[textStyle('label'), muted]}>{copy.activity.filterAmount}</Text>
          <View style={styles.row}>
            <TextInput testID="filter-min" accessibilityLabel={copy.activity.amountFrom} placeholder={copy.activity.amountFrom} placeholderTextColor={theme.color('on-glass-secondary')} value={min} onChangeText={setMin} keyboardType="decimal-pad" style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]} />
            <TextInput testID="filter-max" accessibilityLabel={copy.activity.amountTo} placeholder={copy.activity.amountTo} placeholderTextColor={theme.color('on-glass-secondary')} value={max} onChangeText={setMax} keyboardType="decimal-pad" style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]} />
          </View>
        </View>

        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={[textStyle('body-medium'), ink]}>{copy.activity.showRejected}</Text>
            <Text style={[textStyle('caption'), muted]}>{copy.activity.showRejectedNote}</Text>
          </View>
          <Switch testID="filter-rejected" accessibilityLabel={copy.activity.showRejected} accessibilityRole="switch" accessibilityState={{ checked: q.showRejected === true }} value={q.showRejected === true} onValueChange={(v) => setQ((x) => ({ ...x, showRejected: v }))} trackColor={{ false: theme.color('on-glass-secondary'), true: theme.color('on-glass-accent') }} />
        </View>

        {section(
          copy.activity.filterSort,
          <>
            {SORTS.map(([s, label]) => (
              <Chip key={s} onGlass label={label} variant="period" testID={`filter-sort-${s}`} selected={(q.sort ?? 'newest') === s} onPress={() => setQ((v) => ({ ...v, sort: s }))} />
            ))}
          </>,
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label={copy.activity.reset}
          variant="secondary-on-footer"
          testID="filter-reset"
          onPress={() => {
            setQ({});
            setPreset(null);
            setFrom('');
            setTo('');
            setMin('');
            setMax('');
          }}
        />
        <Button label={n === 1 ? copy.activity.showOne : copy.activity.showResults.replace('{n}', String(n ?? '')).replace('Show  results', 'Show results')} testID="filter-apply" onPress={() => onApply(draft(), preset)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  scroll: { maxHeight: 520 },
  content: { gap: 16, paddingBottom: 8 },
  section: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.touchMin },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 8 },
});
