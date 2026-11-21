import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { copy } from '../copy';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';
import { textStyle } from '../theme/typography';

/**
 * The shared passphrase field (UX-DR64, Stories 8.7 and 8.9): hidden by default with a `Show` toggle (`Show passphrase, toggle`),
 * paste and password managers allowed. A new passphrase uses `autoComplete="password-new"`; opening a backup uses `password`.
 * There is no recovery for a lost passphrase, and the screens say so.
 */
export function PassphraseField({
  label,
  value,
  onChangeText,
  show,
  onToggleShow,
  autoComplete,
  invalid = false,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: 'password-new' | 'password';
  invalid?: boolean;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{label}</Text>
      <View style={[styles.row, { borderColor: theme.color(invalid ? 'semantic-expense' : 'border-control'), backgroundColor: theme.color('bg-surface') }]}>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={autoComplete === 'password-new' ? 'newPassword' : 'password'}
          importantForAutofill="yes"
          spellCheck={false}
          style={[styles.input, textStyle('body'), { color: theme.color('text-primary') }]}
        />
        <Pressable
          testID={`${testID}-show`}
          accessibilityRole="switch"
          accessibilityLabel={copy.passphrase.showToggle}
          accessibilityState={{ checked: show }}
          onPress={onToggleShow}
          style={styles.toggle}>
          <Text style={[textStyle('body-medium'), { color: theme.color('accent-primary') }]}>{show ? copy.passphrase.hide : copy.passphrase.show}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, minHeight: layout.touchMin },
  input: { flex: 1, paddingHorizontal: 12, minHeight: layout.touchMin },
  toggle: { minHeight: layout.touchMin, minWidth: layout.touchMin, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});
