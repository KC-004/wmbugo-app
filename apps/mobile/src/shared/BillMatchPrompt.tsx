import { StyleSheet, Text, View } from 'react-native';
import { copy } from './copy';
import { useTheme } from './theme/ThemeProvider';
import { radii } from './theme/tokens';
import { textStyle } from './theme/typography';
import { Button } from './ui/Button';

/**
 * The inline card that asks `Rent paid?` with `Yes, link it` and `Not this one` (UX-DR39, bill-match variant). It is only
 * the card: whoever shows it decides when and what the buttons do. Transaction detail uses it now and the capture sheet
 * reuses it in Epic 11 (CAP-011).
 */
export function BillMatchPrompt({ billName, onLink, onDismiss }: { billName: string; onLink: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  return (
    <View testID="bill-match-prompt" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text accessibilityRole="header" style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.bills.matchTitle.replace('{name}', billName)}</Text>
      <Button label={copy.bills.linkIt} testID="bill-match-link" onPress={onLink} />
      <Button label={copy.bills.notThisOne} variant="text" testID="bill-match-dismiss" onPress={onDismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
});
