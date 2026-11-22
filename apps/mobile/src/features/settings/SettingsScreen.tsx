import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';
import {
  dayMonthLabel,
  detectRegion,
  effectiveLocale,
  paydayFromChoice,
  paydaySummary,
  periodRangeLabel,
  backupSummary,
  effectiveCaptureForm,
  retentionLine,
  sizeLabel,
  privacySummary,
  youSummary,
  type FirstDay,
  type LockAfter,
  type NumberFormat,
  type PaydayChoice,
  type PaydayRule,
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
import { TopBar } from '../../shared/ui/TopBar';
import { Chip } from '../../shared/ui/Chip';
import { useFocusRing } from '../../shared/ui/FocusRing';
import { openSecuritySettings } from '../../adapters/appLock';
import { BackupScreen } from '../backup/BackupScreen';
import { DiagnosticsExportScreen, DiagnosticsScreen } from '../diagnostics/DiagnosticsScreen';
import { realDiagnosticsApi } from '../diagnostics/diagnosticsApi';
import { EraseFlow } from '../erase/EraseFlow';
import { RestoreFlow } from '../restore/RestoreFlow';
import { enableAppLock } from '../lock/enableAppLock';
import { hidingBlocksScreenshots } from '../../adapters/recentsPrivacy';
import { requireReauth } from '../../shared/reauth';
import { RegionPicker } from '../onboarding/OnboardingFlow';
import { CategoriesScreen } from '../categories/CategoriesScreen';
import { ImportWizard } from '../import/ImportWizard';
import { RecentlyDeletedScreen } from './RecentlyDeletedScreen';
import { realSettingsApi, SETTINGS_QUERY_KEY, type SettingsApi, type SettingsData } from './settingsApi';

type Page = 'hub' | 'you' | 'appearance' | 'money' | 'categories' | 'data' | 'deleted' | 'privacy' | 'stays' | 'notifications' | 'backup' | 'restore' | 'import' | 'help' | 'diagnostics' | 'export' | 'erase';

/** Where Back goes from each page. */
const PARENT: Readonly<Record<Page, Page>> = { hub: 'hub', you: 'hub', appearance: 'you', money: 'you', categories: 'hub', data: 'hub', deleted: 'data', privacy: 'hub', stays: 'privacy', notifications: 'privacy', backup: 'data', restore: 'data', import: 'data', help: 'hub', diagnostics: 'help', export: 'diagnostics', erase: 'data' };

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

/** What stays on this phone: plain rows, one sentence each. No row claims bytes can never leave the phone. */
const STAYS: readonly (readonly [string, string])[] = [
  [copy.privacy.staysEntriesTitle, copy.privacy.staysEntries],
  [copy.privacy.staysInternetTitle, copy.privacy.staysInternet],
  [copy.privacy.staysBackupsTitle, copy.privacy.staysBackups],
  [copy.privacy.staysFilesTitle, copy.privacy.staysFiles],
  [copy.privacy.staysDiagnosticsTitle, copy.privacy.staysDiagnostics],
];

/** The effective shade form for captures, from the saved settings. */
const captureForm = (d: SettingsData): 'full' | 'hidden' =>
  effectiveCaptureForm({ notificationDetail: d.settings.notificationDetail, fullNotificationsOptIn: d.settings.fullNotificationsOptIn, appLockEnabled: d.settings.appLockEnabled, hideAmounts: d.settings.hideAmounts });

const LOCK_AFTER: readonly { v: LockAfter; label: string }[] = [
  { v: 'immediately', label: copy.lock.immediately },
  { v: '1m', label: copy.lock.afterOneMinute },
  { v: '5m', label: copy.lock.afterFiveMinutes },
  { v: '15m', label: copy.lock.afterFifteenMinutes },
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
  const [backupBusy, setBackupBusy] = useState(false);
  const d = q.data ?? null;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (backupBusy) return true; // a backup in progress is stopped with its own Cancel, not by Back
      if (page === 'hub') return false;
      setPage(PARENT[page]);
      return true;
    });
    return () => sub.remove();
  }, [page, backupBusy]);

  const refresh = () => invalidateForEvent(qc, 'ProfileChanged');
  const setSetting = async (key: string, value: unknown) => {
    setNote(null);
    const r = await api.changeSetting(key, value);
    if (!r.ok) setNote(copy.settings.saveError);
    await refresh();
  };

  const setHideAmounts = async (hidden: boolean) => {
    setNote(null);
    const r = await api.setHideAmounts(hidden);
    if (!r.ok) setNote(copy.settings.saveError);
    await refresh();
  };

  const setNotifPrivacy = async (input: { detail?: 'full' | 'hidden'; fullOptIn?: boolean }) => {
    setNote(null);
    const r = await api.setNotificationPrivacy(input);
    if (!r.ok) setNote(copy.settings.saveError);
    await refresh();
  };
  const [lockMessage, setLockMessage] = useState<{ text: string; openSettings: boolean } | null>(null);
  /** Turning app lock on: needs a screen lock and a successful system prompt; only then is anything saved (Story 8.3). */
  const turnOnAppLock = async () => {
    setLockMessage(null);
    setNote(null);
    const r = await enableAppLock(api);
    if (r.status === 'needs-screen-lock') setLockMessage({ text: copy.lock.needScreenLock, openSettings: true });
    else if (r.status === 'failed') {
      if (r.reason === 'save') setNote(r.message);
      else setLockMessage({ text: r.message, openSettings: false });
    }
    // Cancelled or failed: nothing was saved. The app-switcher hiding comes on with app lock (Story 8.2).
    await refresh();
  };
  const turnOffAppLock = async () => {
    setLockMessage(null);
    if (!(await requireReauth())) return; // cancelled: the screen stays as it was
    const r = await api.setAppLock(false);
    if (!r.ok) setNote(copy.lock.couldntSave);
    await refresh();
  };
  const changeLockAfter = async (v: string) => {
    if (v === d?.settings.lockAfter) return;
    if (!(await requireReauth())) return;
    await setSetting('device.lock_after', v);
  };

  const title =
    page === 'hub' ? copy.nav.settings : page === 'you' ? copy.settings.you : page === 'appearance' ? copy.settings.appearance : page === 'money' ? copy.settings.moneyBasics : page === 'categories' ? copy.categories.title : page === 'data' ? copy.deleted.data : page === 'privacy' ? copy.privacy.group : page === 'stays' ? copy.privacy.staysTitle : page === 'notifications' ? copy.notifPrivacy.title : page === 'backup' ? copy.backup.title : page === 'restore' ? copy.restore.title : page === 'help' ? copy.diagnostics.helpGroup : page === 'diagnostics' ? copy.diagnostics.title : page === 'export' ? copy.diagnostics.previewTitle : page === 'erase' ? copy.erase.scopeTitle : copy.deleted.recentlyDeleted;
  const back = () => (backupBusy ? undefined : page === 'hub' ? onBack() : setPage(PARENT[page]));

  return (
    <View style={styles.fill}>
      <TopBar title={title} onBack={back} backTestID="settings-back" />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {!d ? null : page === 'hub' ? (
        <>
          <Row testID="group-you" label={copy.settings.you} summary={youSummary(d.profile.payday, d.settings.theme)} onPress={() => setPage('you')} />
          <Row
            testID="group-money"
            label={copy.categories.group}
            summary={d.expenseCategoryCount === 1 ? copy.categories.summaryOne : copy.categories.summaryMany.replace('{n}', String(d.expenseCategoryCount))}
            onPress={() => setPage('categories')}
          />
          <Row testID="group-privacy" label={copy.privacy.group} summary={privacySummary({ appLock: d.settings.appLockEnabled, hideAmounts: d.settings.hideAmounts, notifications: captureForm(d) })} onPress={() => setPage('privacy')} />
          <Row testID="group-help" label={copy.diagnostics.helpGroup} summary={copy.diagnostics.helpSummary} onPress={() => setPage('help')} />
          <Row testID="group-data" label={copy.deleted.data} summary={backupSummary(d.settings.lastBackupAt, d.profile.timezoneId)} onPress={() => setPage('data')} />
        </>
      ) : page === 'privacy' ? (
        <>
          <SwitchRow
            testID="switch-app-lock"
            label={copy.lock.appLock}
            hint={copy.lock.appLockHint}
            value={d.settings.appLockEnabled}
            onChange={(v) => void (v ? turnOnAppLock() : turnOffAppLock())}
          />
          {lockMessage ? (
            <View style={styles.gap}>
              <Text testID="lock-setup-message" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
                {lockMessage.text}
              </Text>
              {lockMessage.openSettings ? <Button label={copy.lock.openSettings} variant="secondary" testID="lock-open-security" onPress={() => void openSecuritySettings()} /> : null}
            </View>
          ) : null}
          {d.settings.appLockEnabled ? (
            <Group label={copy.lock.lockAfter}>
              {LOCK_AFTER.map((c) => (
                <Chip key={c.v} label={c.label} role="radio" variant="period" testID={`lock-after-${c.v}`} selected={d.settings.lockAfter === c.v} onPress={() => void changeLockAfter(c.v)} />
              ))}
            </Group>
          ) : null}
          <SwitchRow
            testID="switch-hide-amounts"
            label={copy.privacy.hideAmounts}
            hint={copy.privacy.hideAmountsHint}
            value={d.settings.hideAmounts}
            onChange={(v) => void setHideAmounts(v)}
          />
          <SwitchRow
            testID="switch-hide-recents"
            label={copy.privacy.hideInRecents}
            hint={hidingBlocksScreenshots() ? `${copy.privacy.hideInRecentsHint} ${copy.privacy.blocksScreenshots}` : copy.privacy.hideInRecentsHint}
            value={d.settings.hideInRecents}
            onChange={(v) => void setSetting('device.hide_in_recents', v)}
          />
          <Row
            testID="row-notifications"
            label={copy.notifPrivacy.row}
            summary={captureForm(d) === 'hidden' ? copy.notifPrivacy.summaryHidden : copy.notifPrivacy.summaryFull}
            onPress={() => setPage('notifications')}
          />
          <Row testID="row-stays" label={copy.privacy.staysRow} summary={copy.privacy.staysSummary} onPress={() => setPage('stays')} />
        </>
      ) : page === 'notifications' ? (
        <View style={styles.gap}>
          {d.notificationsOff ? (
            <View style={styles.gap}>
              <Text testID="notifications-off" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>
                {copy.notifPrivacy.off}
              </Text>
              <Button label={copy.notifPrivacy.openSettings} variant="secondary" testID="notifications-open-settings" onPress={() => void openSecuritySettings()} />
            </View>
          ) : null}
          <Group label={copy.notifPrivacy.title}>
            <Chip label={copy.notifPrivacy.full} role="radio" testID="notif-detail-full" selected={d.settings.notificationDetail === 'full'} onPress={() => void setNotifPrivacy({ detail: 'full' })} />
            <Chip label={copy.notifPrivacy.hidden} role="radio" testID="notif-detail-hidden" selected={d.settings.notificationDetail === 'hidden'} onPress={() => void setNotifPrivacy({ detail: 'hidden' })} />
          </Group>
          <SwitchRow
            testID="switch-notif-optin"
            label={copy.notifPrivacy.optIn}
            value={d.settings.fullNotificationsOptIn}
            onChange={(v) => void setNotifPrivacy({ fullOptIn: v })}
          />
          <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.notifPrivacy.lockScreenCaption}</Text>
        </View>
      ) : page === 'stays' ? (
        <>
          {STAYS.map(([title, text]) => (
            <View key={title} testID={`stays-${title}`} accessible accessibilityLabel={`${title}. ${text}`} style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
              <View style={styles.rowText}>
                <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{title}</Text>
                <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{text}</Text>
              </View>
            </View>
          ))}
        </>
      ) : page === 'categories' ? (
        <CategoriesScreen />
      ) : page === 'data' ? (
        <>
          <Row testID="row-backup" label={copy.backup.dataRow} summary={backupSummary(d.settings.lastBackupAt, d.profile.timezoneId)} onPress={() => setPage('backup')} />
          <Row testID="row-restore" label={copy.restore.row} summary={copy.restore.title} onPress={() => setPage('restore')} />
          <Row testID="row-import" label={copy.csvImport.row} summary={copy.csvImport.rowSummary} onPress={() => setPage('import')} />
          <Row testID="row-deleted" label={copy.deleted.recentlyDeleted} summary={copy.deleted.keptFor} onPress={() => setPage('deleted')} />
          <StorageRow />
          <View accessible testID="row-keeping" accessibilityLabel={`${copy.erase.keeping}. ${retentionLine()}`} style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
            <View style={styles.rowText}>
              <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.erase.keeping}</Text>
              <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{retentionLine()}</Text>
            </View>
          </View>
          <Row testID="row-erase" label={copy.erase.row} summary={copy.erase.rowSummary} onPress={() => setPage('erase')} />
        </>
      ) : page === 'backup' ? (
        <BackupScreen onBusyChange={setBackupBusy} onDone={() => setPage('data')} />
      ) : page === 'help' ? (
        <Row testID="row-diagnostics" label={copy.diagnostics.row} summary={copy.diagnostics.title} onPress={() => setPage('diagnostics')} />
      ) : page === 'diagnostics' ? (
        <DiagnosticsScreen onExport={() => setPage('export')} />
      ) : page === 'export' ? (
        <DiagnosticsExportScreen />
      ) : page === 'erase' ? (
        <EraseFlow onBusyChange={setBackupBusy} onExit={() => setPage('data')} />
      ) : page === 'import' ? (
        <ImportWizard onBusyChange={setBackupBusy} onContinue={() => setPage('data')} />
      ) : page === 'restore' ? (
        <RestoreFlow onBusyChange={setBackupBusy} onExit={() => setPage('data')} />
      ) : page === 'deleted' ? (
        <RecentlyDeletedScreen />
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
        accessibilityLabel={`${copy.settings.previewLead} ${amountLabel({ amountMinor: sampleMinor(d.profile.currency), currency: d.profile.currency as never, locale: previewLocale(d), inline: true, hidden: false })}`}>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.settings.previewLead}</Text>
        <Amount amountMinor={sampleMinor(d.profile.currency)} currency={d.profile.currency as never} direction="neutral" hidden={false} locale={previewLocale(d)} />
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
  const [confirmPayday, setConfirmPayday] = useState<{ rule: PaydayRule; text: string } | null>(null);
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };

  const change = async (c: Parameters<SettingsApi['changeProfile']>[0]) => {
    setMessage(null);
    const r = await api.changeProfile(c);
    if (!r.ok) setMessage(r.code === 'CURRENCY_LOCKED' ? copy.settings.currencyLocked : copy.settings.saveError);
    await refresh();
  };

  /** A payday change that cuts the current cycle short asks first (Story 4.8); anything else saves at once. */
  const requestPayday = async (rule: PaydayRule) => {
    setMessage(null);
    const plan = rule.kind === 'none' ? null : await api.previewPayday?.(rule).catch(() => null);
    if (!plan) return void change({ payday: rule });
    const text = copy.settings.paydayCycleEnds.replace('{end}', dayMonthLabel(plan.cycleEnd)) + (plan.shortened ? ` ${copy.settings.paydayBudgetsAdjusted.replace('{range}', periodRangeLabel(plan.shortened.start, plan.shortened.end))}` : '');
    setConfirmPayday({ rule, text });
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
              if (rule.ok) void requestPayday(rule.value);
            }}
          />
        ))}
      </Group>
      {confirmPayday ? (
        <View testID="payday-confirm" style={styles.gap}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), ink]}>{confirmPayday.text}</Text>
          <Button
            label={copy.settings.paydayChange}
            testID="payday-confirm-yes"
            onPress={() => {
              const rule = confirmPayday.rule;
              setConfirmPayday(null);
              void change({ payday: rule });
            }}
          />
          <Button label={copy.common.cancel} variant="text" testID="payday-confirm-cancel" onPress={() => setConfirmPayday(null)} />
        </View>
      ) : null}
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
              void requestPayday(rule.value);
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

/** Settings › Data › Storage (Story 8.11): what wmbugo uses on this phone, read when the page opens. */
function StorageRow() {
  const theme = useTheme();
  const [text, setText] = useState<string>(copy.diagnostics.loading);
  useEffect(() => {
    let live = true;
    void realDiagnosticsApi.status().then(
      (st) => live && setText(copy.erase.storageValue.replace('{db}', sizeLabel(st.storage.dbBytes)).replace('{photos}', sizeLabel(st.storage.photoBytes)).replace('{log}', sizeLabel(st.storage.logBytes))),
      () => live && setText(copy.erase.storageValue.replace('{db}', sizeLabel(null)).replace('{photos}', sizeLabel(null)).replace('{log}', sizeLabel(null))),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <View accessible testID="row-storage" accessibilityLabel={`${copy.erase.storage}. ${text}`} style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.rowText}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.erase.storage}</Text>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{text}</Text>
      </View>
    </View>
  );
}
