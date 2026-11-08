import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useDeviceCapabilities } from '../theme/deviceCapabilities';
import { useInAppReduceMotion } from './inAppMotion';

/**
 * True when motion must be removed: the animator duration scale is 0, the system
 * reduce-motion flag is on, or the in-app "Reduce motion" setting is on (Story 1.16).
 */
export function reducedMotion(input: { animatorScale: number; systemReduceMotion: boolean; inApp: boolean }): boolean {
  return input.animatorScale === 0 || input.systemReduceMotion || input.inApp;
}

export function useReducedMotion(inAppOverride?: boolean): boolean {
  const stored = useInAppReduceMotion();
  const inApp = inAppOverride ?? stored;
  const { animatorScale } = useDeviceCapabilities();
  const [system, setSystem] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setSystem(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystem);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reducedMotion({ animatorScale, systemReduceMotion: system, inApp });
}
