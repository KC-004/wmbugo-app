import { forwardRef, useImperativeHandle } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import type { CameraSurface } from '../../adapters/camera/cameraSurface';
import { AddButton } from '../shell/AddButton';
import { cleanup, fire, has, host, quietAccessibility, settle, texts } from '../add/testKit';
import { ReceiptCameraScreen, SHUTTER_SIZE } from './ReceiptCameraScreen';

jest.mock('../../adapters/permissions', () => ({ permissionState: jest.fn(), requestPermission: jest.fn() }));

const perms = jest.requireMock('../../adapters/permissions') as { permissionState: jest.Mock; requestPermission: jest.Mock };

afterEach(cleanup);
beforeEach(() => {
  quietAccessibility();
  perms.permissionState.mockReset();
  perms.requestPermission.mockReset();
});

let capture: jest.Mock;
let lastProps: { torch: boolean; active: boolean } | null;
const FakeSurface = forwardRef<{ capture(): Promise<string> }, { torch: boolean; active: boolean }>(function FakeSurface(props, ref) {
  lastProps = props;
  useImperativeHandle(ref, () => ({ capture: () => capture() }));
  return null;
}) as unknown as CameraSurface;

function mount() {
  const cb = { discardTemp: jest.fn(async () => undefined), onUse: jest.fn(), onPickPhoto: jest.fn(), onByHand: jest.fn(), onClose: jest.fn(), openSettings: jest.fn() };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider>
        <ReceiptCameraScreen Surface={FakeSurface} {...cb} />
      </ThemeProvider>,
    );
  });
  return { r, ...cb };
}

beforeEach(() => {
  capture = jest.fn(async () => '/cache/shot.jpg');
  lastProps = null;
});

describe('the receipt camera (Story 10.7)', () => {
  it('asks for the camera permission the first time it opens, then shows the controls', async () => {
    perms.permissionState.mockResolvedValue('undetermined');
    perms.requestPermission.mockResolvedValue('granted');
    const { r } = mount();
    await settle();
    expect(perms.requestPermission).toHaveBeenCalledWith('camera');
    expect(has(r, 'camera-shutter')).toBe(true);
    expect(host(r, 'camera-shutter').props.accessibilityLabel).toBe('Take photo');
    expect(StyleSheet.flatten(host(r, 'camera-shutter').props.style).width).toBe(SHUTTER_SIZE);
    expect(SHUTTER_SIZE).toBe(72);
    expect(texts(r)).toEqual(expect.arrayContaining(['Choose a photo', 'Light', 'Close']));
  });

  it('does not ask again when it was granted already', async () => {
    perms.permissionState.mockResolvedValue('granted');
    mount();
    await settle();
    expect(perms.requestPermission).not.toHaveBeenCalled();
  });

  it('takes a photo, shows Use photo and Retake, deletes a retaken file and hands a used one on', async () => {
    perms.permissionState.mockResolvedValue('granted');
    const { r, discardTemp, onUse } = mount();
    await settle();
    await act(async () => fire(r, 'camera-shutter'));
    await settle();
    expect(has(r, 'camera-preview')).toBe(true);
    act(() => fire(r, 'camera-retake'));
    await settle();
    expect(discardTemp).toHaveBeenCalledWith('/cache/shot.jpg');
    await act(async () => fire(r, 'camera-shutter'));
    await settle();
    act(() => fire(r, 'camera-use'));
    expect(onUse).toHaveBeenCalledWith('/cache/shot.jpg');
    act(() => r.unmount());
    expect(discardTemp).toHaveBeenCalledTimes(1); // the used file now belongs to the receiver
  });

  it('deletes a photo that was taken but never used when the screen goes away', async () => {
    perms.permissionState.mockResolvedValue('granted');
    const { r, discardTemp } = mount();
    await settle();
    await act(async () => fire(r, 'camera-shutter'));
    await settle();
    act(() => r.unmount());
    expect(discardTemp).toHaveBeenCalledWith('/cache/shot.jpg');
  });

  it('deletes a photo that arrives after the screen has gone away', async () => {
    perms.permissionState.mockResolvedValue('granted');
    let resolve!: (p: string) => void;
    capture.mockImplementationOnce(() => new Promise<string>((r) => (resolve = r)));
    const { r, discardTemp } = mount();
    await settle();
    act(() => void fire(r, 'camera-shutter'));
    act(() => r.unmount());
    await act(async () => resolve('/cache/late.jpg'));
    expect(discardTemp).toHaveBeenCalledWith('/cache/late.jpg');
  });

  it('the Light toggle switches the torch, and a failed capture says nothing was saved', async () => {
    perms.permissionState.mockResolvedValue('granted');
    const { r } = mount();
    await settle();
    act(() => fire(r, 'camera-light', 'onValueChange', true));
    expect(lastProps).toMatchObject({ torch: true });
    capture.mockRejectedValueOnce(new Error('camera error'));
    await act(async () => fire(r, 'camera-shutter'));
    await settle();
    expect(texts(r)).toContain('The camera could not take the photo. Nothing was saved.');
  });

  it('Choose a photo and Close leave without writing anything', async () => {
    perms.permissionState.mockResolvedValue('granted');
    const { r, onPickPhoto, onClose } = mount();
    await settle();
    act(() => fire(r, 'camera-choose'));
    act(() => fire(r, 'camera-close'));
    expect(onPickPhoto).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('when the camera is off it says so with Pick a photo instead, Enter it by hand and Open settings, and never asks again', async () => {
    perms.permissionState.mockResolvedValue('denied');
    const { r, onPickPhoto, onByHand, openSettings } = mount();
    await settle();
    expect(texts(r)).toContain('Camera is off for wmbugo');
    expect(perms.requestPermission).not.toHaveBeenCalled();
    act(() => fire(r, 'camera-pick-instead'));
    act(() => fire(r, 'camera-by-hand'));
    act(() => fire(r, 'camera-open-settings'));
    expect(onPickPhoto).toHaveBeenCalled();
    expect(onByHand).toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalled();
  });

  it('shows the denied state when permission is revoked in Android settings while in the background, without a restart', async () => {
    perms.permissionState.mockResolvedValue('granted');
    let onChange: (s: string) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, fn: (s: string) => void) => {
      onChange = fn;
      return { remove: () => undefined };
    }) as never);
    const { r } = mount();
    await settle();
    expect(has(r, 'camera-shutter')).toBe(true);
    perms.permissionState.mockResolvedValue('denied');
    await act(async () => onChange('active'));
    await settle();
    expect(texts(r)).toContain('Camera is off for wmbugo');
    expect(perms.requestPermission).not.toHaveBeenCalled();
  });
});

describe('the ＋ button (Story 10.7)', () => {
  const mountAdd = (onSnap?: () => void) => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider>
          <AddButton onPress={jest.fn()} {...(onSnap ? { onSnap } : {})} />
        </ThemeProvider>,
      );
    });
    return r;
  };

  it('long-press and the TalkBack action Snap receipt open the camera', () => {
    const onSnap = jest.fn();
    const r = mountAdd(onSnap);
    const b = host(r, 'add-button');
    expect(b.props.accessibilityLabel).toBe('Add entry');
    expect(b.props.accessibilityActions).toEqual([{ name: 'snapReceipt', label: 'Snap receipt' }]);
    act(() => fire(r, 'add-button', 'onLongPress'));
    act(() => fire(r, 'add-button', 'onAccessibilityAction', { nativeEvent: { actionName: 'snapReceipt' } }));
    expect(onSnap).toHaveBeenCalledTimes(2);
  });

  it('has neither without a handler', () => {
    const b = host(mountAdd(), 'add-button');
    expect(b.props.accessibilityActions).toBeUndefined();
  });
});
