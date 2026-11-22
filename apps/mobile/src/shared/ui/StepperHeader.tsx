import { StyleSheet, Text, View } from 'react-native';
import { copy } from '../copy';
import { useTheme } from '../theme/ThemeProvider';
import { radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';

/** `Step 2 of 3` with the step's name and a bar of dots: for a flow of a few steps (the CSV import). Read as one sentence by TalkBack. */
export function StepperHeader({ step, total, title }: { step: number; total: number; title: string }) {
  const theme = useTheme();
  const line = copy.csvImport.stepOf.replace('{n}', String(step)).replace('{m}', String(total));
  return (
    <View testID="stepper" accessible accessibilityRole="header" accessibilityLabel={copy.csvImport.stepSpoken.replace('{n}', String(step)).replace('{m}', String(total)).replace('{title}', title)} style={styles.wrap}>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{line}</Text>
      <Text style={[textStyle('title'), { color: theme.color('text-primary') }]}>{title}</Text>
      <View style={styles.dots}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} testID={i < step ? 'stepper-dot-on' : 'stepper-dot-off'} style={[styles.dot, { backgroundColor: theme.color(i < step ? 'accent-primary' : 'border-hairline') }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot: { height: 6, flex: 1, borderRadius: radii.full },
});
