import type { ComponentRef, RefObject } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Plus } from 'phosphor-react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useSafeModeStore } from '../../shared/state/safeModeStore';
import { ADD_BUTTON_SIZE } from '../../shared/feedback/layout';
import { colorTokens } from '../../shared/theme/colors';
import { elevation } from '../../shared/theme/tokens';
import { FocusRing, useFocusRing } from '../../shared/ui/FocusRing';

/**
 * The ＋ button: a 56dp circle with the full 135 degree brand gradient and the app's only shadow.
 * The plus arms are white; where they sit on the gradient the contrast is at least 3.90:1 (non-text).
 */
export type AddButtonRef = RefObject<ComponentRef<typeof Pressable> | null>;

export function AddButton({ onPress, onSnap, buttonRef }: { onPress: () => void; /** Long-press and the TalkBack action `Snap receipt` (Story 10.7). */ onSnap?: () => void; buttonRef?: AddButtonRef }) {
  const { focused, onFocus, onBlur } = useFocusRing(true);
  // In safe mode nothing can be added: the button stays focusable and says why (Story 8.12).
  const safe = useSafeModeStore((s) => s.reason !== null);
  return (
    <FocusRing focused={focused} onGlass radius={ADD_BUTTON_SIZE / 2}>
      <Pressable
        ref={buttonRef}
        testID="add-button"
        {...controlA11y({ label: copy.nav.addEntry, role: 'button', ...(safe ? { disabled: true, hint: copy.safeMode.disabledAdd } : {}) })}
        onPress={safe ? undefined : onPress}
        {...(onSnap && !safe ? { onLongPress: onSnap, accessibilityActions: [{ name: 'snapReceipt', label: copy.receiptCamera.snapAction }], onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => { if (e.nativeEvent.actionName === 'snapReceipt') onSnap(); } } : {})}
        onFocus={onFocus}
        onBlur={onBlur}
        style={[styles.button, elevation.addButton, safe ? { opacity: 0.4 } : null]}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="brandFull" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={colorTokens['gradient-brand-start']} />
                <Stop offset="0.5" stopColor={colorTokens['gradient-brand-mid']} />
                <Stop offset="1" stopColor={colorTokens['gradient-brand-end']} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#brandFull)" />
          </Svg>
        </View>
        <Plus size={28} weight="bold" color={colorTokens['bg-surface']} />
      </Pressable>
    </FocusRing>
  );
}

const styles = StyleSheet.create({
  button: {
    width: ADD_BUTTON_SIZE,
    height: ADD_BUTTON_SIZE,
    borderRadius: ADD_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
