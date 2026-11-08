import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Backspace } from 'phosphor-react-native';
import type { KeypadKey } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { decimalSeparator } from '../../shared/decimalSeparator';
import { copy } from '../../shared/copy';
import { resolveColor } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { Icon } from '../../shared/theme/Icon';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { FocusRing, useFocusRing } from '../../shared/ui/FocusRing';

/** Each key is at least this tall and wide (dp). */
export const KEY_SIZE = 56;

const ROWS: readonly (readonly KeypadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['decimal', '0', 'delete'],
];

function Key({ k, glyph, onKey, onLong, label }: { k: KeypadKey; glyph: string | null; onKey: (k: KeypadKey) => void; onLong?: () => void; label: string }) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing();
  return (
    <FocusRing focused={focused} radius={radii.md}>
      <Pressable
        testID={`key-${k}`}
        {...controlA11y({ label, role: 'button' })}
        onPress={() => onKey(k)}
        onLongPress={onLong}
        onFocus={onFocus}
        onBlur={onBlur}
        style={[styles.key, { backgroundColor: resolveColor('dark', 'bg-surface'), borderColor: resolveColor('dark', 'border-hairline') }]}>
        {glyph === null ? <Icon icon={Backspace} size={26} tint={theme.color('on-glass-primary')} /> : <Text style={[textStyle('keypad'), { color: theme.color('on-glass-primary') }]}>{glyph}</Text>}
      </Pressable>
    </FocusRing>
  );
}

function ClearKey({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing(true);
  return (
    <FocusRing focused={focused} onGlass radius={radii.md}>
      <Pressable testID="key-clear" {...controlA11y({ label: copy.add.clear, role: 'button' })} onPress={onPress} onFocus={onFocus} onBlur={onBlur} style={styles.clear}>
        <Text style={[textStyle('label'), { color: theme.color('on-glass-primary') }]}>{copy.add.clear}</Text>
      </Pressable>
    </FocusRing>
  );
}

/**
 * The amount keypad: keys are 56dp or more, labelled `1`...`0`, `decimal point` and `Delete`. Long-press
 * Delete clears, and so does the visible Clear. The decimal key follows the locale and is absent for
 * currencies with no minor unit.
 */
export function Keypad({ exponent, locale, onKey, trailing }: { exponent: number; locale: string; onKey: (k: KeypadKey) => void; trailing?: ReactNode }) {
  const sep = decimalSeparator(locale);
  return (
    <View testID="keypad" accessibilityLabel={copy.add.keypad} style={styles.pad}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((k) => {
            if (k === 'decimal' && exponent === 0) return <View key={k} style={styles.spacer} />;
            if (k === 'delete') return <Key key={k} k={k} glyph={null} label={copy.add.delete} onKey={onKey} onLong={() => onKey('clear')} />;
            return <Key key={k} k={k} glyph={k === 'decimal' ? sep : k} label={k === 'decimal' ? copy.add.decimalPoint : k} onKey={onKey} />;
          })}
        </View>
      ))}
      <View style={styles.row}>
        <ClearKey onPress={() => onKey('clear')} />
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 8, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  key: { minWidth: 88, minHeight: KEY_SIZE, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // Same footprint as a key plus its 4dp focus-ring gap each side, so the bottom row stays aligned.
  spacer: { minWidth: 96, minHeight: KEY_SIZE + 8 },
  clear: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
});
