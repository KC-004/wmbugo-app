import { createPendingIntentQueue, LOCK_AFTER_MS, shouldLock } from './appLock';
import { DEFAULT_SETTINGS, parseSettings, SETTING_APP_LOCK, SETTING_LOCK_AFTER, validateSetting } from './settings';

describe('shouldLock (Story 8.3)', () => {
  it('never locks with app lock off', () => {
    expect(shouldLock({ enabled: false, lockAfter: 'immediately', awayMs: null })).toBe(false);
    expect(shouldLock({ enabled: false, lockAfter: 'immediately', awayMs: 10 ** 9 })).toBe(false);
  });

  it('always locks on a cold start', () => {
    for (const lockAfter of ['immediately', '1m', '5m', '15m'] as const) expect(shouldLock({ enabled: true, lockAfter, awayMs: null })).toBe(true);
  });

  it('locks once the time away reaches Lock after, and not before', () => {
    expect(LOCK_AFTER_MS).toEqual({ immediately: 0, '1m': 60_000, '5m': 300_000, '15m': 900_000 });
    expect(shouldLock({ enabled: true, lockAfter: '1m', awayMs: 59_999 })).toBe(false);
    expect(shouldLock({ enabled: true, lockAfter: '1m', awayMs: 60_000 })).toBe(true);
    expect(shouldLock({ enabled: true, lockAfter: '15m', awayMs: 899_999 })).toBe(false);
    expect(shouldLock({ enabled: true, lockAfter: 'immediately', awayMs: 0 })).toBe(true);
  });

  it('a clock that went backwards or a bad value locks (the safe side)', () => {
    expect(shouldLock({ enabled: true, lockAfter: '15m', awayMs: -5 })).toBe(true);
    expect(shouldLock({ enabled: true, lockAfter: '15m', awayMs: Number.NaN })).toBe(true);
  });
});

describe('app lock settings', () => {
  it('app lock is off and Lock after is 1 minute by default; both validate', () => {
    expect(DEFAULT_SETTINGS.appLockEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.lockAfter).toBe('1m');
    expect(validateSetting(SETTING_APP_LOCK, true)).toEqual({ ok: true, value: true });
    expect(validateSetting(SETTING_LOCK_AFTER, '5m')).toEqual({ ok: true, value: '5m' });
    expect(validateSetting(SETTING_LOCK_AFTER, '2m')).toEqual({ ok: false });
    expect(parseSettings([[SETTING_LOCK_AFTER, '"15m"'], [SETTING_APP_LOCK, 'true']])).toMatchObject({ lockAfter: '15m', appLockEnabled: true });
  });
});

describe('pending intent queue', () => {
  it('opens at once when not locked', () => {
    const q = createPendingIntentQueue<string>();
    expect(q.offer('bills', false)).toBe(false);
    expect(q.size).toBe(0);
  });

  it('holds while locked and delivers once after unlock', () => {
    const q = createPendingIntentQueue<string>();
    expect(q.offer('bills', true)).toBe(true);
    expect(q.size).toBe(1);
    expect(q.release()).toBe('bills');
    expect(q.release()).toBeNull();
  });

  it('drops the intent when unlock is abandoned, and the latest tap wins', () => {
    const q = createPendingIntentQueue<string>();
    q.offer('a', true);
    q.offer('b', true);
    expect(q.release()).toBe('b');
    q.offer('c', true);
    q.drop();
    expect(q.release()).toBeNull();
  });
});
