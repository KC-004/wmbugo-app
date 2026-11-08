import { AccessibilityInfo, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '../theme/ThemeProvider';
import { motion } from '../theme/tokens';
import { colorTokens } from '../theme/colors';
import { EmptyState, ErrorBlock, Reveal, Skeleton, Tooltip } from './Feedback';
import { headerSplits, navLayout, ADD_BUTTON_SIZE, TAB_SLOT } from './layout';
import { shouldDismiss, SheetHost, useSheet, type SheetSpec } from './SheetHost';
import { MIN_TOAST_MS, ToastController, type ToastDeps, type ToastState } from './toastController';
import { MemorySeenStore, TooltipController } from './tooltipController';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
});

const mount = (node: React.ReactNode): ReactTestRenderer => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<ThemeProvider>{node}</ThemeProvider>);
  });
  live.push(r);
  return r;
};

describe('navLayout', () => {
  it.each([
    [320, 'bar', 0, 320],
    [430, 'bar', 0, 430],
    [599, 'bar', 0, 599],
    [600, 'rail', 80, 520],
    [840, 'rail', 80, 600],
  ] as const)('width %i is a %s (rail %i, content %i)', (w, kind, rail, content) => {
    expect(navLayout(w)).toEqual({ kind, railWidth: rail, contentWidth: content });
  });

  it('splits the header at font scale 1.3 or on overflow', () => {
    expect(headerSplits(1)).toBe(false);
    expect(headerSplits(1.29)).toBe(false);
    expect(headerSplits(1.3)).toBe(true);
    expect(headerSplits(2)).toBe(true);
    expect(headerSplits(1, false)).toBe(true);
  });

  it('slots and the add button meet the size minimums', () => {
    expect(TAB_SLOT).toEqual({ minWidth: 64, minHeight: 56 });
    expect(ADD_BUTTON_SIZE).toBe(56);
  });
});

describe('ToastController', () => {
  function setup(over: Partial<ToastDeps> = {}) {
    let t = 0;
    const timers: { fn: () => void; at: number; id: number }[] = [];
    let id = 0;
    const states: (ToastState | null)[] = [];
    const announced: string[] = [];
    const deps: ToastDeps = {
      recommendedMs: async (ms) => ms,
      screenReaderOn: () => false,
      announce: (s) => announced.push(s),
      setTimer: (fn, ms) => {
        const h = { fn, at: t + ms, id: ++id };
        timers.push(h);
        return h.id;
      },
      clearTimer: (h) => {
        const i = timers.findIndex((x) => x.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
      now: () => t,
      onChange: (s) => states.push(s),
      ...over,
    };
    const advance = (ms: number) => {
      t += ms;
      for (const x of [...timers].filter((y) => y.at <= t)) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    };
    return { c: new ToastController(deps), advance, states, announced, timers };
  }

  it('announces politely with Undo available, and stays at least 10 seconds', async () => {
    const { c, advance, announced } = setup();
    await c.show({ message: 'Saved', undo: { label: 'Undo', onUndo: () => undefined } });
    expect(announced).toEqual(['Saved. Undo available']);
    advance(MIN_TOAST_MS - 1);
    expect(c.state).not.toBeNull();
    advance(1);
    expect(c.state).toBeNull();
  });

  it('never goes under 10 s even if the system recommends less, and honours a longer system value', async () => {
    const short = setup({ recommendedMs: async () => 3000 });
    await short.c.show({ message: 'a' });
    short.advance(9999);
    expect(short.c.state).not.toBeNull();
    const long = setup({ recommendedMs: async () => 30_000 });
    await long.c.show({ message: 'a' });
    long.advance(29_999);
    expect(long.c.state).not.toBeNull();
    long.advance(1);
    expect(long.c.state).toBeNull();
  });

  it('shows one at a time: a new toast replaces the old one and restarts the clock', async () => {
    const { c, advance } = setup();
    await c.show({ message: 'one' });
    advance(6000);
    await c.show({ message: 'two' });
    expect(c.state?.message).toBe('two');
    advance(6000);
    expect(c.state?.message).toBe('two');
    advance(4000);
    expect(c.state).toBeNull();
  });

  it('pauses on touch or focus and resumes with the time that was left', async () => {
    const { c, advance } = setup();
    await c.show({ message: 'x' });
    advance(4000);
    c.pause();
    advance(60_000);
    expect(c.state).not.toBeNull();
    c.resume();
    advance(5999);
    expect(c.state).not.toBeNull();
    advance(1);
    expect(c.state).toBeNull();
  });

  it('persists under a screen reader until dismissed', async () => {
    const { c, advance, timers } = setup({ screenReaderOn: () => true });
    await c.show({ message: 'x', undo: { label: 'Undo', onUndo: () => undefined } });
    expect(timers).toHaveLength(0);
    advance(600_000);
    expect(c.state).not.toBeNull();
    c.dismiss();
    expect(c.state).toBeNull();
  });

  it('Undo runs the action once and dismisses', async () => {
    const onUndo = jest.fn();
    const { c } = setup();
    await c.show({ message: 'x', undo: { label: 'Undo', onUndo } });
    c.undo();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(c.state).toBeNull();
    c.undo();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('a toast replaced while waiting for the system timeout is not armed', async () => {
    let release!: (ms: number) => void;
    const { c, advance, timers } = setup({ recommendedMs: () => new Promise((r) => (release = r)) });
    const first = c.show({ message: 'a' });
    c.dismiss();
    release(10_000);
    await first;
    expect(timers).toHaveLength(0);
    advance(20_000);
    expect(c.state).toBeNull();
  });

  it('falls back to 10 s if the system timeout lookup fails', async () => {
    const { c, advance } = setup({ recommendedMs: () => Promise.reject(new Error('x')) });
    await c.show({ message: 'a' });
    advance(10_000);
    expect(c.state).toBeNull();
  });
});

describe('TooltipController', () => {
  function setup(sheetOpen = false) {
    const store = new MemorySeenStore();
    const shown: (string | null)[] = [];
    const state = { open: sheetOpen };
    const c = new TooltipController(store, () => state.open, (id) => shown.push(id));
    return { c, store, shown, state };
  }

  it('shows at most one tip per session', async () => {
    const { c } = setup();
    expect(await c.request('a')).toBe(true);
    await c.acknowledge();
    expect(await c.request('b')).toBe(false);
  });

  it('never shows over an open sheet', async () => {
    const { c, state } = setup(true);
    expect(await c.request('a')).toBe(false);
    state.open = false;
    expect(await c.request('a')).toBe(true);
  });

  it('remembers "Got it" through the injected store and never shows it again', async () => {
    const a = setup();
    await a.c.request('long-press-add');
    await a.c.acknowledge();
    expect(a.store.seen.has('long-press-add')).toBe(true);
    const next = new TooltipController(a.store, () => false, () => undefined); // a new session
    expect(await next.request('long-press-add')).toBe(false);
    expect(await next.request('other')).toBe(true);
  });

  it('a sheet opening hides the tip without marking it seen', async () => {
    const { c, store, shown } = setup();
    await c.request('a');
    c.suspendForSheet();
    expect(shown).toEqual(['a', null]);
    expect(store.seen.size).toBe(0);
    expect(c.current).toBeNull();
  });

  it('acknowledge with nothing showing is a no-op', async () => {
    const { c, store } = setup();
    await c.acknowledge();
    expect(store.seen.size).toBe(0);
  });
});

describe('SheetHost', () => {
  function Opener({ spec, spec2 }: { spec: SheetSpec; spec2?: SheetSpec }) {
    const sheet = useSheet();
    return (
      <View>
        <Text testID="open" onPress={() => sheet.open(spec)}>open</Text>
        <Text testID="open2" onPress={() => spec2 && sheet.open(spec2)}>open2</Text>
        <Text testID="state">{sheet.openId ?? 'none'}</Text>
      </View>
    );
  }
  const spec = (id: string): SheetSpec => ({
    id,
    title: `Title ${id}`,
    body: () => <Text>{`Body ${id}`}</Text>,
    footer: (close) => <Text testID={`footer-${id}`} onPress={close}>Footer</Text>,
  });
  const press = (r: ReactTestRenderer, id: string) => act(() => r.root.findByProps({ testID: id }).props.onPress());
  const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text && typeof n.props.children === 'string').map((n) => n.props.children as string);

  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens a sheet with title, body, grabber, scrim and a solid sticky footer', () => {
    const r = mount(<SheetHost><Opener spec={spec('a')} /></SheetHost>);
    expect(r.root.findAllByProps({ testID: 'sheet-scrim' })).toHaveLength(0);
    press(r, 'open');
    expect(texts(r)).toEqual(expect.arrayContaining(['Title a', 'Body a', 'Footer']));
    expect(r.root.findAllByProps({ testID: 'sheet-scrim' }).length).toBeGreaterThan(0);
    const footer = r.root.findAll((n) => n.props.testID === 'sheet-footer' && typeof n.type === 'string')[0]!;
    const bg = (Array.isArray(footer.props.style) ? Object.assign({}, ...footer.props.style.flat().filter(Boolean)) : footer.props.style).backgroundColor;
    expect(bg).toBe(colorTokens['glass-fallback']);
  });

  it('the scrim and the footer action dismiss it; Back (onRequestClose) too', () => {
    const r = mount(<SheetHost><Opener spec={spec('a')} /></SheetHost>);
    press(r, 'open');
    act(() => r.root.findAllByProps({ testID: 'sheet-scrim' })[0]!.props.onPress());
    expect(r.root.findAllByProps({ testID: 'sheet-scrim' })).toHaveLength(0);
    press(r, 'open');
    press(r, 'footer-a');
    expect(r.root.findAllByProps({ testID: 'sheet-scrim' })).toHaveLength(0);
    press(r, 'open');
    const modal = r.root.findAll((n) => typeof n.props.onRequestClose === 'function')[0]!;
    act(() => modal.props.onRequestClose());
    expect(r.root.findAllByProps({ testID: 'sheet-scrim' })).toHaveLength(0);
  });

  it('opening a second sheet replaces the first instead of stacking', () => {
    const r = mount(<SheetHost><Opener spec={spec('a')} spec2={spec('b')} /></SheetHost>);
    press(r, 'open');
    press(r, 'open2');
    expect(texts(r)).toContain('Title b');
    expect(texts(r)).not.toContain('Title a');
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'sheet-scrim')).toHaveLength(1);
    expect(r.root.findByProps({ testID: 'state' }).props.children).toBe('b');
  });

  it('is modal for accessibility and the title is a header', () => {
    const r = mount(<SheetHost><Opener spec={spec('a')} /></SheetHost>);
    press(r, 'open');
    expect(r.root.findAllByProps({ accessibilityViewIsModal: true }).length).toBeGreaterThan(0);
    expect(r.root.findAll((n) => n.props.accessibilityRole === 'header' && n.props.children === 'Title a').length).toBeGreaterThan(0);
  });

  it('swipe down past 80dp or a fast fling dismisses', () => {
    expect(shouldDismiss(81, 0)).toBe(true);
    expect(shouldDismiss(10, 0.9)).toBe(true);
    expect(shouldDismiss(79, 0.2)).toBe(false);
  });

  it('reports open state and useSheet outside a host is an error', () => {
    const states: boolean[] = [];
    const r = mount(<SheetHost onOpenChange={(o) => states.push(o)}><Opener spec={spec('a')} /></SheetHost>);
    press(r, 'open');
    act(() => r.root.findAllByProps({ testID: 'sheet-scrim' })[0]!.props.onPress());
    expect(states).toEqual([false, true, false]);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => mount(<Opener spec={spec('a')} />)).toThrow('SheetHost');
    err.mockRestore();
  });
});

describe('feedback components', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  });
  afterEach(() => jest.restoreAllMocks());
  const all = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text && typeof n.props.children === 'string').map((n) => n.props.children as string);

  it('Tooltip has a 48dp Got it that acknowledges', () => {
    const ack = jest.fn();
    const r = mount(<Tooltip text="Long-press ＋ for more" onAcknowledge={ack} />);
    expect(all(r)).toEqual(['Long-press ＋ for more', 'Got it']);
    act(() => r.root.findByProps({ testID: 'tooltip-got-it' }).props.onPress());
    expect(ack).toHaveBeenCalled();
  });

  it('EmptyState is the boat, one sentence and one primary button', () => {
    const go = jest.fn();
    const r = mount(<EmptyState sentence="No goals yet. Saving for something?" actionLabel="Add a goal" onAction={go} />);
    expect(all(r)).toEqual(['No goals yet. Saving for something?', 'Add a goal']);
    expect(JSON.stringify(r.toJSON())).toContain('Svg');
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button' && n.props.accessible === true)).toHaveLength(1);
  });

  it('ErrorBlock shows cause, "Nothing was saved", Retry and an alternative; announces once, assertively, and focuses the field', () => {
    const retry = jest.fn();
    const alt = jest.fn();
    const focus = jest.fn();
    (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
    const r = mount(<ErrorBlock cause="Couldn't read this receipt." onRetry={retry} alternative={{ label: 'Enter it by hand', onPress: alt }} focusFirstInvalid={focus} />);
    expect(all(r)).toEqual(["Couldn't read this receipt.", 'Nothing was saved', 'Try again', 'Enter it by hand']);
    expect(r.root.findAllByProps({ accessibilityLiveRegion: 'assertive' }).length).toBeGreaterThan(0);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Couldn't read this receipt.. Nothing was saved");
    expect(focus).toHaveBeenCalledTimes(1);
    act(() => r.update(<ThemeProvider><ErrorBlock cause="Couldn't read this receipt." onRetry={retry} focusFirstInvalid={focus} /></ThemeProvider>));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  });

  it('Skeleton shows a muted block (no spinner) and Reveal swaps it for faded-in content within 150-250 ms', () => {
    const r = mount(<Reveal loading skeleton={<Skeleton />}><Text>Value</Text></Reveal>);
    expect(r.root.findAllByProps({ testID: 'skeleton' }).length).toBeGreaterThan(0);
    expect(JSON.stringify(r.toJSON())).not.toMatch(/ActivityIndicator/);
    act(() => r.update(<ThemeProvider><Reveal loading={false} skeleton={<Skeleton />}><Text>Value</Text></Reveal></ThemeProvider>));
    expect(all(r)).toEqual(['Value']);
    expect(motion.standard).toBeGreaterThanOrEqual(150);
    expect(motion.standard).toBeLessThanOrEqual(250);
  });
});
