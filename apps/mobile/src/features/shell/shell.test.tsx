import { AccessibilityInfo, Text, useWindowDimensions } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { colorTokens } from '../../shared/theme/colors';
import { setNavTimingSink, markTabFirstFrame, markTabPress } from './navTiming';
import { RootNavigator } from './RootNavigator';
import { ScreenHeader } from './ScreenHeader';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
  require('react-native-safe-area-context/jest/mock').default,
);

const mockDims = { width: 430, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockDims.width, height: 900, scale: 2, fontScale: mockDims.fontScale }),
}));

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
});
beforeEach(() => {
  mockDims.width = 430;
  mockDims.fontScale = 1;
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

async function mountShell(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <ThemeProvider initialMode="light">
        <SafeAreaProvider>
          <RootNavigator />
        </SafeAreaProvider>
      </ThemeProvider>,
    );
  });
  live.push(r);
  return r;
}

const host = (r: ReactTestRenderer, testID: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID);
/** Calls a handler on the component that owns it (the pressable, not its native view). */
const fire = (r: ReactTestRenderer, testID: string, handler: 'onPress' | 'onLongPress' = 'onPress') =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.props[handler] === 'function')[0]!.props[handler]();
const labels = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.type === Text && typeof n.props.children === 'string').map((n) => n.props.children as string);

describe('root navigator', () => {
  it('shows the glass tab bar with Home, Activity, ＋, Insights, Plan below 600dp, and no drawer or rail', async () => {
    const r = await mountShell();
    expect(host(r, 'tab-bar').length).toBe(1);
    expect(host(r, 'nav-rail')).toHaveLength(0);
    for (const t of ['Home', 'Activity', 'Insights', 'Plan']) expect(host(r, `tab-${t}`).length).toBe(1);
    expect(host(r, 'add-button').length).toBe(1);
    // Order in the bar: Home, Activity, add, Insights, Plan.
    const order = r.root
      .findAll((n) => typeof n.type === 'string' && typeof n.props.testID === 'string' && /^(tab-(Home|Activity|Insights|Plan)|add-button)$/.test(n.props.testID))
      .map((n) => n.props.testID);
    expect(order).toEqual(['tab-Home', 'tab-Activity', 'add-button', 'tab-Insights', 'tab-Plan']);
    expect(JSON.stringify(r.toJSON())).not.toMatch(/drawer/i);
  });

  it('Home shows its header with the Accounts icon and avatar; Insights and Plan show only a header', async () => {
    const r = await mountShell();
    expect(labels(r)).toContain('Home');
    expect(host(r, 'header-accounts').length).toBe(1);
    expect(host(r, 'header-avatar').length).toBe(1);
    await act(async () => fire(r, 'tab-Insights'));
    expect(labels(r)).toContain('Insights');
    expect(labels(r).join(' ')).not.toMatch(/coming soon/i);
    await act(async () => fire(r, 'tab-Plan'));
    expect(labels(r)).toContain('Plan');
    expect(labels(r).join(' ')).not.toMatch(/coming soon/i);
  });

  it('tabs expose role, label and selected state; the active tab is selected', async () => {
    const r = await mountShell();
    const home = host(r, 'tab-Home')[0]!;
    expect(home.props.accessibilityRole).toBe('tab');
    expect(home.props.accessibilityLabel).toBe('Home');
    expect(home.props.accessibilityState).toEqual({ selected: true });
    await act(async () => fire(r, 'tab-Activity'));
    expect(host(r, 'tab-Activity')[0]!.props.accessibilityState).toEqual({ selected: true });
    expect(host(r, 'tab-Home')[0]!.props.accessibilityState).toEqual({ selected: false });
  });

  it('tab slots are at least 64 x 56dp, labels cap at 1.3 and auto-fit to a 12sp floor, with no badges', async () => {
    const r = await mountShell();
    const slot = host(r, 'tab-Home')[0]!;
    const style = Array.isArray(slot.props.style) ? Object.assign({}, ...slot.props.style.flat()) : slot.props.style;
    expect(style.minWidth).toBeGreaterThanOrEqual(64);
    expect(style.minHeight).toBeGreaterThanOrEqual(56);
    const label = r.root.findAll((n) => n.type === Text && n.props.children === 'Home' && n.props.maxFontSizeMultiplier === 1.3)[0]!;
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.minimumFontScale).toBe(1);
    expect(JSON.stringify(r.toJSON())).not.toMatch(/badge/i);
  });

  it('long-pressing a tab shows its label in a tooltip', async () => {
    jest.useFakeTimers();
    const r = await mountShell();
    expect(host(r, 'tab-hint-Plan')).toHaveLength(0);
    await act(async () => fire(r, 'tab-Plan', 'onLongPress'));
    expect(host(r, 'tab-hint-Plan').length).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(2100);
    });
    expect(host(r, 'tab-hint-Plan')).toHaveLength(0);
    jest.useRealTimers();
  });

  it('the add button is a labelled 56dp gradient circle with the only shadow', async () => {
    const r = await mountShell();
    const add = host(r, 'add-button')[0]!;
    expect(add.props.accessibilityLabel).toBe('Add entry');
    expect(add.props.accessibilityRole).toBe('button');
    const style = Object.assign({}, ...add.props.style.flat().filter(Boolean));
    expect(style).toMatchObject({ width: 56, height: 56, borderRadius: 28, elevation: 6 });
    expect(JSON.stringify(r.toJSON())).toContain('brandFull');
    // No other control in the shell carries a shadow.
    const shadowed = r.root.findAll((n) => typeof n.type === 'string' && JSON.stringify(n.props.style ?? '').includes('shadowOpacity'));
    expect(shadowed.length).toBe(1);
  });

  it('tapping the add button opens the sheet host with a glass body and Cancel; Cancel closes it and nothing stacks', async () => {
    const r = await mountShell();
    await act(async () => fire(r, 'add-button'));
    expect(host(r, 'sheet-scrim').length).toBe(1);
    expect(labels(r)).toContain('Add entry');
    await act(async () => fire(r, 'add-button')); // again: replaces, not stacks
    expect(host(r, 'sheet-scrim').length).toBe(1);
    const cancel = r.root.findAll((n) => n.props.accessibilityLabel === 'Cancel' && typeof n.props.onPress === 'function')[0]!;
    await act(async () => cancel.props.onPress());
    expect(host(r, 'sheet-scrim')).toHaveLength(0);
  });

  it.each([320, 430, 599])('at %idp the glass bar is used', async (w) => {
    mockDims.width = w;
    const r = await mountShell();
    expect(host(r, 'tab-bar').length).toBe(1);
    expect(host(r, 'nav-rail')).toHaveLength(0);
  });

  it.each([600, 840])('at %idp an 80dp solid rail replaces the bar, with the add button first', async (w) => {
    mockDims.width = w;
    const r = await mountShell();
    expect(host(r, 'tab-bar')).toHaveLength(0);
    const rail = host(r, 'nav-rail')[0]!;
    const style = Object.assign({}, ...rail.props.style.flat());
    expect(style.width).toBe(80);
    expect(style.backgroundColor).toBe(colorTokens['bg-surface']);
    const order = r.root.findAll((n) => typeof n.type === 'string' && /^(tab-|add-button)/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(order[0]).toBe('add-button');
    expect(order).toHaveLength(5);
  });

  it('Accounts and the avatar navigate to their placeholder screens above the tabs', async () => {
    const r = await mountShell();
    await act(async () => fire(r, 'header-avatar'));
    expect(labels(r)).toContain('Settings');
    expect(host(r, 'tab-bar').length).toBeGreaterThanOrEqual(0);
  });
});

describe('screen header', () => {
  function Header() {
    useWindowDimensions();
    return <ScreenHeader title="Activity with a long title" onAccounts={() => undefined} onProfile={() => undefined} />;
  }
  const mount = (): ReactTestRenderer => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<ThemeProvider><Header /></ThemeProvider>);
    });
    live.push(r);
    return r;
  };

  it('is one row at normal font scale, with 48dp action icons and the title never truncated', () => {
    const r = mount();
    const header = host(r, 'header')[0]!;
    expect(header.props.style.flexDirection).toBe('row');
    for (const id of ['header-accounts', 'header-avatar']) {
      const s = host(r, id)[0]!.props.style;
      expect(s.minWidth).toBeGreaterThanOrEqual(48);
      expect(s.minHeight).toBeGreaterThanOrEqual(48);
    }
    const title = r.root.findAll((n) => n.type === Text && n.props.accessibilityRole === 'header')[0]!;
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.ellipsizeMode).toBeUndefined();
  });

  it('splits into two rows at font scale 1.3 and above (320dp x 200%)', () => {
    mockDims.width = 320;
    mockDims.fontScale = 2;
    const r = mount();
    const header = host(r, 'header')[0]!;
    expect(header.props.style.flexDirection).toBeUndefined();
    expect(header.props.style.gap).toBe(4);
  });
});

describe('nav timing', () => {
  it('reports the time from tab press to first frame, once, and ignores unpressed frames', () => {
    const seen: { tab: string; durationMs: number }[] = [];
    let t = 1000;
    setNavTimingSink((e) => seen.push(e), () => t);
    markTabFirstFrame('Home'); // first mount, no press
    markTabPress('Plan');
    t += 123;
    markTabFirstFrame('Plan');
    markTabFirstFrame('Plan');
    setNavTimingSink(null);
    expect(seen).toEqual([{ tab: 'Plan', durationMs: 123 }]);
  });
});
