import {
  HIDDEN_NOTIFICATION_PRIVACY,
  hiddenCaptureNotification,
  unavailableNotifier,
  withNotificationPrivacy,
  type HandlerMap,
  type Notifier,
  type NotificationPrivacySettings,
} from '@wmbugo/core';

type PrivacyReader = () => Promise<NotificationPrivacySettings>;

/** Until the app has started and read the saved settings, and whenever they cannot be read, nothing is shown (fail closed). */
let reader: PrivacyReader = async () => HIDDEN_NOTIFICATION_PRIVACY;

/** The privacy settings from a saved profile; no profile (or none readable) is the most private form. */
export function privacyFromSettings(
  s: { notificationDetail: NotificationPrivacySettings['notificationDetail']; fullNotificationsOptIn: boolean; appLockEnabled: boolean; hideAmounts: boolean } | null | undefined,
): NotificationPrivacySettings {
  if (!s) return HIDDEN_NOTIFICATION_PRIVACY;
  return { notificationDetail: s.notificationDetail, fullNotificationsOptIn: s.fullNotificationsOptIn, appLockEnabled: s.appLockEnabled, hideAmounts: s.hideAmounts };
}

/** The composition root says where the privacy settings are read from (the profile). Kept here so this file never imports the app services. */
export function setNotificationPrivacyReader(read: PrivacyReader): void {
  reader = read;
}

/**
 * The notification adapter the app uses. The react-native-notify-kit adapter replaces `unavailableNotifier` here when the
 * library is added; until then no screen asks for a notification permission it could not use, and no alert is posted. The
 * alert logic itself (what crosses, what is recorded, what is muted) runs regardless. Every notification passes through the
 * privacy form (Story 8.5): what it may say follows app lock, hide amounts and notification detail (AD-13).
 */
export const appNotifier = withNotificationPrivacy(unavailableNotifier as Notifier, () => reader());

/** After a settings change, notifications already posted are re-posted in the new form (Story 8.5). Reminders are re-scheduled by their own sync. */
export function withNotificationRepost(handlers: HandlerMap): HandlerMap {
  return {
    ...handlers,
    ProfileChanged: [...(handlers.ProfileChanged ?? []), () => appNotifier.repostAll().catch(() => undefined)],
  };
}

/**
 * Debug-only fixture: posts the hidden capture notification (`New payment to check`) so its form can be checked on a device
 * before any capture source exists. Triggered by a file in the private directory, so only a debuggable build can start it.
 */
export async function postCaptureFixture(): Promise<void> {
  await appNotifier.post(hiddenCaptureNotification('debug-capture-fixture'));
}
