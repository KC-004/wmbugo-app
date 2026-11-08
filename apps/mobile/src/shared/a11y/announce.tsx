import type { ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';

export type Politeness = 'polite' | 'assertive';

/**
 * Speaks `text` without moving focus. Android has one announcement channel, so the
 * level matters for live regions (below); this call is for one-off moments (a saved
 * toast, a keypad amount, an error that needs attention).
 */
export function announce(text: string): void {
  AccessibilityInfo.announceForAccessibility(text);
}

/**
 * Wraps content whose changes TalkBack should read out as they happen: the keypad
 * amount and toasts are polite; an error that blocks the user is assertive.
 */
export function LiveRegion({ politeness = 'polite', children }: { politeness?: Politeness; children: ReactNode }) {
  return (
    <View accessible accessibilityLiveRegion={politeness}>
      {children}
    </View>
  );
}
