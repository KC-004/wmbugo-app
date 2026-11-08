import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import type { CurrencyCode } from '@wmbugo/core';
import { amountLabel, type AmountKind } from '../a11y/labels';
import { formatAmount, type AmountDirection } from '../formatAmount';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorName } from '../theme/colors';
import { maxFontScale, textStyle, type TypeRole } from '../theme/typography';

export type AmountRole = Extract<TypeRole, 'display-amount' | 'headline' | 'amount' | 'keypad' | 'body' | 'body-medium' | 'caption' | 'title'>;

export interface AmountProps {
  amountMinor: number;
  currency: CurrencyCode;
  direction: AmountDirection;
  role?: AmountRole;
  /** Reading kind for TalkBack; defaults from the direction. */
  kind?: AmountKind;
  /** Hidden amounts render the currency symbol plus a fixed four dots, whatever the value. */
  hidden?: boolean;
  /** A rough figure: shows a leading ~ and reads "about". */
  approximate?: boolean;
  color?: ColorName;
  locale?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

// Large roles auto-fit instead of truncating: display-amount to 28sp, headline to 22sp.
const MIN_FIT: Partial<Record<AmountRole, number>> = { 'display-amount': 28 / 40, headline: 22 / 28 };
const MASK = '••••'; // four dots, so length never leaks magnitude

/**
 * The only way to render money. Expenses are unsigned, income gets "+", no minus
 * sign ever appears. It never ellipsises, clips or wraps a number mid-way: large roles
 * cap font scaling at 1.5 and then shrink to fit; row amounts keep one line and the
 * row stacks them instead (see Activity row).
 */
export function Amount({
  amountMinor,
  currency,
  direction,
  role = 'amount',
  kind,
  hidden = false,
  approximate = false,
  color = 'text-primary',
  locale,
  style,
  testID,
}: AmountProps) {
  const theme = useTheme();
  const formatted = formatAmount({ amountMinor, currency, direction, locale });
  const symbolOnly = hidden ? formatAmount({ amountMinor: 0, currency, direction, locale }) : null;

  let text = '';
  if (hidden && symbolOnly?.ok) {
    // currency symbol + a fixed four dots (the value, sign and digit count never show)
    const masked = symbolOnly.value.replace(/[0-9٠-٩۰-۹]+([.,٫٬][0-9٠-٩]+)?/g, MASK);
    text = masked.replace(/^([^\s•]+)(•)/, '$1 $2');
  } else if (formatted.ok) {
    text = formatted.value;
  }
  if (approximate && text) text = `~${text}`;

  const resolvedKind: AmountKind = kind ?? (direction === 'income' ? 'income' : direction === 'expense' ? 'spent' : 'plain');
  const label = amountLabel({ amountMinor, currency, kind: resolvedKind, locale, hidden, approximate });
  const cap = maxFontScale(role);
  const fit = MIN_FIT[role];

  return (
    <Text
      testID={testID}
      accessibilityLabel={label}
      maxFontSizeMultiplier={cap}
      numberOfLines={fit ? 1 : undefined}
      adjustsFontSizeToFit={fit !== undefined}
      minimumFontScale={fit}
      ellipsizeMode="clip"
      style={[textStyle(role), styles.amount, { color: theme.color(color) }, style]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  // A number is never broken across lines.
  amount: { flexShrink: 0 },
});
