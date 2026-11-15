import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { colorTokens } from './colors';
import { useTheme } from './ThemeProvider';

/**
 * The soft glow behind every screen in the dark theme (three radial glows at their token alpha, capped at 45%). It fills the whole
 * screen and stays still while the content scrolls, and runs on under the tab bar. Decorative; hidden from TalkBack. Light mode has no
 * glow. Put it as the first child of a screen frame (see ScreenFrame).
 */
export function ScreenGlows() {
  const theme = useTheme();
  if (theme.scheme !== 'dark') return null;
  const glow = (id: string, base: string, cx: string, cy: string) => (
    <RadialGradient key={id} id={id} cx={cx} cy={cy} r="0.6">
      <Stop offset="0" stopColor={base.slice(0, 7)} stopOpacity={parseInt(base.slice(7, 9), 16) / 255} />
      <Stop offset="1" stopColor={base.slice(0, 7)} stopOpacity={0} />
    </RadialGradient>
  );
  return (
    <View testID="screen-glows" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glows}>
      <Svg width="100%" height="100%">
        <Defs>
          {glow('g1', colorTokens['glow-start-dark'], '0.2', '0.1')}
          {glow('g2', colorTokens['glow-mid-dark'], '0.8', '0.4')}
          {glow('g3', colorTokens['glow-end-dark'], '0.35', '0.95')}
        </Defs>
        <Circle cx="20%" cy="10%" r="60%" fill="url(#g1)" />
        <Circle cx="80%" cy="40%" r="60%" fill="url(#g2)" />
        <Circle cx="35%" cy="95%" r="60%" fill="url(#g3)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // Runs on below the screen, under the tab bar, so no edge shows above it.
  glows: { position: 'absolute', top: 0, left: 0, right: 0, bottom: -200 },
});
