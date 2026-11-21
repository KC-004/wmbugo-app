import { NativeModules, Platform } from 'react-native';

interface PrivacyNative {
  setHideInRecents(hidden: boolean): Promise<void>;
  setHideForAppLock(on: boolean): Promise<void>;
}

const native = (): PrivacyNative | undefined => NativeModules.WmbugoPrivacy as PrivacyNative | undefined;

/**
 * Hides wmbugo in the app switcher (Story 8.2): Android 13+ turns the recents snapshot off, Android 8 to 12 marks the
 * window secure. The native side keeps the choice, so a cold start applies it before any JavaScript runs.
 */
export async function applyHideInRecents(hidden: boolean): Promise<void> {
  try {
    await native()?.setHideInRecents(hidden);
  } catch {
    /* the setting is saved either way; the next start applies it */
  }
}

/** Story 8.3: app lock enforces the hiding whatever the setting says. */
export async function applyHideForAppLock(on: boolean): Promise<void> {
  try {
    await native()?.setHideForAppLock(on);
  } catch {
    /* enforced again on the next start */
  }
}

/** On Android 8 to 12 the hiding also blocks screenshots, and the screen says so. 13 and later do not. */
export function hidingBlocksScreenshots(): boolean {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 33;
}
