import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { shouldLock } from '@wmbugo/core';
import { applyHideForAppLock } from '../../adapters/recentsPrivacy';
import { authenticate, elapsedRealtimeMs, openSecuritySettings, type AuthOutcome } from '../../adapters/appLock';
import { CoinMark } from '../../shared/brand/CoinMark';
import { copy } from '../../shared/copy';
import { pendingIntents, releasePendingIntent } from '../../shared/appIntents';
import { useLockStore } from '../../shared/state/lockStore';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { realSettingsApi, SETTINGS_QUERY_KEY, type SettingsApi } from '../settings/settingsApi';

export interface LockGateDeps {
  readonly authenticate: (title: string) => Promise<AuthOutcome>;
  readonly elapsedRealtimeMs: () => Promise<number | null>;
  readonly openSecuritySettings: () => Promise<void>;
  /** How long to wait for a prompt the system never answers. Tests shorten it. */
  readonly promptTimeoutMs?: number;
}
const realDeps: LockGateDeps = { authenticate, elapsedRealtimeMs, openSecuritySettings };

/** A prompt the native side never answers (the activity was recreated while it showed) must not leave Unlock dead. */
const PROMPT_TIMEOUT_MS = 60_000;

/**
 * LockGate (Story 8.3, SEC-004, FLOW-12). With app lock on it covers the whole app on a cold start, and when the app comes
 * back after longer than `Lock after` (time measured on the monotonic clock). The app tree stays mounted underneath, hidden
 * from accessibility, so unlocking returns to exactly the screen, scroll position and open sheet draft the person left. It
 * starts the system prompt by itself; dismissing it leaves the person here with an Unlock button.
 */
export function LockGate({ children, api = realSettingsApi, deps = realDeps }: { children: ReactNode; api?: SettingsApi; deps?: LockGateDeps }) {
  const theme = useTheme();
  // Same read as the settings bridge; it never retries on mount, so a failing read cannot loop two observers.
  const q = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => api.load(), retryOnMount: false });
  const enabled = q.data?.settings.appLockEnabled ?? false;
  const lockAfter = q.data?.settings.lockAfter ?? '1m';
  const locked = useLockStore((s) => s.locked);
  const setLocked = useLockStore((s) => s.setLocked);
  const [message, setMessage] = useState<string | null>(null);
  const [needsScreenLock, setNeedsScreenLock] = useState(false);
  const leftAt = useRef<number | null | undefined>(undefined);
  const prompting = useRef(false);
  // The cold-start decision has been taken. Until then the app is covered: the lock setting is not known, and showing amounts for
  // the moment it takes to read it would defeat the lock. A failed read keeps the cover (fail closed) with a way to try again.
  const [decided, setDecided] = useState(false);
  const readFailed = !decided && q.isError && !q.data;

  // The first frame after the settings are known: a cold start with app lock on starts locked.
  useLayoutEffect(() => {
    if (decided || !q.data) return;
    useLockStore.getState().setEnabled(enabled);
    if (shouldLock({ enabled, lockAfter, awayMs: null })) useLockStore.getState().setLocked(true);
    setDecided(true);
  }, [decided, q.data, enabled, lockAfter]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setMessage(null);
    setNeedsScreenLock(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const out = await Promise.race([
        deps.authenticate(copy.lock.unlockPrompt),
        new Promise<AuthOutcome>((resolve) => {
          timer = setTimeout(() => resolve({ result: 'error', message: '' }), deps.promptTimeoutMs ?? PROMPT_TIMEOUT_MS);
        }),
      ]);
      if (out.result === 'success') {
        setLocked(false);
        releasePendingIntent();
      } else if (out.result === 'lockout' || out.result === 'error') {
        setMessage(out.message || copy.lock.lockoutFallback);
      } else if (out.result === 'unavailable') {
        setNeedsScreenLock(true);
        setMessage(copy.lock.unavailable);
      }
      // 'cancelled': the person stays on LockGate with Unlock.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      prompting.current = false;
    }
  }, [deps, setLocked]);

  // Locked and in front: start the prompt.
  useEffect(() => {
    if (locked && enabled) void unlock();
  }, [locked, enabled, unlock]);

  // Back after a while: lock. Time away comes from the monotonic clock, so changing the phone's clock cannot skip the lock.
  useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        leftAt.current = undefined;
        void deps.elapsedRealtimeMs().then((t) => {
          if (leftAt.current === undefined) leftAt.current = t;
        });
        // An unlock abandoned by leaving the app drops anything held: nothing opens without the person unlocking.
        if (useLockStore.getState().locked) pendingIntents.drop();
      } else if (state === 'active') {
        const started = leftAt.current;
        void deps.elapsedRealtimeMs().then((now) => {
          const away = started === undefined || started === null || now === null ? null : now - started;
          // A missing reading locks (the safe side): the clock cannot be trusted to have let the time pass.
          if (shouldLock({ enabled, lockAfter, awayMs: away })) useLockStore.getState().setLocked(true);
          leftAt.current = undefined;
        });
      }
    });
    return () => sub.remove();
  }, [enabled, lockAfter, deps]);

  // Turning app lock off or on while the app is open: nothing locks until the next trigger.
  useEffect(() => {
    // Only once the setting is known: before that `enabled` is a default, and applying it would clear the native hiding that app
    // lock keeps for a cold start.
    if (!decided) return;
    useLockStore.getState().setEnabled(enabled);
    void applyHideForAppLock(enabled);
    if (!enabled) setLocked(false);
  }, [decided, enabled, setLocked]);

  // No screen lock left on the phone: app lock cannot ask anything, so the person is offered to turn it off.
  const turnOff = async () => {
    const r = await api.setAppLock(false);
    if (r.ok) {
      await q.refetch();
      setLocked(false);
    }
  };

  const cover = !decided || (locked && enabled);
  return (
    <View style={styles.fill}>
      <View style={styles.fill} importantForAccessibility={cover ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={cover}>
        {children}
      </View>
      {cover && !decided ? (
        <View testID="lock-gate-pending" accessibilityViewIsModal style={[styles.cover, { backgroundColor: theme.color('bg-canvas') }]}>
          <CoinMark size={72} />
          {readFailed ? (
            <>
              <Text testID="lock-settings-failed" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[textStyle('body'), styles.message, { color: theme.color('text-secondary') }]}>
                {copy.lock.settingsFailed}
              </Text>
              <Button label={copy.lock.retry} testID="lock-retry" onPress={() => void q.refetch()} />
            </>
          ) : null}
        </View>
      ) : null}
      {cover && decided ? (
        <View testID="lock-gate" accessibilityViewIsModal style={[styles.cover, { backgroundColor: theme.color('bg-canvas') }]}>
          <CoinMark size={72} />
          <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('text-primary') }]}>
            {copy.lock.locked}
          </Text>
          {message ? (
            <Text testID="lock-message" accessibilityLiveRegion="polite" style={[textStyle('body'), styles.message, { color: theme.color('text-secondary') }]}>
              {message}
            </Text>
          ) : null}
          <Button label={message && !needsScreenLock ? copy.lock.tryAgain : copy.lock.unlock} testID="lock-unlock" onPress={() => void unlock()} />
          {needsScreenLock ? <Button label={copy.lock.openSettings} variant="secondary" testID="lock-open-settings" onPress={() => void deps.openSecuritySettings()} /> : null}
          {needsScreenLock ? (
            <>
              <Text testID="lock-no-screen-lock" style={[textStyle('body'), styles.message, { color: theme.color('text-secondary') }]}>
                {copy.lock.noScreenLock}
              </Text>
              <Button label={copy.lock.turnOff} variant="secondary" testID="lock-turn-off" onPress={() => void turnOff()} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  message: { textAlign: 'center' },
});
