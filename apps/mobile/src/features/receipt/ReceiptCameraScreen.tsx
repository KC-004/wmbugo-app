import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Image, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { CameraSurface, CameraSurfaceHandle } from '../../adapters/camera/cameraSurface';
import { permissionState, requestPermission } from '../../adapters/permissions';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { ScreenFrame } from '../../shared/ui/ScreenFrame';

type Access = 'checking' | 'granted' | 'denied';

export const SHUTTER_SIZE = 72;

/**
 * The receipt camera (Story 10.7): a full-screen preview with a 72dp shutter, `Choose a photo`, a `Light` toggle and `Close`. The camera
 * permission is asked here, the first time it opens (never earlier); when it is off the screen offers `Pick a photo instead` and `Enter it by hand`.
 * A photo is only a temporary file until `Use photo` hands it to the intake; nothing is written to the gallery.
 */
export function ReceiptCameraScreen({
  Surface,
  openSettings = () => void Linking.openSettings(),
  discardTemp,
  onUse,
  onPickPhoto,
  onByHand,
  onClose,
}: {
  Surface: CameraSurface;
  openSettings?: () => void;
  /** Deletes a temporary photo file (a retake, or leaving without using it). */
  discardTemp: (path: string) => Promise<void> | void;
  /** `path` is the temporary file; the receiver deletes it after intake. */
  onUse: (path: string) => void;
  onPickPhoto: () => void;
  onByHand: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [access, setAccess] = useState<Access>('checking');
  const [torch, setTorch] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState(false);
  const surface = useRef<CameraSurfaceHandle>(null);
  const busy = useRef(false);
  const pending = useRef<string | null>(null);
  const live = useRef(true);

  // The first time the camera opens, the system prompt is asked here and nowhere else. Coming back from Android settings reads it again.
  useEffect(() => {
    live.current = true;
    const read = async (ask: boolean) => {
      let state = await permissionState('camera');
      if (ask && state === 'undetermined') {
        state = await requestPermission('camera');
      }
      if (live.current) setAccess(state === 'granted' ? 'granted' : 'denied');
    };
    void read(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void read(false);
    });
    return () => {
      live.current = false;
      sub.remove();
    };
  }, []);

  // A photo that was never used is deleted when the screen goes away.
  useEffect(
    () => () => {
      const p = pending.current;
      pending.current = null;
      if (p) void Promise.resolve(discardTemp(p)).catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const take = useCallback(async () => {
    if (busy.current || !surface.current) return;
    busy.current = true;
    setFailed(false);
    try {
      const path = await surface.current.capture();
      // The screen went away while the camera was working: the photo is not kept.
      if (!live.current) return void Promise.resolve(discardTemp(path)).catch(() => undefined);
      pending.current = path;
      // The live camera closes now: the light goes off first, so no torch change is left pending on it.
      setTorch(false);
      setShot(path);
    } catch {
      if (live.current) setFailed(true);
    } finally {
      busy.current = false;
    }
  }, [discardTemp]);

  const retake = () => {
    const p = pending.current;
    pending.current = null;
    setShot(null);
    if (p) void Promise.resolve(discardTemp(p)).catch(() => undefined);
  };

  const use = () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null; // the receiver owns the file now
    onUse(p);
  };

  const ink = theme.color('on-glass-primary');

  if (access === 'denied')
    return (
      <ScreenFrame testID="receipt-camera-denied">
        <View style={styles.denied}>
          <Text accessibilityRole="header" testID="camera-off" style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.receiptCamera.off}</Text>
          <Button label={copy.receiptCamera.pickInstead} testID="camera-pick-instead" onPress={onPickPhoto} />
          <Button label={copy.receiptCamera.byHand} variant="secondary" testID="camera-by-hand" onPress={onByHand} />
          <Button label={copy.receiptCamera.openSettings} variant="text" testID="camera-open-settings" onPress={openSettings} />
          <Button label={copy.receiptCamera.close} variant="text" testID="camera-close" onPress={onClose} />
        </View>
      </ScreenFrame>
    );

  return (
    <View testID="receipt-camera" style={[styles.fill, { backgroundColor: theme.color('bg-canvas') }]}>
      {access === 'granted' && shot === null ? <Surface ref={surface} torch={torch} active onError={() => setBroken(true)} /> : null}
      {shot !== null ? <Image testID="camera-preview" accessibilityLabel={copy.receiptCamera.preview} source={{ uri: `file://${shot}` }} style={styles.fill} resizeMode="contain" /> : null}

      <View style={styles.top}>
        <Pressable testID="camera-close" {...controlA11y({ label: copy.receiptCamera.close, role: 'button' })} onPress={onClose} style={styles.textButton}>
          <Text style={[textStyle('body-medium'), { color: ink }]}>{copy.receiptCamera.close}</Text>
        </Pressable>
        {shot === null ? (
          <View style={styles.light}>
            <Text style={[textStyle('body'), { color: ink }]}>{copy.receiptCamera.light}</Text>
            <Switch testID="camera-light" accessibilityLabel={copy.receiptCamera.light} value={torch} onValueChange={setTorch} />
          </View>
        ) : null}
      </View>

      {broken && shot === null && !failed ? <Text testID="camera-broken" accessibilityRole="alert" style={[textStyle('body'), styles.failed, { color: ink }]}>{copy.receiptCamera.broken}</Text> : null}
      {failed ? <Text testID="camera-failed" accessibilityRole="alert" style={[textStyle('body'), styles.failed, { color: ink }]}>{copy.receiptCamera.failed}</Text> : null}

      <View style={styles.bottom}>
        {shot === null ? (
          <>
            <Pressable testID="camera-choose" {...controlA11y({ label: copy.receiptCamera.choose, role: 'button' })} onPress={onPickPhoto} style={styles.textButton}>
              <Text style={[textStyle('body-medium'), { color: ink }]}>{copy.receiptCamera.choose}</Text>
            </Pressable>
            <Pressable testID="camera-shutter" {...controlA11y({ label: copy.receiptCamera.shutter, role: 'button' })} onPress={() => void take()} style={[styles.shutter, { backgroundColor: ink }]} />
            <View style={{ width: 96 }} />
          </>
        ) : (
          <>
            <Button label={copy.receiptCamera.retake} variant="secondary" testID="camera-retake" onPress={retake} />
            <Button label={copy.receiptCamera.usePhoto} testID="camera-use" onPress={use} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  denied: { padding: 16, gap: 12 },
  top: { position: 'absolute', top: 24, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  light: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottom: { position: 'absolute', bottom: 32, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  textButton: { minHeight: 48, minWidth: 96, justifyContent: 'center' },
  shutter: { width: SHUTTER_SIZE, height: SHUTTER_SIZE, borderRadius: SHUTTER_SIZE / 2, borderWidth: 4, borderColor: 'transparent' },
  failed: { position: 'absolute', bottom: 128, left: 16, right: 16, textAlign: 'center' },
});
