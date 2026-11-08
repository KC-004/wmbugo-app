import Svg, { Path } from 'react-native-svg';
import { colorTokens } from '../theme/colors';

/** Paper-boat illustration for empty states. Still frame; decorative. */
export function PaperBoat({ size = 96 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M10 62 L90 62 L76 80 L24 80 Z" fill={colorTokens['accent-primary']} />
      <Path d="M50 14 L50 58 L22 58 Z" fill={colorTokens['accent-primary-dark']} />
      <Path d="M54 24 L54 58 L80 58 Z" fill={colorTokens['gradient-brand-start']} />
      <Path d="M6 88 Q20 82 34 88 T62 88 T94 88" fill="none" stroke={colorTokens['gradient-brand-end']} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}
