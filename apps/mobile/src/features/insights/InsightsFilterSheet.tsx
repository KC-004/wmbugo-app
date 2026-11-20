import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { InsightsFilters, LedgerEntryType } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import type { InsightsFacets } from './insightsApi';

const i = copy.insights;

const toggle = <T extends string>(list: readonly T[] | undefined, value: T): T[] => {
  const cur = list ?? [];
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
};

/**
 * The Insights filter sheet (Story 7.2): Accounts, Categories, Merchant (searchable), Type, Tags and Source. Tags show only
 * when an entry has one; Source lists only the sources present. There is no status filter: waiting and rejected entries can
 * never be included from Insights.
 */
export function InsightsFilterSheet({ facets, value, onApply, close }: { facets: InsightsFacets; value: InsightsFilters; onApply: (f: InsightsFilters) => void; close: () => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState<InsightsFilters>(value);
  const [search, setSearch] = useState('');
  const ink = { color: theme.color('on-glass-primary') };
  const set = <K extends keyof InsightsFilters>(key: K, list: readonly string[]) => {
    const next: Record<string, unknown> = { ...draft };
    if (list.length > 0) next[key] = list;
    else delete next[key];
    setDraft(next as InsightsFilters);
  };
  const heading = (t: string) => (
    <Text accessibilityRole="header" style={[textStyle('label'), ink]}>
      {t}
    </Text>
  );
  const merchants = facets.merchants.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30);
  const types: { id: LedgerEntryType; label: string }[] = [
    { id: 'expense', label: i.typeExpense },
    { id: 'income', label: i.typeIncome },
    { id: 'refund', label: i.typeRefund },
  ];
  return (
    <View testID="insights-filter-sheet" style={styles.gap}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.gap}>
        {heading(i.filterAccounts)}
        <View style={styles.row}>
          {facets.accounts.map((a) => (
            <Chip key={a.id} onGlass variant="account" label={a.name} testID={`ifilter-account-${a.id}`} selected={draft.accountIds?.includes(a.id) ?? false} onPress={() => set('accountIds', toggle(draft.accountIds, a.id))} />
          ))}
        </View>
        {heading(i.filterCategories)}
        <View style={styles.row}>
          {facets.categories.map((c) => (
            <Chip key={c.id} onGlass label={c.name} testID={`ifilter-category-${c.id}`} selected={draft.categoryIds?.includes(c.id) ?? false} onPress={() => set('categoryIds', toggle(draft.categoryIds, c.id))} />
          ))}
        </View>
        {heading(i.filterMerchant)}
        <TextInput testID="ifilter-merchant-search" accessibilityLabel={i.filterMerchantSearch} placeholder={i.filterMerchantSearch} placeholderTextColor={theme.color('on-glass-secondary')} value={search} onChangeText={setSearch} style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]} />
        {facets.merchants.length === 0 ? <Text style={[textStyle('caption'), { color: theme.color('on-glass-secondary') }]}>{i.filterNoMerchants}</Text> : null}
        <View style={styles.row}>
          {merchants.map((m) => (
            <Chip key={m.key} onGlass label={m.name} testID={`ifilter-merchant-${m.key}`} selected={draft.merchantKeys?.includes(m.key) ?? false} onPress={() => set('merchantKeys', toggle(draft.merchantKeys, m.key))} />
          ))}
        </View>
        {heading(i.filterType)}
        <View style={styles.row}>
          {types.map((t) => (
            <Chip key={t.id} onGlass label={t.label} testID={`ifilter-type-${t.id}`} selected={draft.types?.includes(t.id) ?? false} onPress={() => set('types', toggle(draft.types, t.id))} />
          ))}
        </View>
        {facets.tags.length > 0 ? (
          <>
            {heading(i.filterTags)}
            <View style={styles.row}>
              {facets.tags.map((t) => (
                <Chip key={t} onGlass label={`#${t}`} testID={`ifilter-tag-${t}`} selected={draft.tags?.includes(t) ?? false} onPress={() => set('tags', toggle(draft.tags, t))} />
              ))}
            </View>
          </>
        ) : null}
        {facets.sources.length > 0 ? (
          <>
            {heading(i.filterSource)}
            <View style={styles.row}>
              {facets.sources.map((s) => (
                <Chip key={s} onGlass label={i.sourceNames[s as keyof typeof i.sourceNames] ?? s} testID={`ifilter-source-${s}`} selected={draft.sources?.includes(s) ?? false} onPress={() => set('sources', toggle(draft.sources, s))} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
      <View style={styles.row}>
        <Button label={i.reset} variant="secondary" onGlass testID="ifilter-reset" onPress={() => setDraft({})} />
        <Button
          label={i.apply}
          testID="ifilter-apply"
          onPress={() => {
            onApply(draft);
            close();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  scroll: { maxHeight: 460 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
