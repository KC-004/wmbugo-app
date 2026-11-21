import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { availableKind, type LockKind } from '../../adapters/appLock';
import { promptStateSeenStore } from '../home/homeApi';
import { copy } from '../../shared/copy';
import { useToast } from '../../shared/feedback/ToastHost';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { realSettingsApi, type SettingsApi } from '../settings/settingsApi';
import { registerAppLockOfferHost } from './appLockOfferBus';
import { enableAppLock } from './enableAppLock';

/** `prompt_state` key: `shown` is recorded the moment the sheet opens, so it never appears twice (Story 8.4). */
export const APP_LOCK_OFFER_KEY = 'app_lock_offer';
/** The wait after a save so the `Saved · Undo` toast is on screen first, and an immediate Undo can still cancel the offer. */
export const OFFER_DELAY_MS = 600;

export interface AppLockOfferApi {
  /** What the sheet should offer, or null when it must not appear (already shown, app lock already on, no screen lock). */
  eligibility(): Promise<Exclude<LockKind, 'none'> | null>;
  markShown(): Promise<void>;
  settings: Pick<SettingsApi, 'setAppLock' | 'changeSetting'>;
}

export const realAppLockOfferApi: AppLockOfferApi = {
  async eligibility() {
    if (await promptStateSeenStore.hasSeen(APP_LOCK_OFFER_KEY)) return null;
    const d = await realSettingsApi.load();
    if (!d || d.settings.appLockEnabled) return null;
    const kind = await availableKind();
    // No secure screen lock: nothing is recorded, and the offer is evaluated again after the next save.
    return kind === 'none' ? null : kind;
  },
  markShown: () => promptStateSeenStore.markSeen(APP_LOCK_OFFER_KEY),
  settings: realSettingsApi,
};

/**
 * The one-time offer to lock wmbugo, made right after the first saved entry (Story 8.4, ONB-008). A save calls
 * `scheduleAppLockOffer()` and an Undo before the sheet appears calls `cancelAppLockOffer()`. It never opens over another sheet
 * and never appears during onboarding (the host is mounted with the app shell only).
 */
export function AppLockOfferHost({ api = realAppLockOfferApi, delayMs = OFFER_DELAY_MS }: { api?: AppLockOfferApi; delayMs?: number }) {
  const sheet = useSheet();
  const toast = useToast();
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef(0);

  const cancel = useCallback(() => {
    token.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);
  const run = useCallback(
    async (mine: number) => {
      try {
        if (sheetRef.current.openId) return; // never over another sheet; evaluated again after the next save
        const kind = await api.eligibility();
        if (kind === null || mine !== token.current || sheetRef.current.openId) return;
        // Recorded immediately: Not now, Back, swipe down and process death all leave it recorded.
        await api.markShown();
        if (mine !== token.current) return;
        sheetRef.current.open({
          id: 'app-lock-offer',
          title: kind === 'biometric' ? copy.lock.offerFingerprint : copy.lock.offerScreenLock,
          body: (close) => (
            <OfferSheet
              onTurnOn={async () => {
                close();
                const r = await enableAppLock(api.settings);
                if (r.status === 'enabled') toast.show({ message: copy.lock.turnedOn });
                // Cancelled or failed: app lock stays off, and the offer is never repeated.
              }}
              onNotNow={close}
            />
          ),
        });
      } catch {
        /* the offer is a nicety: any failure leaves the save as it was */
      }
    },
    [api, toast],
  );

  const schedule = useCallback(() => {
    cancel();
    const mine = token.current;
    timer.current = setTimeout(() => void run(mine), delayMs);
  }, [cancel, run, delayMs]);

  useEffect(() => registerAppLockOfferHost({ schedule, cancel }), [schedule, cancel]);
  return null;
}

function OfferSheet({ onTurnOn, onNotNow }: { onTurnOn: () => void; onNotNow: () => void }) {
  const theme = useTheme();
  return (
    <View testID="app-lock-offer" style={styles.root}>
      <Text style={[textStyle('body'), { color: theme.color('on-glass-primary') }]}>{copy.lock.offerBody}</Text>
      <Button label={copy.lock.offerTurnOn} testID="app-lock-offer-yes" onPress={onTurnOn} />
      <Button label={copy.lock.offerNotNow} variant="text" onGlass testID="app-lock-offer-later" onPress={onNotNow} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12 } });
