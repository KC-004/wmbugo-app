import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { colorTokens } from '../../shared/theme/colors';

/** The most the overflow past the limit draws: 20% of the track (UX-DR24). */
export const HERO_OVERFLOW_CAP = 0.2;

/**
 * Where the fill, the limit tick and the hatched overflow sit, as fractions of the track (pure, so the states are testable).
 * Under the limit the fill grows to the tick at the end of the track. Over it the overflow is (used − target) ÷ target of the
 * track, capped at 20%; the tick moves left by that much and the fill stops at the tick.
 */
export function heroBarGeometry(usedMinor: number, targetMinor: number): { fill: number; tick: number; overflow: number } {
  if (!Number.isFinite(usedMinor) || !Number.isFinite(targetMinor)) return { fill: 0, tick: 1, overflow: 0 };
  if (targetMinor <= 0) {
    // No limit: nothing spent is an empty bar; any spending is all overflow, capped.
    if (usedMinor <= 0) return { fill: 0, tick: 1, overflow: 0 };
    return { fill: 1 - HERO_OVERFLOW_CAP, tick: 1 - HERO_OVERFLOW_CAP, overflow: HERO_OVERFLOW_CAP };
  }
  const ratio = usedMinor / targetMinor;
  if (ratio <= 1) return { fill: Math.max(0, ratio), tick: 1, overflow: 0 };
  const overflow = Math.min(ratio - 1, HERO_OVERFLOW_CAP);
  return { fill: 1 - overflow, tick: 1 - overflow, overflow };
}

/** A fraction of the track as a percentage with no floating-point noise. */
const pct = (x: number): `${number}%` => `${Math.round(x * 10000) / 100}%`;

/** The track colour: the on-glass ink at 16%. */
export const TRACK_ALPHA = 0.16;
export const withAlpha = (hex: string, alpha: number): string => `${hex.slice(0, 7)}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;

/**
 * The hero bar (UX-DR24): 8dp, rounded full, on glass. `hidden` keeps the track and draws no fill, tick or overflow, so the
 * layout does not move while amounts are masked.
 */
export function HeroBar({ usedMinor, targetMinor, hidden: hiddenProp, testID = 'hero-bar' }: { usedMinor: number; targetMinor: number; hidden?: boolean; testID?: string }) {
  const theme = useTheme();
  const globalHidden = useAmountsHidden();
  const hidden = hiddenProp ?? globalHidden;
  const g = heroBarGeometry(usedMinor, targetMinor);
  const fill = theme.scheme === 'dark' ? theme.color('on-glass-accent') : theme.color('on-glass-primary');
  const ink = theme.color('on-glass-primary');
  const warn = theme.color('on-glass-warning');
  return (
    <View testID={testID} style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View testID={`${testID}-track`} style={[styles.track, { backgroundColor: withAlpha(ink, TRACK_ALPHA) }]}>
        {hidden ? null : (
          <>
            <View testID={`${testID}-fill`} style={[styles.fill, { width: pct(g.fill), backgroundColor: fill }]} />
            {g.overflow > 0 ? (
              <View testID={`${testID}-overflow`} style={[styles.overflow, { left: pct(1 - g.overflow), width: pct(g.overflow), backgroundColor: colorTokens['glass-tint'] }]}>
                <Svg width="100%" height="100%">
                  <Defs>
                    <Pattern id="hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                      <Rect width="2" height="4" fill={warn} />
                    </Pattern>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#hatch)" />
                </Svg>
              </View>
            ) : null}
          </>
        )}
      </View>
      {hidden ? null : <View testID={`${testID}-tick`} style={[styles.tick, { left: pct(g.tick), backgroundColor: ink, borderColor: colorTokens['bg-canvas-dark'] }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 14, justifyContent: 'center' },
  track: { height: 8, borderRadius: 999, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  overflow: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  tick: { position: 'absolute', top: 0, width: 4, height: 14, marginLeft: -2, borderWidth: 1 },
});
