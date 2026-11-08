import { useEffect, useState } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { UNKNOWN_CAPABILITIES, type DeviceCapabilities } from './glassRules';

interface NativeCaps {
  apiLevel: number;
  totalRamMb: number;
  batterySaver: boolean;
  animatorScale: number;
}

/** Reads the facts the glass rule needs. Falls back to the JS-visible API level if the native module is absent. */
export async function readDeviceCapabilities(reduceTransparency = false): Promise<DeviceCapabilities> {
  const base: DeviceCapabilities = { ...UNKNOWN_CAPABILITIES, apiLevel: typeof Platform.Version === 'number' ? Platform.Version : 0, reduceTransparency };
  const native = NativeModules.WmbugoDeviceCapabilities as { getCapabilities(): Promise<NativeCaps> } | undefined;
  if (!native) return base;
  try {
    const c = await native.getCapabilities();
    return { ...base, apiLevel: c.apiLevel, totalRamMb: c.totalRamMb, batterySaver: c.batterySaver, animatorScale: c.animatorScale };
  } catch {
    return base;
  }
}

/** Capabilities, re-read whenever the app returns to the foreground (battery saver and animation scale can change). */
export function useDeviceCapabilities(reduceTransparency = false): DeviceCapabilities {
  const [caps, setCaps] = useState<DeviceCapabilities>({ ...UNKNOWN_CAPABILITIES, apiLevel: Number(Platform.Version) || 0, reduceTransparency });
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void readDeviceCapabilities(reduceTransparency).then((c) => {
        if (live) setCaps(c);
      });
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      live = false;
      sub.remove();
    };
  }, [reduceTransparency]);
  return caps;
}
