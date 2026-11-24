import { act } from 'react-test-renderer';
import type { AddPreset } from './AddSheet';
import { cleanup, fakeApi, fire, has, mount, quietAccessibility, settle, tap, texts, unmountNow } from './testKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

afterEach(cleanup);
beforeEach(quietAccessibility);

const PHOTO = { attachmentId: 'att1', digest: 'd1', sizeBytes: 10 };

function mountSnap(over: { onSnap?: () => void; preset?: AddPreset } = {}) {
  const f = fakeApi();
  const attachPending = jest.fn(async () => undefined);
  const discardPending = jest.fn(async () => undefined);
  const m = mount({ ...f.api, attachPending, discardPending }, jest.fn(), undefined, over.preset, undefined, over.onSnap);
  return { r: m.r, ...f, attachPending, discardPending };
}

describe('Snap receipt (Story 10.6)', () => {
  it('is a chip on the Expense form that leaves the sheet for the scan, and is absent on Income', async () => {
    const onSnap = jest.fn();
    const { r } = mountSnap({ onSnap });
    await settle();
    expect(texts(r)).toContain('Snap receipt');
    act(() => fire(r, 'snap-receipt'));
    expect(onSnap).toHaveBeenCalledTimes(1);
    act(() => fire(r, 'kind-income'));
    await settle();
    expect(has(r, 'snap-receipt')).toBe(false);
  });

  it('does not show without a handler', async () => {
    const { r } = mountSnap();
    await settle();
    expect(has(r, 'snap-receipt')).toBe(false);
  });

  it('attaches the photo held for Enter it by hand when the entry saves, and does not delete it', async () => {
    const { r, attachPending, discardPending } = mountSnap({ preset: { kind: 'expense', accountId: null, photo: PHOTO } });
    await settle();
    expect(texts(r)).toContain('Receipt photo attached');
    tap(r, '12');
    act(() => fire(r, 'category-cat_food'));
    await settle();
    await act(async () => fire(r, 'save'));
    await settle();
    expect(attachPending).toHaveBeenCalledWith('tx1', PHOTO);
    unmountNow(r);
    expect(discardPending).not.toHaveBeenCalled();
  });

  it('deletes the photo when the sheet is dismissed without saving', async () => {
    const { r, discardPending, attachPending } = mountSnap({ preset: { kind: 'expense', accountId: null, photo: PHOTO } });
    await settle();
    unmountNow(r);
    expect(discardPending).toHaveBeenCalledWith('att1');
    expect(attachPending).not.toHaveBeenCalled();
  });
});
