import Svg, { Circle, Path } from 'react-native-svg';
import { colorTokens } from '../theme/colors';

/**
 * The coin mark: a teal coin whose face is the 50/30/20 pie (needs / wants / savings).
 * The pie uses the light-mode N/W/S values in both schemes (they are the coin's face);
 * a 1px outline keeps the pale slices visible on light surfaces.
 */
export function CoinMark({ size = 48 }: { size?: number }) {
  const c = 50;
  const r = 40;
  const point = (turn: number): [number, number] => [c + r * Math.sin(turn * 2 * Math.PI), c - r * Math.cos(turn * 2 * Math.PI)];
  const slice = (from: number, to: number): string => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M${c} ${c} L${x1} ${y1} A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`;
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={c} cy={c} r={46} fill={colorTokens['gradient-brand-end']} />
      <Path d={slice(0, 0.5)} fill={colorTokens.needs} />
      <Path d={slice(0.5, 0.8)} fill={colorTokens.wants} />
      <Path d={slice(0.8, 1)} fill={colorTokens.savings} />
      <Circle cx={c} cy={c} r={r} fill="none" stroke={colorTokens['text-secondary']} strokeWidth={1} />
    </Svg>
  );
}
