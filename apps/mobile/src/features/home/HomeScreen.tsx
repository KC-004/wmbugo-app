import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { greetingFor, resolveHomeLayout, shortDate, type ActivityQuery } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { tabBarClearance } from '../../shared/feedback/layout';
import { ErrorBlock, Reveal, Skeleton, Tooltip } from '../../shared/feedback/Feedback';
import { useSheet } from '../../shared/feedback/SheetHost';
import { TooltipController } from '../../shared/feedback/tooltipController';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { TopBar } from '../../shared/ui/TopBar';
import { realSettingsApi, SETTINGS_QUERY_KEY, TIMEZONE_QUERY_KEY, type SettingsApi } from '../settings/settingsApi';
import { REGISTERED_FOR_LAYOUT } from './cardRegistry';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { HeroCard } from './HeroCard';
import { HomeCards, type HomeCardsNav } from './HomeCards';
import { useToggleHideAmounts } from './useHideAmounts';
import { HomeBand } from './HomeBand';
import { HOME_QUERY_KEY, realHomeApi, type HomeApi } from './homeApi';
import { useHomeRefresh, useSlowFlag } from './useHomeRefresh';

const TIP_ID = 'tip.in-accounts';
const systemNow = () => Date.now();

/** What a tap on the hero opens: the overall budget, the Plan tab (only 50/30/20 targets), or the editor (no budget). */
export interface HomeNav extends HomeCardsNav {
  onAccounts: () => void;
  onProfile: () => void;
  onAddAccount: () => void;
  onOpenPlan: () => void;
  onSetLimit: () => void;
  onSortIt: (query: ActivityQuery) => void;
  /** Opens Edit Home (SCR-05). */
  onEditHome: () => void;
}

/**
 * Home: the greeting, today's date and the period chip, then the "Am I okay?" hero (Story 5.2) on the brand band (light) or
 * the glows (dark). It refreshes by itself: events, returning to the app and a new day all recompute it (Story 5.1).
 */
export function HomeScreen({ api = realHomeApi, settingsApi = realSettingsApi, onAccounts, onProfile, onAddAccount, onOpenBudget, onOpenPlan, onSetLimit, onSortIt, onOpenReview, onOpenActivity, onEditHome, onOpenBill, onOpenGoal, onOpenGoals }: HomeNav & { api?: HomeApi; settingsApi?: SettingsApi }) {
  const theme = useTheme();
  const sheet = useSheet();
  const insets = useContext(SafeAreaInsetsContext);
  const home = useQuery({ queryKey: HOME_QUERY_KEY, queryFn: () => api.load() });
  const d = home.data ?? null;
  // The saved layout (Story 5.6): a missing or unreadable value is the PRD order.
  const settingsQ = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: async () => (settingsApi.load ? await settingsApi.load() : null), retryOnMount: false });
  const layout = resolveHomeLayout(REGISTERED_FOR_LAYOUT, settingsQ.data?.settings.homeLayout);
  const tz = useQuery({ queryKey: TIMEZONE_QUERY_KEY, queryFn: () => settingsApi.timezoneCheck() });
  const qc = useQueryClient();
  // Hide amounts (Story 5.3): the eye flips the one app-wide flag and saves it.
  const hidden = useAmountsHidden();
  const toggleHidden = useToggleHideAmounts(settingsApi);

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
    if (s.overallBudgetId) onOpenBudget(s.overallBudgetId, s.period.start);
    else if (s.heroMode === 'nws_only') onOpenPlan();
    else onSetLimit();
  };

  return (
    <>
    {/* The header sits outside the scroll, like on every other tab: it stays put and is not inset twice by the scroll padding. */}
    <TopBar title={d ? greetingFor(d.hour) : copy.nav.home} onAccounts={onAccounts} onProfile={onProfile} />
    <ScrollView testID="home-scroll" contentContainerStyle={[styles.pad, { paddingTop: 0, paddingBottom: 16 + tabBarClearance(insets?.bottom ?? 0) }]}>
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
                onToggleHidden={toggleHidden}
                updating={updating}
                onOpen={open}
                onSetLimit={onSetLimit}
                onSortIt={() => d.summary.sortIt && onSortIt({ categoryIds: d.summary.sortIt.categoryIds, fromDate: d.summary.sortIt.fromDate, toDate: d.summary.sortIt.toDate })}
                onAddAccount={onAddAccount}
              />
              <HomeCards layout={layout} layoutReady={!settingsQ.isPending} api={api} toCheckCount={d.summary.toCheckCount} currency={d.currency} locale={d.locale} nav={{ onOpenReview, onOpenBudget, onOpenPlan, onOpenActivity, ...(onOpenBill ? { onOpenBill } : {}), ...(onOpenGoal ? { onOpenGoal } : {}), ...(onOpenGoals ? { onOpenGoals } : {}) }} />
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

      <Button label={copy.home.edit.editHome} variant="text" onPress={onEditHome} testID="home-edit-home" />

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
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 8 },
  gap: { gap: 12 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  heroZone: { marginTop: 4 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 4 },
  row: { flexDirection: 'row', gap: 16 },
});
