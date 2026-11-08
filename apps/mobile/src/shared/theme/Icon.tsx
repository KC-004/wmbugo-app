import type { ComponentType } from 'react';
import { View } from 'react-native';
import type { IconProps } from 'phosphor-react-native';
import { useTheme } from './ThemeProvider';
import type { ColorName } from './colors';

export type IconComponent = ComponentType<IconProps>;

/**
 * The only icon entry point. Phosphor is the only icon library: outline by
 * default, filled for the selected state. Colour comes from a theme token,
 * never a literal; decorative icons are hidden from TalkBack.
 */
export function Icon({
  icon: Glyph,
  size = 24,
  selected = false,
  color = 'text-primary',
  tint,
}: {
  icon: IconComponent;
  size?: number;
  selected?: boolean;
  color?: ColorName;
  /** A resolved colour value (for ink that must not change with the scheme). Wins over `color`. */
  tint?: string;
}) {
  const theme = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Glyph size={size} weight={selected ? 'fill' : 'regular'} color={tint ?? theme.color(color)} />
    </View>
  );
}
