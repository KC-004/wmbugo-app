import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenGlows } from '../theme/ScreenGlows';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The frame of every screen: the canvas colour, the status-bar inset and the soft glow behind the content. Use it as the root of a
 * screen so every page has the same background; `style` adds to the frame (for example a centred column).
 */
export function ScreenFrame({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={[styles.fill, { backgroundColor: theme.color('bg-canvas'), paddingTop: insets.top }, style]}>
      <ScreenGlows />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
