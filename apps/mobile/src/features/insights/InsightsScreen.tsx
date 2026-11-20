import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { shortDate } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { insightsKey, presetName, realInsightsApi, type InsightsApi, type InsightsFacets } from './insightsApi';
import { InsightsFilterSheet } from './InsightsFilterSheet';
import { useInsightsStore, withoutFilterValue } from './insightsStore';
import { KpiTiles } from './KpiTiles';
import { PeriodSheet } from './PeriodSheet';
import { insightsSections, type InsightsSectionNav } from './sectionRegistry';

const i = copy.insights;

export interface InsightsNav extends InsightsSectionNav {
  /** Opens the Add sheet (the empty-period prompt). */
  onAdd?: () => void;
  /** Opens the review queue (the waiting row). */
  onReview?: () => void;
  /** Opens SCR-12 for a target (Story 7.3). */
  onDrill?: (target: unknown) => void;
}

/**
 * SCR-11 Insights overview (Story 7.2): a period chip, the filter chip row, four KPI tiles, then the question sections in the
 * order they register. The header is the tab's own. Loading shows skeletons, never a spinner; a failing query says so with
 * Retry and nothing is shown as zero. The selection lives in a store, so Back and a tab switch keep it.
 */
export function InsightsScreen({ api = realInsightsApi, nav = {} }: { api?: InsightsApi; nav?: InsightsNav }) {
  const theme = useTheme();
  const sheet = useSheet();
  const selection = useInsightsStore((s) => s.selection);
  const { setPreset, setFilters, clearFilters } = useInsightsStore.getState();
  const q = useQuery({ queryKey: insightsKey(selection), queryFn: () => api.loadOverview(selection) });
  const announced = useRef<string | null>(null);
  const opening = useRef(false);
  const toast = useToast();

  const o = q.data;
  useEffect(() => {
    if (!o) return;
    const text = i.periodAnnounce.replace('{label}', presetName(o.preset)).replace('{range}', o.period.title);
    if (announced.current !== null && announced.current !== text) AccessibilityInfo.announceForAccessibility(text);
    announced.current = text;
  }, [o]);

  if (q.isError || q.data === null) return <ErrorBlock cause={i.loadError} onRetry={() => void q.refetch()} />;
  if (!o) {
    return (
      <View testID="insights-loading" style={styles.pad}>
        <Skeleton height={40} />
        <Skeleton height={88} />
        <Skeleton height={88} />
      </View>
    );
  }

  const openPeriod = () =>
    sheet.open({
      id: 'insights-period',
      title: i.periodTitle,
      body: (close) => <PeriodSheet presets={o.presets} selected={o.preset} today={o.today} {...(selection.custom ? { custom: selection.custom } : {})} onPick={(p, c) => setPreset(p, c)} close={close} />,
    });

  const openFilters = async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      const facets: InsightsFacets | null = await api.loadFacets(selection).catch(() => null);
      if (!facets) {
        toast.show({ message: i.filtersFailed });
        return;
      }
      sheet.open({ id: 'insights-filters', title: i.filterTitle, body: (close) => <InsightsFilterSheet facets={facets} known={o.filterChips} value={selection.filters} onApply={setFilters} close={close} /> });
    } finally {
      opening.current = false;
    }
  };

  const sectionCtx = { overview: o, api, selection, nav, ...(nav.onDrill ? { onDrill: nav.onDrill } : {}) };
  const count = o.filterChips.length;
  const sections = insightsSections().filter((s) => s.visible(sectionCtx));
  const empty = o.entries === 0;
  const before = o.period.start < o.firstDay;
  const waitingText = o.waiting === 1 ? i.waitingOne : i.waitingMany.replace('{n}', String(o.waiting));
  // Entries waiting for the user are never counted, so the way to them stays even when nothing else is recorded for the period.
  const waitingRow =
    o.waiting > 0 ? (
      <Pressable testID="insights-waiting" {...(nav.onReview ? controlA11y({ label: waitingText, role: 'button' }) : { accessible: true, accessibilityLabel: waitingText })} {...(nav.onReview ? { onPress: nav.onReview } : {})} style={[styles.waiting, { borderColor: theme.color('border-hairline') }]}>
        <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{waitingText}</Text>
      </Pressable>
    ) : null;

  return (
    <ScrollView testID="insights-screen" contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <View style={styles.chips}>
        <Chip variant="period" label={i.periodChip.replace('{label}', presetName(o.preset)).replace('{range}', o.period.title)} testID="insights-period-chip" onPress={openPeriod} hint={i.periodTitle} />
        <Chip label={count > 0 ? i.filtersN.replace('{n}', String(count)) : i.filters} testID="insights-filters-chip" selected={count > 0} onPress={() => void openFilters()} />
        {o.filterChips.map((c) => (
          <Chip key={`${c.key}:${c.value}`} label={c.label} testID={`insights-chip-${c.key}-${c.value}`} selected hint={i.removeFilter.replace('{name}', c.label)} onPress={() => setFilters(withoutFilterValue(selection.filters, c.key, c.value))} />
        ))}
        {count >= 2 ? <Chip label={i.clearAll} testID="insights-clear-all" onPress={clearFilters} /> : null}
      </View>

      {before && !empty ? (
        <Text testID="insights-since" style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>
          {i.sinceCaption.replace('{date}', shortDate(o.firstDay))}
        </Text>
      ) : null}

      {empty ? (
        <View testID="insights-empty" style={styles.empty}>
          <Text style={[textStyle('body'), styles.center, { color: theme.color('text-secondary') }]}>{i.nothingRecorded.replace('{range}', o.period.title)}</Text>
          {before ? <Text style={[textStyle('caption'), styles.center, { color: theme.color('text-secondary') }]}>{i.sinceCaption.replace('{date}', shortDate(o.firstDay))}</Text> : null}
          {nav.onAdd ? <Button label={i.addExpense} variant="text" testID="insights-add" onPress={nav.onAdd} /> : null}
          {waitingRow}
        </View>
      ) : (
        <>
          <KpiTiles overview={o} onRetry={() => void q.refetch()} {...(nav.onDrill ? { onOpenSpent: () => nav.onDrill!({ kind: 'spent' }), onOpenIncome: () => nav.onDrill!({ kind: 'income' }) } : {})} />
          {waitingRow}
          {sections.map((s) => (
            <View key={s.id} testID={`insights-section-${s.id}`} style={styles.section}>
              <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('text-primary') }]}>{s.heading}</Text>
              {s.render(sectionCtx)}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 16, paddingBottom: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  center: { textAlign: 'center' },
  waiting: { minHeight: 48, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, justifyContent: 'center' },
  section: { gap: 12 },
});
