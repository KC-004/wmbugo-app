import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
}
const realDeps: LockGateDeps = { authenticate, elapsedRealtimeMs, openSecuritySettings };

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
  const coldStartDone = useRef(false);

  // The first frame after the settings are known: a cold start with app lock on starts locked.
  if (!coldStartDone.current && q.data) {
    coldStartDone.current = true;
    useLockStore.getState().setEnabled(enabled);
    if (shouldLock({ enabled, lockAfter, awayMs: null })) useLockStore.getState().setLocked(true);
  }

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setMessage(null);
    setNeedsScreenLock(false);
    try {
      const out = await deps.authenticate(copy.lock.unlockPrompt);
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
    useLockStore.getState().setEnabled(enabled);
    void applyHideForAppLock(enabled);
    if (!enabled) setLocked(false);
  }, [enabled, setLocked]);

  const cover = locked && enabled;
  return (
    <View style={styles.fill}>
      <View style={styles.fill} importantForAccessibility={cover ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={cover}>
        {children}
      </View>
      {cover ? (
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
