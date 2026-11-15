import { Pressable, StyleSheet, Text } from 'react-native';
import { CaretRight } from 'phosphor-react-native';
import { controlA11y } from '../../shared/a11y/labels';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';

/** A row on Plan that opens another Plan page (`Bills & recurring`; Goals joins it in Story 6.6). Replaced by the Plan hub sections in Story 6.8. */
export function PlanLinkRow({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} {...controlA11y({ label, role: 'button' })} onPress={onPress} style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{label}</Text>
      <Icon icon={CaretRight} size={18} color="text-secondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, marginTop: 16, paddingHorizontal: 12, borderWidth: 1, borderRadius: radii.md },
});
