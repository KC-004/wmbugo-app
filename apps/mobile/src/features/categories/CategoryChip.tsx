import { StyleSheet, View } from 'react-native';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { categoryIcon } from '../add/categoryIcons';

/** `Other` is the neutral fallback: grey ink on the canvas rather than a palette colour. */
export const NEUTRAL_CATEGORY_ID = 'cat_other';

/** The 40dp icon chip: the icon in its `cat-*` colour on a 16% tint of the same colour. */
export function CategoryChip({ categoryId, icon, colour, size = 40 }: { categoryId: string; icon: string; colour: string; size?: number }) {
  const theme = useTheme();
  const neutral = categoryId === NEUTRAL_CATEGORY_ID;
  const ink: ColorName = neutral ? 'text-secondary' : (colour as ColorName);
  // 0x29 / 0xFF is 16%.
  const fill = neutral ? theme.color('bg-canvas') : `${theme.color(colour as ColorName)}29`;
  return (
    <View style={[styles.chip, { width: size, height: size, borderRadius: size / 2, backgroundColor: fill }, neutral && { borderWidth: 1, borderColor: theme.color('border-hairline') }]}>
      <Icon icon={categoryIcon(icon)} size={Math.round(size * 0.55)} color={ink} />
    </View>
  );
}

const styles = StyleSheet.create({ chip: { alignItems: 'center', justifyContent: 'center' } });
