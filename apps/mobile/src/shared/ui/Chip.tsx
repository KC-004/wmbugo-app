import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconProps } from 'phosphor-react-native';
import { controlA11y } from '../a11y/labels';
import { colorTokens } from '../theme/colors';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../theme/Icon';
import { layout, radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';
import { FocusRing, useFocusRing } from './FocusRing';

/** quick-category, account, period, and the Paid with / Paid from pickers. */
export type ChipVariant = 'quick-category' | 'account' | 'period' | 'paid-with' | 'paid-from';

const SPOKEN_PREFIX: Readonly<Partial<Record<ChipVariant, string>>> = {
  'paid-with': 'Paid with ',
  'paid-from': 'Paid from ',
};

export interface ChipProps {
  label: string;
  variant?: ChipVariant;
  selected?: boolean;
  onPress: () => void;
  /** Outline icon shown before the label; it turns filled when selected. */
  icon?: ComponentType<IconProps>;
  testID?: string;
  /** Defaults to button; segmented choices pass radio. */
  role?: 'button' | 'radio';
  /** Spoken after the label, e.g. "2 of 3". */
  hint?: string;
  /** Sits on the (dark) glass sheet: on-glass ink, outline and focus ring. */
  onGlass?: boolean;
}

/**
 * A chip is 32dp tall with a 48dp hit area. Unselected: 1px border-control outline.
 * Selected: accent fill with a filled icon (never colour alone: the icon and the
 * "selected" state change too). Paid with / Paid from chips speak their prefix.
 */
export function Chip({ label, variant = 'quick-category', selected = false, onPress, icon, testID, role = 'button', hint, onGlass = false }: ChipProps) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing(onGlass);
  const a11y = controlA11y({ label: `${SPOKEN_PREFIX[variant] ?? ''}${label}`, role, selected, hint });

  // chip-selected (DESIGN.md): white on the light accent fill, dark canvas ink on the light-teal dark fill.
  const ink = selected ? (theme.scheme === 'dark' ? colorTokens['bg-canvas-dark'] : colorTokens['bg-surface']) : theme.color(onGlass ? 'on-glass-primary' : 'text-primary');
  return (
    <Pressable testID={testID} {...a11y} onPress={onPress} onFocus={onFocus} onBlur={onBlur} style={styles.hit}>
      <FocusRing focused={focused} onGlass={onGlass} radius={radii.full}>
        <View
          style={[
            styles.visual,
            selected
              ? { backgroundColor: theme.color('accent-primary') }
              : { borderColor: theme.color(onGlass ? 'on-glass-secondary' : 'border-control'), borderWidth: 1 },
          ]}>
          {icon ? <Icon icon={icon} size={18} selected={selected} tint={ink} /> : null}
          <Text style={[textStyle('label'), { color: ink }]}>{label}</Text>
        </View>
      </FocusRing>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 48dp hit area around the 32dp visual (the FocusRing adds 4dp each side).
  hit: { minHeight: layout.touchMin, minWidth: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  visual: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
