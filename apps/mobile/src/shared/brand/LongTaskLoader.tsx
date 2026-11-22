import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { textStyle } from '../theme/typography';
import { useReducedMotion } from '../a11y/useReducedMotion';
import { CoinFlip } from './CoinFlip';

/**
 * The loader for work that takes a moment (SCR-31): the coin flips (a still coin when motion is reduced) beside what is happening.
 * The message is a polite live region, so TalkBack says it once when it appears and again only when it changes.
 */
export function LongTaskLoader({ message, detail, children }: { message: string; detail?: string; children?: React.ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  return (
    <View testID="long-task-loader" style={styles.wrap}>
      <CoinFlip size={72} playing reducedMotion={reduced} />
      <Text accessibilityLiveRegion="polite" testID="long-task-message" style={[textStyle('body-medium'), styles.center, { color: theme.color('text-primary') }]}>
        {message}
      </Text>
      {detail ? <Text style={[textStyle('caption'), styles.center, { color: theme.color('text-secondary') }]}>{detail}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  center: { textAlign: 'center' },
});
