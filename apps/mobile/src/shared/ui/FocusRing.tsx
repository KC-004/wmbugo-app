import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { layout, radii } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Focus ring (keyboard, D-pad, Switch Access): 2dp ring with a 2dp gap, drawn
 * outside the control so layout never moves. `onGlass` uses focus-ring-on-glass.
 */
export function useFocusRing(onGlass = false): {
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  ringStyle: ViewStyle;
} {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const ringStyle: ViewStyle = {
    borderWidth: layout.focusRingWidth,
    borderRadius: radii.md + layout.focusRingOffset + layout.focusRingWidth,
    borderColor: focused ? theme.color(onGlass ? 'focus-ring-on-glass' : 'focus-ring') : 'transparent',
    padding: layout.focusRingOffset,
  };
  return { focused, onFocus, onBlur, ringStyle };
}

/** Draws the ring around its child when `focused`. The ring space is always reserved. */
export function FocusRing({
  focused,
  onGlass = false,
  radius = radii.md,
  children,
  testID,
}: {
  focused: boolean;
  onGlass?: boolean;
  radius?: number;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.ring,
        {
          borderRadius: radius + layout.focusRingOffset + layout.focusRingWidth,
          borderColor: focused ? theme.color(onGlass ? 'focus-ring-on-glass' : 'focus-ring') : 'transparent',
        },
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderWidth: layout.focusRingWidth, padding: layout.focusRingOffset },
});
