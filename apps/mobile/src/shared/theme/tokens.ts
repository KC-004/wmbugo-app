import type { ViewStyle } from 'react-native';
import { colorTokens } from './colors';
import { radiusTokens, spacingTokens } from './designTokens.generated';

/** 4pt spacing scale and named layout values (dp). */
export const spacing = spacingTokens;
export const radii = radiusTokens;

/** Motion: 150-250 ms; reduced motion uses `reduced` (none) or at most `fast`. */
export const motion = {
  fast: 150,
  standard: 200,
  slow: 250,
  /** Duration when the system or in-app reduced-motion setting is on. */
  reduced: 0,
} as const;

/**
 * Hierarchy is tonal, not shadowed. The ＋ button carries the app's only
 * shadow; a lint rule rejects shadow and elevation properties anywhere else.
 */
export const elevation = {
  none: {} as ViewStyle,
  addButton: {
    elevation: 6,
    shadowColor: colorTokens['text-primary'],
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  } as ViewStyle,
} as const;

/** Hit target and layout minimums (dp). */
export const layout = {
  touchMin: spacingTokens['touch-min'],
  contentMax: spacingTokens['content-max'],
  railBreakpoint: spacingTokens['rail-breakpoint'],
  focusRingWidth: spacingTokens['focus-ring-width'],
  focusRingOffset: spacingTokens['focus-ring-offset'],
} as const;
