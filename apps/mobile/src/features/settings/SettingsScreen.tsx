import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';
import {
  detectRegion,
  effectiveLocale,
  paydayFromChoice,
  paydaySummary,
  youSummary,
  type FirstDay,
  type NumberFormat,
  type PaydayChoice,
  type PeriodMode,
  type Region,
  type ThemeChoice,
} from '@wmbugo/core';
import { amountLabel, controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { invalidateForEvent } from '../../shared/queryClient';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { ScreenHeader } from '../shell/ScreenHeader';
import { Chip } from '../../shared/ui/Chip';
import { useFocusRing } from '../../shared/ui/FocusRing';
import { RegionPicker } from '../onboarding/OnboardingFlow';
import { realSettingsApi, SETTINGS_QUERY_KEY, type SettingsApi, type SettingsData } from './settingsApi';

type Page = 'hub' | 'you' | 'appearance' | 'money';

const THEMES: readonly { v: ThemeChoice; label: string }[] = [
  { v: 'system', label: copy.settings.themeSystem },
  { v: 'light', label: copy.settings.themeLight },
  { v: 'dark', label: copy.settings.themeDark },
];
const FORMATS: readonly { v: NumberFormat; label: string }[] = [
  { v: 'region', label: copy.settings.formatRegion },
  { v: 'international', label: copy.settings.formatInternational },
  { v: 'indian', label: copy.settings.formatIndian },
  { v: 'european', label: copy.settings.formatEuropean },
];
const PAYDAYS: readonly { v: PaydayChoice; label: string }[] = [
  { v: 'first', label: copy.onboarding.paydayFirst },
  { v: 'last_day', label: copy.onboarding.paydayLast },
  { v: 'last_working_day', label: copy.onboarding.paydayLastWorking },
  { v: 'other', label: copy.onboarding.paydayOther },
  { v: 'none', label: copy.onboarding.paydayNone },
];
const PERIODS: readonly { v: PeriodMode; label: string }[] = [
  { v: 'pay_cycle', label: copy.settings.periodPayCycle },
  { v: 'calendar_month', label: copy.settings.periodMonth },
];
const FIRST_DAYS: readonly { v: FirstDay; label: string }[] = [
  { v: 'mon', label: copy.settings.dayMon },
  { v: 'sun', label: copy.settings.daySun },
  { v: 'sat', label: copy.settings.daySat },
];

const choiceOf = (rule: { kind: string }): PaydayChoice => (rule.kind === 'day' ? 'other' : (rule.kind as PaydayChoice));

/**
 * Settings (SCR-21). Only the groups whose features exist in this build are listed: You. Each row's one-line
 * summary is part of its spoken label and updates as soon as a change is saved.
 */
export function SettingsScreen({ api = realSettingsApi, onBack }: { api?: SettingsApi; onBack: () => void }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => api.load() });
  const [page, setPage] = useState<Page>('hub');
  const [note, setNote] = useState<string | null>(null);
  const d = q.data ?? null;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 'hub') return false;
      setPage(page === 'you' ? 'hub' : 'you');
      return true;
    });
    return () => sub.remove();
  }, [page]);

  const refresh = () => invalidateForEvent(qc, 'ProfileChanged');
  const setSetting = async (key: string, value: unknown) => {
    setNote(null);
    const r = await api.changeSetting(key, value);
    if (!r.ok) setNote(copy.settings.saveError);
    await refresh();
  };

  const title = page === 'hub' ? copy.nav.settings : page === 'you' ? copy.settings.you : page === 'appearance' ? copy.settings.appearance : copy.settings.moneyBasics;
  const back = () => (page === 'hub' ? onBack() : setPage(page === 'you' ? 'hub' : 'you'));

  return (
    <View style={styles.fill}>
      <ScreenHeader title={title} onBack={back} backTestID="settings-back" />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {!d ? null : page === 'hub' ? (
        <Row testID="group-you" label={copy.settings.you} summary={youSummary(d.profile.payday, d.settings.theme)} onPress={() => setPage('you')} />
      ) : page === 'you' ? (
        <>
          <Row testID="row-appearance" label={copy.settings.appearance} summary={THEMES.find((t) => t.v === d.settings.theme)!.label} onPress={() => setPage('appearance')} />
          <Row
            testID="row-money"
            label={copy.settings.moneyBasics}
            summary={`${d.profile.region?.name ?? d.profile.regionCode} · ${d.profile.currency} · ${copy.settings.paydayWord} ${paydaySummary(d.profile.payday)}`}
            onPress={() => setPage('money')}
          />
          <SwitchRow
            testID="switch-block-transfers"
            label={copy.settings.blockTransfers}
            hint={copy.settings.blockTransfersHint}
            value={d.settings.blockTransfers}
            onChange={(v) => void setSetting('finance.block_transfers_above_balance', v)}
          />
        </>
      ) : page === 'appearance' ? (
        <Appearance d={d} onSet={setSetting} />
      ) : (
        <Money d={d} api={api} refresh={refresh} onSet={setSetting} />
      )}
      {note ? (
        <Text accessibilityRole="alert" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
          {`${note} ${copy.errors.nothingSaved}`}
        </Text>
      ) : null}
      </ScrollView>
    </View>
  );
}

function Appearance({ d, onSet }: { d: SettingsData; onSet: (key: string, value: unknown) => Promise<void> }) {
  const theme = useTheme();
  return (
    <View style={styles.gap}>
      <Group label={copy.settings.theme}>
        {THEMES.map((t) => (
          <Chip key={t.v} label={t.label} role="radio" variant="period" testID={`theme-${t.v}`} selected={d.settings.theme === t.v} onPress={() => void onSet('theme', t.v)} />
        ))}
      </Group>
      <Group label={copy.settings.numberFormat}>
        {FORMATS.map((f) => (
          <Chip key={f.v} label={f.label} role="radio" variant="period" testID={`format-${f.v}`} selected={d.settings.numberFormat === f.v} onPress={() => void onSet('ui.number_format', f.v)} />
        ))}
      </Group>
      <View
        style={styles.preview}
        testID="format-preview"
        accessible
        accessibilityLabel={`${copy.settings.previewLead} ${amountLabel({ amountMinor: sampleMinor(d.profile.currency), currency: d.profile.currency as never, locale: previewLocale(d), inline: true })}`}>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.settings.previewLead}</Text>
        <Amount amountMinor={sampleMinor(d.profile.currency)} currency={d.profile.currency as never} direction="neutral" locale={previewLocale(d)} />
      </View>
      <SwitchRow testID="switch-haptics" label={copy.settings.haptics} value={d.settings.haptics} onChange={(v) => void onSet('ui.haptics', v)} />
      <SwitchRow testID="switch-reduce-motion" label={copy.settings.reduceMotion} hint={copy.settings.reduceMotionHint} value={d.settings.reduceMotion} onChange={(v) => void onSet('ui.reduce_motion', v)} />
    </View>
  );
}

/** 1,234.50 in the currency's minor units. */
function sampleMinor(currency: string): number {
  return ['JPY', 'KRW', 'VND', 'IDR'].includes(currency) ? 1235 : 123450;
}

function previewLocale(d: SettingsData): string {
  return effectiveLocale(d.profile.locale, d.settings.numberFormat);
}

function Money({
  d,
  api,
  refresh,
  onSet,
}: {
  d: SettingsData;
  api: SettingsApi;
  refresh: () => Promise<unknown>;
  onSet: (key: string, value: unknown) => Promise<void>;
}) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [day, setDay] = useState(d.profile.payday.kind === 'day' ? String(d.profile.payday.day) : '');
  const [otherOpen, setOtherOpen] = useState(d.profile.payday.kind === 'day');
  const [dayError, setDayError] = useState(false);
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };

  const change = async (c: Parameters<SettingsApi['changeProfile']>[0]) => {
    setMessage(null);
    const r = await api.changeProfile(c);
    if (!r.ok) setMessage(r.code === 'CURRENCY_LOCKED' ? copy.settings.currencyLocked : copy.settings.saveError);
    await refresh();
  };

  if (picking) {
    return (
      <RegionPicker
        detected={detectRegion(d.profile.regionCode)}
        onClose={() => setPicking(false)}
        onPick={(r: Region) => {
          setPicking(false);
          if (d.hasTransactions && r.currency !== d.profile.currency) {
            setMessage(copy.settings.currencyLocked);
            return;
          }
          void change({ region: r });
        }}
      />
    );
  }

  return (
    <View style={styles.gap}>
      <Group label={copy.settings.region}>
        <Button label={`${d.profile.region?.name ?? d.profile.regionCode} · ${d.profile.currency}`} variant="secondary" onPress={() => setPicking(true)} testID="region-change" />
      </Group>
      {d.hasTransactions ? (
        <Text testID="currency-locked" style={[textStyle('caption'), muted]}>
          {copy.settings.currencyLockedNote}
        </Text>
      ) : null}
      {message ? (
        <Text testID="money-message" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
          {message}
        </Text>
      ) : null}

      <Group label={copy.settings.payday}>
        {PAYDAYS.map((p) => (
          <Chip
            key={p.v}
            label={p.label}
            role="radio"
            testID={`payday-${p.v}`}
            selected={otherOpen ? p.v === 'other' : choiceOf(d.profile.payday) === p.v}
            onPress={() => {
              if (p.v === 'other') {
                setOtherOpen(true);
                return;
              }
              setOtherOpen(false);
              const rule = paydayFromChoice(p.v);
              if (rule.ok) void change({ payday: rule.value });
            }}
          />
        ))}
      </Group>
      {otherOpen ? (
        <View style={styles.gap}>
          <TextInput
            testID="payday-day"
            accessibilityLabel={copy.onboarding.paydayDay}
            placeholder={copy.onboarding.paydayDay}
            placeholderTextColor={theme.color('text-secondary')}
            value={day}
            onChangeText={(t) => {
              setDay(t);
              setDayError(false);
            }}
            keyboardType="number-pad"
            style={[styles.input, textStyle('body'), ink, { borderColor: theme.color(dayError ? 'semantic-expense' : 'border-control') }]}
          />
          {dayError ? (
            <Text testID="payday-day-error" accessibilityRole="alert" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
              {copy.onboarding.paydayDayError}
            </Text>
          ) : null}
          <Button
            label={copy.common.save}
            variant="secondary"
            testID="payday-day-save"
            onPress={() => {
              const rule = paydayFromChoice('other', Number(day));
              if (!rule.ok) {
                setDayError(true);
                return;
              }
              void change({ payday: rule.value });
            }}
          />
        </View>
      ) : null}

      <Group label={copy.settings.period}>
        {PERIODS.map((p) => (
          <Chip key={p.v} label={p.label} role="radio" testID={`period-${p.v}`} selected={d.settings.periodMode === p.v} onPress={() => void onSet('finance.period_mode', p.v)} />
        ))}
      </Group>
      <Group label={copy.settings.firstDay}>
        {FIRST_DAYS.map((p) => (
          <Chip key={p.v} label={p.label} role="radio" testID={`firstday-${p.v}`} selected={d.settings.firstDay === p.v} onPress={() => void onSet('finance.first_day_of_week', p.v)} />
        ))}
      </Group>
      <Group label={copy.settings.defaultAccount}>
        <Chip label={copy.settings.noDefault} role="radio" testID="default-account-none" selected={d.settings.defaultAccountId === null} onPress={() => void onSet('finance.default_account', null)} />
        {d.accounts.map((a) => (
          <Chip key={a.id} label={a.name} role="radio" variant="account" testID={`default-account-${a.id}`} selected={d.settings.defaultAccountId === a.id} onPress={() => void onSet('finance.default_account', a.id)} />
        ))}
      </Group>

      <Group label={copy.settings.timezone}>
        <Text style={[textStyle('body'), ink]} testID="timezone-current">
          {d.profile.timezoneId}
        </Text>
        <Button label={copy.settings.useDeviceTimezone} variant="secondary" testID="timezone-device" onPress={() => void change({ timezoneId: deviceZone() })} />
      </Group>
      <Text style={[textStyle('caption'), muted]}>{copy.settings.timezoneNote}</Text>
    </View>
  );
}

function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.gap}>
      <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>
        {label}
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {children}
      </View>
    </View>
  );
}

function Row({ label, summary, onPress, testID }: { label: string; summary: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      testID={testID}
      {...controlA11y({ label: `${label}, ${summary}`, role: 'button' })}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: focused ? theme.color('focus-ring') : theme.color('border-hairline'), borderWidth: focused ? 2 : 1 }]}>
      <View style={styles.rowText}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{label}</Text>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{summary}</Text>
      </View>
      <Icon icon={CaretRight} size={20} color="text-secondary" />
    </Pressable>
  );
}

function SwitchRow({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.rowText}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{label}</Text>
        {hint ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{hint}</Text> : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.color('border-control'), true: theme.color('accent-primary') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  fill: { flex: 1 },
  gap: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radii.md, padding: 12, minHeight: layout.touchMin },
  rowText: { flex: 1 },
  preview: { gap: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
