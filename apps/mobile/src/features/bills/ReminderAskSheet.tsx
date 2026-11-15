import { StyleSheet, Text, View } from 'react-native';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';

/**
 * The one-time just-in-time ask for bill reminders (Story 6.5): shown after a bill is saved with a reminder on, while the
 * notification permission is still undetermined, and never repeated. Nothing is asked during onboarding.
 */
export function ReminderAskSheet({ onAnswer, close }: { onAnswer: (allow: boolean) => void; close: () => void }) {
  const theme = useTheme();
  return (
    <View testID="reminder-ask" style={styles.root}>
      <Text style={[textStyle('body'), { color: theme.color('on-glass-primary') }]}>{copy.bills.askBody}</Text>
      <Button label={copy.bills.askAllow} testID="reminder-ask-allow" onPress={() => { close(); onAnswer(true); }} />
      <Button label={copy.bills.askNotNow} variant="text" onGlass testID="reminder-ask-later" onPress={() => { close(); onAnswer(false); }} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12 } });
