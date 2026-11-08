import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { announce } from '../a11y/announce';
import { useReducedMotion } from '../a11y/useReducedMotion';
import { PaperBoat } from '../brand/PaperBoat';
import { copy } from '../copy';
import { useTheme } from '../theme/ThemeProvider';
import { motion, radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';
import { Button } from '../ui/Button';

/** One-time tip bubble with a 48dp "Got it". Whether it shows is decided by TooltipController. */
export function Tooltip({ text, onAcknowledge }: { text: string; onAcknowledge: () => void }) {
  const theme = useTheme();
  return (
    <View
      testID="tooltip"
      accessibilityLiveRegion="polite"
      style={[styles.tip, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{text}</Text>
      <Button label={copy.common.gotIt} variant="text" onPress={onAcknowledge} testID="tooltip-got-it" />
    </View>
  );
}

/** Empty state: the paper boat, one sentence, one primary button. */
export function EmptyState({ sentence, actionLabel, onAction }: { sentence: string; actionLabel: string; onAction: () => void }) {
  const theme = useTheme();
  return (
    <View testID="empty-state" style={styles.empty}>
      <PaperBoat />
      <Text style={[textStyle('body'), styles.center, { color: theme.color('text-secondary') }]}>{sentence}</Text>
      <Button label={actionLabel} onPress={onAction} testID="empty-state-action" />
    </View>
  );
}

/**
 * Inline, never a dead end: the plain cause, "Nothing was saved", Retry and an alternative path.
 * It announces once, assertively, and hands focus to the first invalid field when there is one.
 */
export function ErrorBlock({
  cause,
  onRetry,
  alternative,
  focusFirstInvalid,
}: {
  cause: string;
  onRetry: () => void;
  alternative?: { label: string; onPress: () => void };
  focusFirstInvalid?: () => void;
}) {
  const theme = useTheme();
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    announce(`${cause}. ${copy.errors.nothingSaved}`);
    focusFirstInvalid?.();
  }, [cause, focusFirstInvalid]);
  return (
    <View testID="error-block" accessibilityLiveRegion="assertive" style={[styles.error, { borderColor: theme.color('semantic-warning') }]}>
      <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{cause}</Text>
      <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.errors.nothingSaved}</Text>
      <View style={styles.row}>
        <Button label={copy.common.tryAgain} variant="secondary" onPress={onRetry} />
        {alternative ? <Button label={alternative.label} variant="text" onPress={alternative.onPress} /> : null}
      </View>
    </View>
  );
}

/** A placeholder block while data loads: a muted shape, never a spinner. */
export function Skeleton({ width = '100%', height = 16 }: { width?: DimensionValue; height?: number }) {
  const theme = useTheme();
  return <View testID="skeleton" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height, borderRadius: radii.sm, backgroundColor: theme.color('bg-muted') }} />;
}

/** Shows `skeleton` while loading, then fades the values in over 200 ms (instantly under reduced motion). */
export function Reveal({ loading, skeleton, children }: { loading: boolean; skeleton: ReactNode; children: ReactNode }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(loading || reduced ? 1 : 0)).current;
  useEffect(() => {
    if (loading) return;
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: motion.standard, useNativeDriver: true }).start();
  }, [loading, reduced, opacity]);
  if (loading) return <>{skeleton}</>;
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  tip: { borderWidth: 1, borderRadius: radii.sm, padding: 12, gap: 4, alignItems: 'flex-start' },
  empty: { alignItems: 'center', gap: 16, padding: 24 },
  center: { textAlign: 'center' },
  error: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
