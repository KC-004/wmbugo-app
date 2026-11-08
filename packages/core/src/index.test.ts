import { CORE_PACKAGE } from './index';

describe('core smoke test', () => {
  it('exposes its package name', () => {
    expect(CORE_PACKAGE).toBe('@wmbugo/core');
  });
});
