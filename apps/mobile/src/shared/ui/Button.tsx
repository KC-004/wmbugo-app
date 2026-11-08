import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { controlA11y } from '../a11y/labels';
import { colorTokens, resolveColor } from '../theme/colors';
import { useTheme } from '../theme/ThemeProvider';
import { layout, radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';
import { FocusRing, useFocusRing } from './FocusRing';

export type ButtonVariant = 'primary' | 'secondary' | 'secondary-on-footer' | 'text';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** When set the button looks disabled but stays focusable, and TalkBack says why. */
  disabledReason?: string;
  /** Text button sitting on a glass surface. */
  onGlass?: boolean;
  testID?: string;
}

/**
 * Buttons (DESIGN.md Components): each is at least 48dp tall. The disabled
 * primary keeps focus and announces "disabled" plus the reason as a hint, so a
 * screen-reader user can find out what is missing instead of hitting a dead control.
 */
export function Button({ label, onPress, variant = 'primary', disabledReason, onGlass = false, testID }: ButtonProps) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing(onGlass || variant === 'secondary-on-footer');
  const disabled = disabledReason !== undefined;
  const a11y = controlA11y({ label, role: 'button', disabled, hint: disabledReason });

  const dark = theme.scheme === 'dark';
  let fg: string;
  let border: string | undefined;
  let fill: string | undefined;
  if (disabled) {
    fg = theme.color('text-secondary');
    fill = theme.color('bg-muted');
  } else if (variant === 'primary') {
    fg = colorTokens['bg-surface']; // white in both schemes: the gradient behind it is dark in both
  } else if (variant === 'secondary') {
    fg = theme.color('accent-primary');
    border = theme.color('accent-primary');
  } else if (variant === 'secondary-on-footer') {
    fg = dark ? resolveColor('dark', 'accent-primary') : theme.color('on-glass-primary');
    border = fg;
  } else {
    fg = onGlass ? theme.color('on-glass-primary') : theme.color('accent-primary');
  }

  return (
    <FocusRing focused={focused} onGlass={onGlass || variant === 'secondary-on-footer'}>
      <Pressable
        testID={testID}
        {...a11y}
        onPress={disabled ? undefined : onPress}
        onFocus={onFocus}
        onBlur={onBlur}
        style={[styles.base, fill ? { backgroundColor: fill } : null, border ? { borderColor: border, borderWidth: 1 } : null]}>
        {variant === 'primary' && !disabled ? <Gradient /> : null}
        <Text style={[textStyle('label'), { color: fg }, variant === 'text' && onGlass ? styles.underline : null]}>{label}</Text>
      </Pressable>
    </FocusRing>
  );
}

/** Deep segment of gradient.brand (mid to end): white label is >= 5.47:1 along its whole length. */
function Gradient() {
  const theme = useTheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="brandDeep" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={theme.color('gradient-brand-mid')} />
            <Stop offset="1" stopColor={theme.color('gradient-brand-end')} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#brandDeep)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.touchMin,
    minWidth: layout.touchMin,
    paddingHorizontal: 16,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  underline: { textDecorationLine: 'underline' },
});
