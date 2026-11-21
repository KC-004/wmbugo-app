import { budgetAlertContent } from '@wmbugo/core';
import { HIDDEN_NOTIFICATION_PRIVACY } from '@wmbugo/core';
import { appNotifier, postCaptureFixture, privacyFromSettings, setNotificationPrivacyReader, withNotificationRepost } from './notifier';

describe('app notifier privacy wiring (Story 8.5)', () => {
  const base = { notificationDetail: 'full' as const, fullNotificationsOptIn: false, appLockEnabled: false, hideAmounts: false };

  it('is not available until the notification library is installed, and posting is a no-op', async () => {
    expect(appNotifier.available).toBe(false);
    setNotificationPrivacyReader(async () => base);
    await expect(appNotifier.post(budgetAlertContent({ budgetId: 'b', periodStart: '2026-11-01', name: 'Food', thresholdPct: 90 }))).resolves.toBeUndefined();
    await expect(postCaptureFixture()).resolves.toBeUndefined();
  });

  it('maps saved settings to the privacy settings, and a missing profile is the most private form', () => {
    expect(privacyFromSettings({ notificationDetail: 'full', fullNotificationsOptIn: true, appLockEnabled: false, hideAmounts: true, ...{ other: 1 } })).toEqual({
      notificationDetail: 'full',
      fullNotificationsOptIn: true,
      appLockEnabled: false,
      hideAmounts: true,
    });
    expect(privacyFromSettings(null)).toEqual(HIDDEN_NOTIFICATION_PRIVACY);
    expect(privacyFromSettings(undefined)).toEqual(HIDDEN_NOTIFICATION_PRIVACY);
  });

  it('adds a ProfileChanged handler that re-posts what was posted, and keeps the existing handlers', async () => {
    const existing = jest.fn();
    const handlers = withNotificationRepost({ ProfileChanged: [existing], TransactionsChanged: [existing] });
    expect(handlers.TransactionsChanged).toEqual([existing]);
    expect(handlers.ProfileChanged).toHaveLength(2);
    const repost = jest.spyOn(appNotifier, 'repostAll').mockResolvedValue(undefined);
    await handlers.ProfileChanged![1]!({ name: 'ProfileChanged', payload: { fields: [] } } as never);
    expect(repost).toHaveBeenCalledTimes(1);
    repost.mockRestore();
  });

  it('a failing re-post never breaks the handler', async () => {
    const handlers = withNotificationRepost({});
    jest.spyOn(appNotifier, 'repostAll').mockRejectedValue(new Error('x'));
    await expect(handlers.ProfileChanged![0]!({ name: 'ProfileChanged', payload: { fields: [] } } as never)).resolves.toBeUndefined();
  });
});
