jest.mock('../adapters/appLock', () => ({ authenticate: jest.fn() }));

import { authenticate } from '../adapters/appLock';
import { requireReauth } from './reauth';
import { useLockStore } from './state/lockStore';

describe('requireReauth (Story 8.3)', () => {
  beforeEach(() => {
    (authenticate as jest.Mock).mockReset();
    useLockStore.setState({ enabled: false, locked: false });
  });

  it('is a no-op with app lock off', async () => {
    expect(await requireReauth()).toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('asks Confirm it is you with app lock on: success lets the action through, cancel, lockout and error do not', async () => {
    useLockStore.setState({ enabled: true });
    (authenticate as jest.Mock).mockResolvedValueOnce({ result: 'success', message: '' });
    expect(await requireReauth()).toBe(true);
    expect(authenticate).toHaveBeenCalledWith("Confirm it's you");
    for (const result of ['cancelled', 'lockout', 'error']) {
      (authenticate as jest.Mock).mockResolvedValueOnce({ result, message: '' });
      expect(await requireReauth()).toBe(false);
    }
  });

  it('with no screen lock left on the phone there is nothing to ask, so the action goes through (the person is not stuck)', async () => {
    useLockStore.setState({ enabled: true });
    (authenticate as jest.Mock).mockResolvedValueOnce({ result: 'unavailable', message: '' });
    expect(await requireReauth()).toBe(true);
  });
});
