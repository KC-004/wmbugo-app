import type { ComponentType } from 'react';
import type { IconProps } from 'phosphor-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Backspace, X } from 'phosphor-react-native';
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
export const KEY_SIZE = 48;

const ROWS: readonly (readonly KeypadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
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
        {glyph === null ? <Icon icon={Backspace} size={22} tint={theme.color('on-glass-primary')} /> : <Text style={[textStyle('title'), { color: theme.color('on-glass-primary') }]}>{glyph}</Text>}
      </Pressable>
    </FocusRing>
  );
}

/** The small round Clear button that sits beside the typed amount (long-press Delete clears too). */
export function ClearKey({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing(true);
  return (
    <FocusRing focused={focused} onGlass radius={20}>
      <Pressable testID="key-clear" {...controlA11y({ label: copy.add.clear, role: 'button' })} hitSlop={4} onPress={onPress} onFocus={onFocus} onBlur={onBlur} style={[styles.round, { borderColor: resolveColor('dark', 'border-hairline'), backgroundColor: resolveColor('dark', 'bg-surface') }]}>
        <Icon icon={X} size={16} tint={theme.color('on-glass-primary')} />
      </Pressable>
    </FocusRing>
  );
}

/** A button under the keypad (Add details): an outlined pill with an icon, so it reads as something to press, not as loose text. */
export function KeypadAction({ icon, label, onPress, testID, expanded }: { icon: ComponentType<IconProps>; label: string; onPress: () => void; testID: string; expanded?: boolean }) {
  const theme = useTheme();
  const { focused, onFocus, onBlur } = useFocusRing(true);
  return (
    <FocusRing focused={focused} onGlass radius={radii.md}>
      <Pressable testID={testID} {...controlA11y({ label, role: 'button', ...(expanded !== undefined ? { expanded } : {}) })} onPress={onPress} onFocus={onFocus} onBlur={onBlur} style={[styles.action, { borderColor: resolveColor('dark', 'border-hairline'), backgroundColor: resolveColor('dark', 'bg-surface') }]}>
        <Icon icon={icon} size={18} tint={theme.color('on-glass-primary')} />
        <Text style={[textStyle('label'), { color: theme.color('on-glass-primary') }]}>{label}</Text>
      </Pressable>
    </FocusRing>
  );
}

/**
 * The amount keypad: the familiar 3 by 4 phone pad. Keys are 48dp tall and share the width, labelled `1`...`0`, `decimal point` and `Delete`.
 * Long-press Delete clears, and so does the Clear button beside the amount. The decimal key follows the locale and is absent for
 * currencies with no minor unit.
 */
export function Keypad({ exponent, locale, onKey, clearBeside = false }: { exponent: number; locale: string; onKey: (k: KeypadKey) => void; /** The caller shows its own Clear beside the amount (the Add sheet); otherwise it sits under the keys. */ clearBeside?: boolean }) {
  const sep = decimalSeparator(locale);
  return (
    <View testID="keypad" accessibilityLabel={copy.add.keypad} style={styles.pad}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((k) => (
            <Key key={k} k={k} glyph={k} label={k} onKey={onKey} />
          ))}
        </View>
      ))}
      <View style={styles.row}>
        {exponent === 0 ? <View style={styles.spacer} /> : <Key k="decimal" glyph={sep} label={copy.add.decimalPoint} onKey={onKey} />}
        <Key k="0" glyph="0" label="0" onKey={onKey} />
        <Key k="delete" glyph={null} label={copy.add.delete} onKey={onKey} onLong={() => onKey('clear')} />
      </View>
      {clearBeside ? null : (
        <View style={styles.clearRow}>
          <ClearKey onPress={() => onKey('clear')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 6, alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: 6 },
  clearRow: { alignItems: 'center' },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  key: { flex: 1, minWidth: 0, minHeight: KEY_SIZE, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // Same footprint as a key plus its 4dp focus-ring gap each side, so the bottom row stays aligned.
  spacer: { flex: 1, minHeight: KEY_SIZE },
  action: { flexDirection: 'row', gap: 6, minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderRadius: radii.md },
});
