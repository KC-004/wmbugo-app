import { StyleSheet, Text, View } from 'react-native';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';

/**
 * The one-time just-in-time ask (Story 4.9): shown after the first budget is saved with alerts on, never repeated. Allow
 * shows the system prompt; Not now asks nothing more. Either answer is recorded by the caller.
 */
export function AlertAskSheet({ onAnswer, close }: { onAnswer: (allow: boolean) => void; close: () => void }) {
  const theme = useTheme();
  const ink = { color: theme.color('on-glass-primary') };
  return (
    <View testID="alert-ask" style={styles.root}>
      <Text style={[textStyle('body'), ink]}>{copy.budgets.askBody}</Text>
      <Button label={copy.budgets.askAllow} testID="alert-ask-allow" onPress={() => { close(); onAnswer(true); }} />
      <Button label={copy.budgets.askNotNow} variant="text" onGlass testID="alert-ask-later" onPress={() => { close(); onAnswer(false); }} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12 } });
