import type { NotificationContent, Notifier } from '../ports/notifier';

/**
 * Notification privacy (Story 8.5, SEC-005, AD-13): what a notification may say. The decision is a pure function of the
 * profile settings, used by the Notifier port for every notification, so no feature chooses its own privacy form.
 */
export type NotificationKind = 'capture' | 'budget' | 'bill';
export type NotificationDetail = 'full' | 'hidden';
export type ShadeForm = 'full' | 'hidden' | 'public';
export type NotificationAction = 'approve' | 'reject' | 'review';

export interface NotificationPrivacySettings {
  readonly notificationDetail: NotificationDetail;
  readonly fullNotificationsOptIn: boolean;
  readonly appLockEnabled: boolean;
  readonly hideAmounts: boolean;
}

export interface NotificationForm {
  /** What the notification shade shows. `hidden` is the capture form, `public` the budget form; `full` shows the details. */
  readonly shade: ShadeForm;
  /** What the lock screen shows. */
  readonly lockScreen: ShadeForm;
  /** The actions on the shade form: Approve and Reject only on a `full` capture form, otherwise only `Review`. */
  readonly actions: readonly NotificationAction[];
}

/**
 * What is assumed when the settings cannot be read: everything withheld. A failure to read must never show more than a person who
 * chose the most private options would have allowed.
 */
export const HIDDEN_NOTIFICATION_PRIVACY: NotificationPrivacySettings = {
  notificationDetail: 'hidden',
  fullNotificationsOptIn: false,
  appLockEnabled: true,
  hideAmounts: true,
};

/** The wording of the hidden capture notification: no amount, merchant, account or category text. */
export const CAPTURE_HIDDEN_TITLE = 'New payment to check';
export const NOTIFICATION_STRINGS = {
  captureHiddenTitle: CAPTURE_HIDDEN_TITLE,
  captureReview: 'Review',
  captureApprove: 'Approve',
  captureReject: 'Reject',
} as const;

/**
 * The form of one notification. A capture is `hidden` in the shade when notification detail is hidden, or when app lock or hide
 * amounts is on and the person has not opted in to full details; on the lock screen it is always `hidden` unless the lock-screen
 * approve flag is true (default false; its setting arrives with CAP-006 in Epic 11). Budget notifications use the public wording on
 * the lock screen always, and in the shade under the same rule as captures: detail hidden, or app lock or hide amounts on without
 * the opt-in. Bill reminders carry no money, so the shade keeps `Rent is due tomorrow` unless notification detail is hidden; the
 * lock screen shows the public version.
 */
export function decideNotificationForm(kind: NotificationKind, settings: NotificationPrivacySettings, lockScreenApprove = false): NotificationForm {
  const guarded = settings.appLockEnabled || settings.hideAmounts;
  const detailHidden = settings.notificationDetail === 'hidden';
  const withheld = detailHidden || (guarded && !settings.fullNotificationsOptIn);
  if (kind === 'capture') {
    const shade: ShadeForm = withheld ? 'hidden' : 'full';
    const lockScreen: ShadeForm = lockScreenApprove && shade === 'full' ? 'full' : 'hidden';
    return { shade, lockScreen, actions: shade === 'full' ? ['approve', 'reject'] : ['review'] };
  }
  if (kind === 'budget') return { shade: withheld ? 'public' : 'full', lockScreen: 'public', actions: [] };
  return { shade: detailHidden ? 'public' : 'full', lockScreen: 'public', actions: [] };
}

/** The effective shade form for captures: what the Privacy summary and the notification detail screen show. */
export function effectiveCaptureForm(settings: NotificationPrivacySettings): 'full' | 'hidden' {
  return decideNotificationForm('capture', settings).shade === 'hidden' ? 'hidden' : 'full';
}

/**
 * The home-screen widget (Epic 12 and later) asks here whether it may show amounts: never while app lock or hide amounts is on.
 */
export function widgetMayShowAmounts(settings: Pick<NotificationPrivacySettings, 'appLockEnabled' | 'hideAmounts'>): boolean {
  return !(settings.appLockEnabled || settings.hideAmounts);
}

/** The hidden capture notification: title only, no amount, and `Review` as its only action. */
export function hiddenCaptureNotification(id: string): NotificationContent {
  return {
    id,
    channel: 'capture_review',
    title: CAPTURE_HIDDEN_TITLE,
    body: '',
    publicTitle: CAPTURE_HIDDEN_TITLE,
    publicBody: '',
    badge: false,
    data: { screen: 'ReviewQueue' },
    actions: ['review'],
  };
}

/**
 * Applies a form to a budget or bill notification: a `public` shade swaps the title and body for the public wording, so the
 * percentage never shows while app lock or hide amounts is on. Pure.
 */
export function withShadeForm(content: NotificationContent, shade: ShadeForm): NotificationContent {
  if (shade !== 'public' && shade !== 'hidden') return content;
  return { ...content, title: content.publicTitle, body: content.publicBody };
}

/**
 * A Notifier that applies the privacy form to every notification the features post or schedule, reading the current settings
 * each time. Posted notifications are remembered so `repostAll` can re-post them in a new form after a settings change.
 */
/** How many posted notifications are remembered for `repostAll`: the shade holds few, and the oldest are dropped first. */
const MAX_REMEMBERED = 50;

export function withNotificationPrivacy(inner: Notifier, read: () => Promise<NotificationPrivacySettings>): Notifier & { repostAll(): Promise<void>; forget(id: string): void } {
  const posted = new Map<string, NotificationContent>();
  const kindOf = (c: NotificationContent): NotificationKind => (c.channel === 'budget_alerts' ? 'budget' : c.channel === 'bill_reminders' ? 'bill' : 'capture');
  // A settings read that fails withholds everything: the failure must not be the way details reach the lock screen.
  const settings = () => read().catch(() => HIDDEN_NOTIFICATION_PRIVACY);
  const apply = async (c: NotificationContent): Promise<NotificationContent> => {
    const kind = kindOf(c);
    const form = decideNotificationForm(kind, await settings());
    if (kind === 'capture') {
      // A capture built in its full form is replaced by the hidden one when the settings say so; the hidden one offers only Review.
      return form.shade === 'hidden' && c.title !== CAPTURE_HIDDEN_TITLE ? hiddenCaptureNotification(c.id) : c;
    }
    return withShadeForm(c, form.shade);
  };
  return {
    get available() {
      return inner.available;
    },
    permission: () => inner.permission(),
    requestPermission: () => inner.requestPermission(),
    async post(content) {
      posted.delete(content.id);
      posted.set(content.id, content);
      while (posted.size > MAX_REMEMBERED) posted.delete(posted.keys().next().value as string);
      await inner.post(await apply(content));
    },
    /** The person dismissed or opened it, or it was resolved: it is not posted again after a settings change. */
    forget(id) {
      posted.delete(id);
    },
    async replaceScheduled(channel, items) {
      const shaped = await Promise.all(items.map(async (i) => ({ ...i, content: await apply(i.content) })));
      await inner.replaceScheduled(channel, shaped);
    },
    onOpen: (l) => inner.onOpen(l),
    cancelAll: async () => {
      posted.clear();
      await inner.cancelAll?.();
    },
    async repostAll() {
      for (const content of [...posted.values()]) await inner.post(await apply(content));
    },
  };
}
