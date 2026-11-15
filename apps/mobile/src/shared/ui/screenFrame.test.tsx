import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider, type ThemeMode } from '../theme/ThemeProvider';
import { ScreenFrame } from './ScreenFrame';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  while (live.length) act(() => live.pop()!.unmount());
});
const mount = (mode: ThemeMode) => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } }}>
        <ThemeProvider initialMode={mode}>
          <ScreenFrame testID="frame">
            <Text>content</Text>
          </ScreenFrame>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  live.push(r);
  return r;
};
const ids = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);

describe('ScreenFrame', () => {
  it('draws the soft glow behind every screen in dark, behind the content', () => {
    const r = mount('dark');
    expect(ids(r, 'screen-glows')).toHaveLength(1);
    expect(ids(r, 'frame')[0]!.findAll((n) => n.type === Text)).toHaveLength(1);
  });

  it('has no glow in light', () => {
    expect(ids(mount('light'), 'screen-glows')).toHaveLength(0);
  });

  it('keeps the status bar inset above the content', () => {
    const r = mount('dark');
    const style = ([] as object[]).concat(ids(r, 'frame')[0]!.props.style).flat().reduce<Record<string, unknown>>((acc, s) => ({ ...acc, ...(s as object) }), {});
    expect(style.paddingTop).toBe(24);
  });
});
