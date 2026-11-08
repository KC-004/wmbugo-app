import { useState, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CalendarCheck, ChartBar, House, ListBullets } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { navLayout, RAIL_WIDTH, TAB_SLOT } from '../../shared/feedback/layout';
import { Glass } from '../../shared/theme/Glass';
import { Icon, type IconComponent } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { FocusRing, useFocusRing } from '../../shared/ui/FocusRing';
import { AddButton, type AddButtonRef } from './AddButton';
import { markTabPress } from './navTiming';

export const TAB_ROUTES = ['Home', 'Activity', 'Insights', 'Plan'] as const;
export type TabRoute = (typeof TAB_ROUTES)[number];

const TABS: Record<TabRoute, { label: string; icon: IconComponent }> = {
  Home: { label: copy.nav.home, icon: House },
  Activity: { label: copy.nav.activity, icon: ListBullets },
  Insights: { label: copy.nav.insights, icon: ChartBar },
  Plan: { label: copy.nav.plan, icon: CalendarCheck },
};

/**
 * Bottom navigation. Below 600dp a glass bar: Home, Activity, the ＋, Insights, Plan, with outline
 * icons when inactive and a filled accent icon plus a Medium label when active. From 600dp an 80dp
 * solid rail with the ＋ at the top. Slots are at least 64 x 56dp; there are no badges; a long press
 * shows the tab's label in a tooltip.
 */
export function TabBar({ state, navigation, onAdd, addRef }: BottomTabBarProps & { onAdd: () => void; addRef?: AddButtonRef }) {
  const { width } = useWindowDimensions();
  const nav = navLayout(width);
  const rail = nav.kind === 'rail';
  const insets = useSafeAreaInsets();

  const slot = (name: TabRoute) => {
    const index = state.routes.findIndex((r) => r.name === name);
    const route = state.routes[index]!;
    return (
      <TabSlot
        key={name}
        name={name}
        focused={state.index === index}
        rail={rail}
        onPress={() => {
          markTabPress(name);
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
        }}
      />
    );
  };

  if (rail) {
    return <Rail top={insets.top}>{[<AddButton key="add" onPress={onAdd} buttonRef={addRef} />, ...TAB_ROUTES.map(slot)]}</Rail>;
  }
  return (
    <Glass testID="tab-bar" style={[styles.bar, { marginBottom: 8 + insets.bottom }]}>
      {slot('Home')}
      {slot('Activity')}
      <View style={styles.addSlot}>
        <AddButton onPress={onAdd} buttonRef={addRef} />
      </View>
      {slot('Insights')}
      {slot('Plan')}
    </Glass>
  );
}

function Rail({ children, top }: { children: React.ReactNode; top: number }) {
  const theme = useTheme();
  return (
    <View testID="nav-rail" style={[styles.rail, { paddingTop: 16 + top, backgroundColor: theme.color('bg-surface'), borderRightColor: theme.color('border-hairline') }]}>
      {children}
    </View>
  );
}

function TabSlot({ name, focused, rail, onPress }: { name: TabRoute; focused: boolean; rail: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { focused: ring, onFocus, onBlur } = useFocusRing(!rail);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );
  const { label, icon } = TABS[name];
  // On glass the inks are on-glass; on the rail's solid surface they are the normal text colours.
  const active = rail ? 'accent-primary' : 'on-glass-accent';
  const inactive = rail ? 'text-secondary' : 'on-glass-secondary';
  const ink = focused ? active : inactive;
  return (
    <Pressable
      testID={`tab-${name}`}
      {...controlA11y({ label, role: 'tab', selected: focused })}
      onPress={onPress}
      onLongPress={() => {
        setHint(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), 2000);
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      style={styles.slot}>
      <FocusRing focused={ring} onGlass={!rail} radius={12}>
        <View style={styles.slotInner}>
          <Icon icon={icon} selected={focused} color={ink} />
          <Text
            maxFontSizeMultiplier={1.3}
            adjustsFontSizeToFit
            numberOfLines={1}
            minimumFontScale={1}
            style={[textStyle('tag'), { color: theme.color(ink), fontFamily: focused ? 'Inter_500Medium' : 'Inter_400Regular' }]}>
            {label}
          </Text>
        </View>
      </FocusRing>
      {hint ? (
        <View testID={`tab-hint-${name}`} accessibilityLiveRegion="polite" style={[styles.hint, { backgroundColor: theme.color('text-primary') }]}>
          <Text style={[textStyle('caption'), { color: theme.color('bg-canvas') }]}>{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', minHeight: 72, marginHorizontal: 8, marginBottom: 8 },
  addSlot: { minWidth: TAB_SLOT.minWidth, alignItems: 'center', justifyContent: 'center' },
  slot: { flex: 1, minWidth: TAB_SLOT.minWidth, minHeight: TAB_SLOT.minHeight, alignItems: 'center', justifyContent: 'center' },
  slotInner: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  rail: { width: RAIL_WIDTH, alignItems: 'center', paddingTop: 16, gap: 8, borderRightWidth: 1 },
  hint: { position: 'absolute', top: 2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
});
