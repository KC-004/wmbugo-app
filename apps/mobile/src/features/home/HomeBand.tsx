import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colorTokens } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';

/** The band behind the hero (light): 176dp, full bleed, rounded bottom corners. */
export const BAND_HEIGHT = 176;

/**
 * Light mode: the brand gradient band (UX-DR5), starting 4dp below the header so the hero overhangs its lower edge.
 * Dark mode: no band; the glow behind the screen is drawn by the screen frame (ScreenGlows). Decorative; hidden from TalkBack.
 * Text never sits on it: the glass hero carries the ink.
 */
/** Light mode: the brand band behind the hero. */
export function HomeBand() {
  const theme = useTheme();
  if (theme.scheme === 'dark') return null;
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
});
