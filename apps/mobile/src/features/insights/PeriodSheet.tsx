import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { validateCustomRange, type PeriodPreset } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { presetName } from './insightsApi';

const i = copy.insights;

/**
 * The Period sheet (Story 7.2): the presets as radio rows, `This month` always among them, and `Custom` with an inclusive
 * start and end date. A bad range keeps what was typed and says why next to the field.
 */
export function PeriodSheet({ presets, selected, today, custom, onPick, close }: { presets: readonly PeriodPreset[]; selected: PeriodPreset; today: string; custom?: { start: string; end: string }; onPick: (preset: PeriodPreset, custom?: { start: string; end: string }) => void; close: () => void }) {
  const theme = useTheme();
  const [showCustom, setShowCustom] = useState(selected === 'custom');
  const [start, setStart] = useState(custom?.start ?? '');
  const [end, setEnd] = useState(custom?.end ?? '');
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<ComponentRef<typeof TextInput>>(null);
  const ink = { color: theme.color('on-glass-primary') };

  const apply = () => {
    const v = validateCustomRange(start.trim(), end.trim(), today);
    if (v === 'ok') {
      onPick('custom', { start: start.trim(), end: end.trim() });
      return close();
    }
    setError(v === 'END_BEFORE_START' ? i.errEndBeforeStart : v === 'AFTER_TODAY' ? i.errAfterToday : i.errDate);
    startRef.current?.focus();
  };

  return (
    <View testID="period-sheet" style={styles.gap} accessibilityRole="radiogroup">
      {presets.map((p) => (
        <Pressable
          key={p}
          testID={`period-${p}`}
          {...controlA11y({ label: presetName(p), role: 'radio', selected: p === selected })}
          onPress={() => {
            if (p === 'custom') return setShowCustom(true);
            onPick(p);
            close();
          }}
          style={styles.row}>
          <Text style={[textStyle('body'), ink]}>{`${p === selected ? '● ' : '○ '}${presetName(p)}`}</Text>
        </Pressable>
      ))}
      {showCustom ? (
        <View style={styles.gap}>
          <TextInput ref={startRef} testID="period-custom-start" accessibilityLabel={i.customStart} placeholder={i.customStart} placeholderTextColor={theme.color('on-glass-secondary')} value={start} onChangeText={(t) => { setStart(t); setError(null); }} style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]} />
          <TextInput testID="period-custom-end" accessibilityLabel={i.customEnd} placeholder={i.customEnd} placeholderTextColor={theme.color('on-glass-secondary')} value={end} onChangeText={(t) => { setEnd(t); setError(null); }} style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('on-glass-secondary') }]} />
          <Text style={[textStyle('caption'), { color: theme.color('on-glass-secondary') }]}>{i.customHint}</Text>
          {error ? <Text testID="period-custom-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), ink]}>{error}</Text> : null}
          <Button label={i.customApply} testID="period-custom-apply" onPress={apply} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  row: { minHeight: layout.touchMin, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
});
