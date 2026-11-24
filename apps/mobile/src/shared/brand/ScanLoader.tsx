import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { textStyle } from '../theme/typography';
import { useReducedMotion } from '../a11y/useReducedMotion';

const PHOTO_H = 220;

/**
 * The OCR variant of the long-task loader (SCR-31, Story 10.6): the photo with a scan line sweeping top to bottom, the title, a reassurance and
 * the progress as a polite live region. With Reduce motion the photo is still and a determinate bar shows the progress instead of the line.
 */
export function ScanLoader({ photoUri, title, reassurance, progressText, progress, photoLabel, children }: { photoUri: string | null; title: string; reassurance: string; progressText?: string; /** 0 to 1 */ progress: number; photoLabel: string; children?: React.ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, sweep]);
  return (
    <View testID="scan-loader" style={styles.wrap}>
      <View style={[styles.photo, { backgroundColor: theme.color('bg-muted') }]} accessible accessibilityLabel={photoLabel}>
        {photoUri ? <Image source={{ uri: `file://${photoUri}` }} style={styles.image} resizeMode="contain" /> : null}
        {reduced ? null : <Animated.View testID="scan-line" pointerEvents="none" style={[styles.line, { backgroundColor: theme.color('accent-primary'), transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, PHOTO_H - 3] }) }] }]} />}
      </View>
      <Text accessibilityRole="header" testID="scan-title" style={[textStyle('body-medium'), styles.center, { color: theme.color('text-primary') }]}>{title}</Text>
      <Text style={[textStyle('caption'), styles.center, { color: theme.color('text-secondary') }]}>{reassurance}</Text>
      {reduced ? (
        <View testID="scan-progress-bar" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={[styles.bar, { backgroundColor: theme.color('bg-muted') }]}>
          <View style={{ width: `${Math.round(progress * 100)}%`, height: 6, borderRadius: 3, backgroundColor: theme.color('accent-primary') }} />
        </View>
      ) : null}
      {progressText ? (
        <Text accessibilityLiveRegion="polite" testID="scan-progress" style={[textStyle('body'), styles.center, { color: theme.color('text-primary') }]}>{progressText}</Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  photo: { width: '100%', height: PHOTO_H, borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  line: { position: 'absolute', left: 0, right: 0, top: 0, height: 3, opacity: 0.85 },
  center: { textAlign: 'center' },
  bar: { width: '100%', height: 6, borderRadius: 3 },
});
