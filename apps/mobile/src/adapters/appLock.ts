import { Linking, NativeModules } from 'react-native';

export type AuthResult = 'success' | 'cancelled' | 'lockout' | 'unavailable' | 'error';
export interface AuthOutcome {
  readonly result: AuthResult;
  /** The system's own message for a lockout or error; shown as it is. */
  readonly message: string;
}
export type LockKind = 'biometric' | 'credential' | 'none';

interface AppLockNative {
  isDeviceSecure(): Promise<boolean>;
  availableKind(): Promise<LockKind>;
  authenticate(title: string): Promise<AuthOutcome>;
  elapsedRealtime(): Promise<number>;
  openSecuritySettings(): Promise<void>;
}

const native = (): AppLockNative | undefined => NativeModules.WmbugoAppLock as AppLockNative | undefined;

/** The system prompt (BiometricPrompt): a strong biometric or the device credential. Never throws. */
export async function authenticate(title: string): Promise<AuthOutcome> {
  try {
    return (await native()?.authenticate(title)) ?? { result: 'unavailable', message: '' };
  } catch {
    return { result: 'error', message: '' };
  }
}

/** Whether the phone has a secure screen lock. App lock cannot be turned on without one. */
export async function isDeviceSecure(): Promise<boolean> {
  try {
    return (await native()?.isDeviceSecure()) ?? false;
  } catch {
    return false;
  }
}

export async function availableKind(): Promise<LockKind> {
  try {
    return (await native()?.availableKind()) ?? 'none';
  } catch {
    return 'none';
  }
}

/** Milliseconds on the monotonic elapsed-realtime clock: changing the phone's clock cannot move it. Null when unavailable. */
export async function elapsedRealtimeMs(): Promise<number | null> {
  try {
    const n = await native()?.elapsedRealtime();
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

export async function openSecuritySettings(): Promise<void> {
  try {
    if (native()) await native()!.openSecuritySettings();
    else await Linking.openSettings();
  } catch {
    /* nothing more to do */
  }
}
