/**
 * What a notification says. It never carries an amount (Story 4.9): the title and body name the budget and a level, and the
 * lock-screen version is generic. `data` is what a tap needs to open the right screen.
 */
export interface NotificationContent {
  /** A stable id, so posting the same notification twice replaces it instead of adding another. */
  readonly id: string;
  readonly channel: 'budget_alerts' | 'bill_reminders' | 'capture_review';
  readonly title: string;
  readonly body: string;
  /** What the lock screen shows when the phone hides notification content. */
  readonly publicTitle: string;
  readonly publicBody: string;
  /** Always false: no numeric app badge. */
  readonly badge: false;
  readonly data: Readonly<Record<string, string>>;
}

/** A notification to be shown later, at a UTC instant (inexact: the system may delay it a little, no exact-alarm permission). */
export interface ScheduledNotification {
  readonly content: NotificationContent;
  readonly atMs: number;
}

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

/**
 * The notification port. The react-native-notify-kit adapter implements it; until that adapter is installed the app uses
 * `unavailableNotifier`, which says it is not available so nothing asks for a permission it could not use.
 */
export interface Notifier {
  /** Whether this build can post notifications at all. */
  readonly available: boolean;
  permission(): Promise<NotificationPermission>;
  /** Shows the system prompt. */
  requestPermission(): Promise<NotificationPermission>;
  /** Posts one notification; nothing is posted without permission. */
  post(content: NotificationContent): Promise<void>;
  /** Replaces everything scheduled on a channel with exactly these, so running it again with the same list changes nothing. */
  replaceScheduled(channel: NotificationContent['channel'], items: readonly ScheduledNotification[]): Promise<void>;
  /** Calls back with a notification's data when the user taps it. Returns the unsubscribe. */
  onOpen(listener: (data: Readonly<Record<string, string>>) => void): () => void;
}

export const unavailableNotifier: Notifier = {
  available: false,
  permission: async () => 'denied',
  requestPermission: async () => 'denied',
  post: async () => undefined,
  replaceScheduled: async () => undefined,
  onOpen: () => () => undefined,
};
