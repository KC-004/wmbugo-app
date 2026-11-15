import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { greetingFor, shortDate, type ActivityQuery } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { ErrorBlock, Reveal, Skeleton, Tooltip } from '../../shared/feedback/Feedback';
import { useSheet } from '../../shared/feedback/SheetHost';
import { TooltipController } from '../../shared/feedback/tooltipController';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { ScreenHeader } from '../shell/ScreenHeader';
import { realSettingsApi, TIMEZONE_QUERY_KEY, type SettingsApi } from '../settings/settingsApi';
import { HeroCard } from './HeroCard';
import { HomeBand } from './HomeBand';
import { HOME_QUERY_KEY, realHomeApi, type HomeApi } from './homeApi';
import { useHomeRefresh, useSlowFlag } from './useHomeRefresh';

const TIP_ID = 'tip.in-accounts';
const systemNow = () => Date.now();

/** What a tap on the hero opens: the overall budget, the Plan tab (only 50/30/20 targets), or the editor (no budget). */
export interface HomeNav {
  onAccounts: () => void;
  onProfile: () => void;
  onAddAccount: () => void;
  onOpenBudget: (budgetId: string) => void;
  onOpenPlan: () => void;
  onSetLimit: () => void;
  onSortIt: (query: ActivityQuery) => void;
}

/**
 * Home: the greeting, today's date and the period chip, then the "Am I okay?" hero (Story 5.2) on the brand band (light) or
 * the glows (dark). It refreshes by itself: events, returning to the app and a new day all recompute it (Story 5.1).
 */
export function HomeScreen({ api = realHomeApi, settingsApi = realSettingsApi, onAccounts, onProfile, onAddAccount, onOpenBudget, onOpenPlan, onSetLimit, onSortIt }: HomeNav & { api?: HomeApi; settingsApi?: SettingsApi }) {
  const theme = useTheme();
  const sheet = useSheet();
  const home = useQuery({ queryKey: HOME_QUERY_KEY, queryFn: () => api.load() });
  const d = home.data ?? null;
  const tz = useQuery({ queryKey: TIMEZONE_QUERY_KEY, queryFn: () => settingsApi.timezoneCheck() });
  const qc = useQueryClient();
  // Hide amounts is Story 5.3: until then the eye toggles this local flag only.
  const [hidden, setHidden] = useState(false);

  // A recompute that takes longer than 300 ms keeps the old values and says so; a quick one never flashes (Story 5.1).
  const updating = useSlowFlag(home.isFetching && !home.isLoading);
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ['home'] }), [qc]);
  useHomeRefresh({ today: d?.today, timezoneId: d?.timezoneId, nowMs: api.nowMs ?? systemNow, refresh });

  const [tip, setTip] = useState<string | null>(null);
  const sheetOpen = useRef(false);
  sheetOpen.current = sheet.openId !== null;
  const tips = useRef<TooltipController | null>(null);
  if (!tips.current) tips.current = new TooltipController(api.seen, () => sheetOpen.current, setTip);

  const hasAccounts = d?.summary.accounts.hasAccounts ?? false;
  useEffect(() => {
    if (hasAccounts) void tips.current?.request(TIP_ID).catch(() => undefined);
  }, [hasAccounts]);
  useEffect(() => {
    if (sheet.openId !== null) tips.current?.suspendForSheet();
  }, [sheet.openId]);

  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  const card = [styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }];

  const skeleton = (
    <View style={styles.gap} testID="home-skeleton">
      <Skeleton height={176} />
    </View>
  );

  const open = () => {
    if (!d) return;
    const s = d.summary;
    if (s.overallBudgetId) onOpenBudget(s.overallBudgetId);
    else if (s.heroMode === 'nws_only') onOpenPlan();
    else onSetLimit();
  };

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <ScreenHeader title={d ? greetingFor(d.hour) : copy.nav.home} onAccounts={onAccounts} onProfile={onProfile} />
      {d ? (
        <View style={styles.dateRow}>
          <Text testID="home-date" style={[textStyle('caption'), muted]}>
            {shortDate(d.today)}
          </Text>
          <Text testID="period-chip" style={[textStyle('caption'), ink]} accessibilityLabel={updating ? copy.home.updating : d.summary.period.title}>
            {updating ? copy.home.updating : d.summary.period.title}
          </Text>
        </View>
      ) : null}

      <View style={styles.heroZone}>
        {d ? <HomeBand /> : null}
        <Reveal loading={home.isLoading} skeleton={skeleton}>
          {d ? (
            <View style={styles.gap}>
              {/* A recompute failed but the last values are kept: say so, with Retry, instead of leaving them looking current. */}
              {home.isError && !home.isFetching ? (
                <View testID="stale-error">
                  <ErrorBlock cause={copy.home.cardError} onRetry={() => void home.refetch()} />
                </View>
              ) : null}
              <HeroCard
                view={d.hero}
                summary={d.summary}
                currency={d.currency}
                locale={d.locale}
                hidden={hidden}
                onToggleHidden={() => setHidden((h) => !h)}
                updating={updating}
                onOpen={open}
                onSetLimit={onSetLimit}
                onSortIt={() => d.summary.sortIt && onSortIt({ categoryIds: d.summary.sortIt.categoryIds, fromDate: d.summary.sortIt.fromDate, toDate: d.summary.sortIt.toDate })}
                onAddAccount={onAddAccount}
              />
              {tip ? <Tooltip text={copy.home.tip} onAcknowledge={() => void tips.current?.acknowledge().catch(() => undefined)} /> : null}
            </View>
          ) : home.isError ? (
            // The load failed: the hero card says so with Retry; the header and the rest of Home stay usable and nothing reads as zero.
            <View testID="hero-error">
              <ErrorBlock cause={copy.home.cardError} onRetry={() => void home.refetch()} />
            </View>
          ) : null}
        </Reveal>
      </View>

      {/* Its own query: a failing Home load never hides it. */}
      {tz.data ? (
        <View testID="timezone-prompt" accessibilityLiveRegion="polite" style={card}>
          <Text style={[textStyle('body'), ink]}>{copy.settings.tzPrompt}</Text>
          <View style={styles.row}>
            <Button label={copy.settings.tzYes} testID="tz-yes" onPress={() => void settingsApi.answerTimezone(true, tz.data!.deviceTz).then(() => qc.invalidateQueries({ queryKey: TIMEZONE_QUERY_KEY }))} />
            <Button label={copy.settings.tzNo} variant="text" testID="tz-no" onPress={() => void settingsApi.answerTimezone(false, tz.data!.deviceTz).then(() => qc.invalidateQueries({ queryKey: TIMEZONE_QUERY_KEY }))} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 8 },
  gap: { gap: 12 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  heroZone: { marginTop: 4 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 4 },
  row: { flexDirection: 'row', gap: 16 },
});
