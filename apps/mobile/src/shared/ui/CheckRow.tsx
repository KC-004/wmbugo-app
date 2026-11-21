import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'phosphor-react-native';
import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { layout, radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';

/** A checkbox row: the whole row is the control, 48dp tall, with role `checkbox` and its checked state announced. */
export function CheckRow({ label, checked, onToggle, testID }: { label: string; checked: boolean; onToggle: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={[styles.check, { borderColor: theme.color('border-control'), backgroundColor: theme.color('bg-surface') }]}>
      <View style={[styles.box, { borderColor: theme.color(checked ? 'accent-primary' : 'border-control'), backgroundColor: checked ? theme.color('accent-primary') : 'transparent' }]}>
        {checked ? <Icon icon={Check} size={16} color="bg-surface" /> : null}
      </View>
      <Text style={[textStyle('body'), { color: theme.color('text-primary'), flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radii.md, padding: 12, minHeight: layout.touchMin },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
