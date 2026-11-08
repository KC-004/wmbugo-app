import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { greetingFor, shortDate } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { Reveal, Skeleton, Tooltip } from '../../shared/feedback/Feedback';
import { useSheet } from '../../shared/feedback/SheetHost';
import { TooltipController } from '../../shared/feedback/tooltipController';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { ScreenHeader } from '../shell/ScreenHeader';
import { realSettingsApi, type SettingsApi } from '../settings/settingsApi';
import { HOME_QUERY_KEY, realHomeApi, type HomeApi, type HomeData } from './homeApi';

const TIP_ID = 'tip.in-accounts';

/**
 * Home: greeting and today's date, "Spent this period" from the ledger, and the accounts line ("In accounts"
 * and "Card dues" side by side, never summed). It refreshes when `TransactionsChanged` invalidates `home`.
 */
export function HomeScreen({
  api = realHomeApi,
  onAccounts,
  onProfile,
  onAddAccount,
  settingsApi = realSettingsApi,
}: {
  api?: HomeApi;
  settingsApi?: SettingsApi;
  onAccounts: () => void;
  onProfile: () => void;
  onAddAccount: () => void;
}) {
  const theme = useTheme();
  const sheet = useSheet();
  const { fontScale } = useWindowDimensions();
  const home = useQuery({ queryKey: HOME_QUERY_KEY, queryFn: () => api.load() });
  const d = home.data ?? null;
  const tz = useQuery({ queryKey: ['home', 'timezone'], queryFn: () => settingsApi.timezoneCheck() });
  const qc = useQueryClient();
  const stack = fontScale >= 1.3;

  const [tip, setTip] = useState<string | null>(null);
  const sheetOpen = useRef(false);
  sheetOpen.current = sheet.openId !== null;
  const tips = useRef<TooltipController | null>(null);
  if (!tips.current) tips.current = new TooltipController(api.seen, () => sheetOpen.current, setTip);

  const hasAccounts = d?.accounts.hasAccounts ?? false;
  useEffect(() => {
    if (hasAccounts) void tips.current?.request(TIP_ID);
  }, [hasAccounts]);
  useEffect(() => {
    if (sheet.openId !== null) tips.current?.suspendForSheet();
  }, [sheet.openId]);

  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  const card = [styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }];

  const skeleton = (
    <View style={styles.gap} testID="home-skeleton">
      <Skeleton height={120} />
      <Skeleton height={72} />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <ScreenHeader title={d ? greetingFor(d.hour) : copy.nav.home} onAccounts={onAccounts} onProfile={onProfile} />
      {d ? (
        <Text testID="home-date" style={[textStyle('caption'), muted]}>
          {shortDate(d.today)}
        </Text>
      ) : null}

      <Reveal loading={home.isLoading} skeleton={skeleton}>
        {d ? (
          <View style={styles.gap}>
            <View
              testID="spent-card"
              accessible
              accessibilityLabel={`${copy.home.spentThisPeriod}, ${amountLabel({ amountMinor: d.spentMinor, currency: d.currency, locale: d.locale, inline: true })}, ${d.scope}`}
              style={card}>
              <Text style={[textStyle('label'), muted]}>{copy.home.spentThisPeriod}</Text>
              <Amount amountMinor={d.spentMinor} currency={d.currency} direction="expense" role="display-amount" locale={d.locale} />
              <Text style={[textStyle('caption'), muted]}>{d.scope}</Text>
            </View>

            <View testID="accounts-line" style={[card, stack ? styles.column : styles.row]}>
              {d.accounts.hasAccounts ? (
                <>
                  <View style={styles.cell} accessible accessibilityLabel={inAccountsLabel(d)}>
                    <Text style={[textStyle('label'), muted]}>{copy.home.inAccounts}</Text>
                    {d.accounts.inAccountsMinor === null ? (
                      <Text style={[textStyle('body-medium'), ink]}>{copy.money.notSet}</Text>
                    ) : (
                      <Amount amountMinor={d.accounts.inAccountsMinor} currency={d.currency} direction="neutral" locale={d.locale} />
                    )}
                    {d.accounts.notSetCount > 0 ? (
                      <Text testID="not-set-note" style={[textStyle('caption'), muted]}>
                        {d.accounts.notSetCount === 1 ? copy.home.notSetOne : copy.home.notSetMany.replace("{n}", String(d.accounts.notSetCount))}
                      </Text>
                    ) : null}
                  </View>
                  {d.accounts.cardDuesMinor !== null ? (
                    <View style={styles.cell} accessible accessibilityLabel={`${copy.home.cardDues}, ${amountLabel({ amountMinor: d.accounts.cardDuesMinor, currency: d.currency, locale: d.locale, inline: true })}`}>
                      <Text style={[textStyle('label'), muted]}>{copy.home.cardDues}</Text>
                      <Amount amountMinor={d.accounts.cardDuesMinor} currency={d.currency} direction="neutral" locale={d.locale} />
                    </View>
                  ) : null}
                </>
              ) : (
                <View style={styles.cell}>
                  <Text style={[textStyle('body'), ink]}>{copy.home.setUpAccount}</Text>
                  <Button label={copy.home.addAccount} variant="secondary" onPress={onAddAccount} testID="home-add-account" />
                </View>
              )}
            </View>

            {tz.data ? (
              <View testID="timezone-prompt" accessibilityLiveRegion="polite" style={card}>
                <Text style={[textStyle('body'), ink]}>{copy.settings.tzPrompt}</Text>
                <View style={styles.row}>
                  <Button label={copy.settings.tzYes} testID="tz-yes" onPress={() => void settingsApi.answerTimezone(true, tz.data!.deviceTz).then(() => qc.invalidateQueries())} />
                  <Button label={copy.settings.tzNo} variant="text" testID="tz-no" onPress={() => void settingsApi.answerTimezone(false, tz.data!.deviceTz).then(() => qc.invalidateQueries())} />
                </View>
              </View>
            ) : null}
            {tip ? <Tooltip text={copy.home.tip} onAcknowledge={() => void tips.current?.acknowledge()} /> : null}
          </View>
        ) : home.isError ? (
          <View style={card}>
            <Text style={[textStyle('body'), ink]}>{copy.home.loadError}</Text>
            <Button label={copy.common.tryAgain} variant="secondary" onPress={() => void home.refetch()} />
          </View>
        ) : null}
      </Reveal>
    </ScrollView>
  );
}

function inAccountsLabel(d: HomeData): string {
  const a = d.accounts;
  const base = a.inAccountsMinor === null ? `${copy.home.inAccounts}, ${copy.money.notSet}` : `${copy.home.inAccounts}, ${amountLabel({ amountMinor: a.inAccountsMinor, currency: d.currency, locale: d.locale, inline: true })}`;
  if (a.notSetCount === 0) return base;
  return `${base}, ${a.notSetCount === 1 ? copy.home.notSetOne : copy.home.notSetMany.replace("{n}", String(a.notSetCount))}`;
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 8 },
  gap: { gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 4 },
  row: { flexDirection: 'row', gap: 16 },
  column: { flexDirection: 'column', gap: 12 },
  cell: { flex: 1, gap: 2 },
});
