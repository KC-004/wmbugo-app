import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colorTokens } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';

/** The band behind the hero (light): 176dp, full bleed, rounded bottom corners. */
export const BAND_HEIGHT = 176;

/**
 * Light mode: the brand gradient band (UX-DR5), starting 4dp below the header so the hero overhangs its lower edge.
 * Dark mode: no band, only three radial glows at their token alpha (capped at 45%). Decorative; hidden from TalkBack.
 * Text never sits on it: the glass hero carries the ink.
 */
export function HomeBand() {
  const theme = useTheme();
  if (theme.scheme === 'dark') {
    const glow = (id: string, base: string, cx: string, cy: string) => (
      <RadialGradient key={id} id={id} cx={cx} cy={cy} r="0.6">
        <Stop offset="0" stopColor={base.slice(0, 7)} stopOpacity={parseInt(base.slice(7, 9), 16) / 255} />
        <Stop offset="1" stopColor={base.slice(0, 7)} stopOpacity={0} />
      </RadialGradient>
    );
    return (
      <View testID="home-glows" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glows}>
        <Svg width="100%" height="100%">
          <Defs>
            {glow('g1', colorTokens['glow-start-dark'], '0.2', '0.3')}
            {glow('g2', colorTokens['glow-mid-dark'], '0.8', '0.5')}
            {glow('g3', colorTokens['glow-end-dark'], '0.4', '0.9')}
          </Defs>
          <Circle cx="20%" cy="30%" r="60%" fill="url(#g1)" />
          <Circle cx="80%" cy="50%" r="60%" fill="url(#g2)" />
          <Circle cx="40%" cy="90%" r="60%" fill="url(#g3)" />
        </Svg>
      </View>
    );
  }
  return (
    <View testID="home-band" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.band}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="band" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colorTokens['gradient-brand-start']} />
            <Stop offset="0.5" stopColor={colorTokens['gradient-brand-mid']} />
            <Stop offset="1" stopColor={colorTokens['gradient-brand-end']} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#band)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: -12, left: -16, right: -16, height: BAND_HEIGHT, borderBottomLeftRadius: radii.lg, borderBottomRightRadius: radii.lg, overflow: 'hidden' },
  glows: { position: 'absolute', top: -60, left: -16, right: -16, height: 420 },
});
