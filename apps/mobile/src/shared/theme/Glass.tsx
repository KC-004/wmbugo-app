import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useDeviceCapabilities } from './deviceCapabilities';
import { BLUR_AVAILABLE, glassFallbackReasons } from './glassRules';
import { radii } from './tokens';
import { useTheme } from './ThemeProvider';

/**
 * Glass surface for floating elements only (hero, tab bar, sheets). Tint is deep teal at 80% (light)
 * or the 62% locked floor (dark) with a 1px #5EEAD4 @22% border. It becomes the solid
 * `glass-fallback` with identical layout when a fallback trigger holds.
 * NOTE: the backdrop blur needs a native blur library that is not chosen yet; until then the tint is
 * drawn without blur (see Story 1.8 notes). Never stack glass on glass.
 */
export function Glass({
  children,
  style,
  overImagery = false,
  forceFallback,
  testID,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  overImagery?: boolean;
  /** Test hook: bypass device detection. */
  forceFallback?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const caps = useDeviceCapabilities();
  const fallback = forceFallback ?? (!BLUR_AVAILABLE || glassFallbackReasons(caps, { overImagery }).length > 0);
  const backgroundColor = fallback ? theme.color('glass-fallback') : theme.color('glass-surface');
  return (
    <View
      testID={testID}
      style={[styles.base, { backgroundColor, borderColor: theme.color('glass-border') }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, borderRadius: radii.lg, overflow: 'hidden' },
});
