import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BarChart, type BarDatum } from './BarChart';
import { moneyLeaks } from '../moneyLeaks.testkit';
import { useAmountsStore } from '../state/amountsHidden';
import { ThemeProvider } from '../theme/ThemeProvider';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  useAmountsStore.getState().setHidden(false);
});

const DATA: BarDatum[] = [
  { id: 'food', label: 'Food & Drinks', valueMinor: 420_000, sharePercent: 32 },
  { id: 'rent', label: 'Housing', valueMinor: 800_000, sharePercent: 61 },
  { id: 'misc', label: 'Other', valueMinor: 90_000, sharePercent: 7 },
];

function mount(over: Partial<React.ComponentProps<typeof BarChart>> = {}) {
  const onToggle = jest.fn();
  const onPress = jest.fn();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider>
        <BarChart title="Top categories" scope="This period" data={DATA} currency="INR" locale="en-IN" orientation="horizontal" table={false} onToggleTable={onToggle} onPressDatum={onPress} {...over} />
      </ThemeProvider>,
    );
  });
  live.push(r);
  return { r, onToggle, onPress };
}
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
const press = (r: ReactTestRenderer, id: string) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());

describe('BarChart (Story 5.5)', () => {
  it('renders the scope label first, a direct label on every bar, and sizes the fills against the largest', () => {
    const { r } = mount();
    const all = texts(r);
    expect(all[0]).toBe('Top categories · This period');
    expect(all).toEqual(expect.arrayContaining(['₹4,200.00', '₹8,000.00', '₹900.00']));
    const width = (id: string) => StyleSheet.flatten(host(r, `bar-chart-fill-${id}`)[0]!.props.style).width;
    expect([width('rent'), width('food'), width('misc')]).toEqual(['100%', '53%', '11%']);
  });

  it('every bar is one button that reads its name and amount, and runs the drill-down', () => {
    const { r, onPress } = mount();
    expect(host(r, 'bar-chart-bar-food')[0]!.props.accessibilityLabel).toBe('Food & Drinks, 4,200 rupees, 32 percent');
    press(r, 'bar-chart-bar-food');
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'food' }));
  });

  it('View as table is a text button, and the table has a header row, one node per row and the same drill-down', () => {
    const a = mount();
    expect(texts(a.r)).toContain('View as table');
    press(a.r, 'bar-chart-toggle');
    expect(a.onToggle).toHaveBeenCalled();
    const t = mount({ table: true });
    expect(texts(t.r)).toContain('View as chart');
    expect(host(t.r, 'bar-chart-table-head')[0]!.props.accessibilityRole).toBe('header');
    expect(host(t.r, 'bar-chart-table-head')[0]!.props.accessibilityLabel).toBe('Name, Amount, Share');
    expect(host(t.r, 'bar-chart-row-food')[0]!.props.accessibilityLabel).toBe('Food & Drinks, 4,200 rupees, 32 percent');
    expect(texts(t.r)[0]).toBe('Top categories · This period'); // the scope is read first
    expect(texts(t.r)).toContain('32%');
    press(t.r, 'bar-chart-row-rent');
    expect(t.onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'rent' }));
  });

  it('masked: no fill, no percent column, labels and names stay, and nothing says an amount', () => {
    useAmountsStore.getState().setHidden(true);
    const c = mount();
    expect(host(c.r, 'bar-chart-fill-food')).toHaveLength(0);
    expect(texts(c.r)).toEqual(expect.arrayContaining(['₹ ••••', 'Food & Drinks']));
    expect(moneyLeaks(c.r)).toEqual([]);
    expect(host(c.r, 'bar-chart-bar-food')[0]!.props.accessibilityLabel).toBe('Food & Drinks, amount hidden');
    const t = mount({ table: true });
    expect(texts(t.r)).not.toContain('Share');
    expect(texts(t.r).some((x) => /%/.test(x))).toBe(false);
    expect(host(t.r, 'bar-chart-table-head')[0]!.props.accessibilityLabel).toBe('Name, Amount');
    expect(moneyLeaks(t.r)).toEqual([]);
  });

  it('a bar with any spending is always visible, and only zero shows nothing', () => {
    const { r } = mount({ data: [{ id: 'big', label: 'Big', valueMinor: 10_000_000 }, { id: 'tiny', label: 'Tiny', valueMinor: 1 }, { id: 'none', label: 'None', valueMinor: 0 }] });
    expect(StyleSheet.flatten(host(r, 'bar-chart-fill-tiny')[0]!.props.style).width).toBe('2%');
    expect(StyleSheet.flatten(host(r, 'bar-chart-fill-none')[0]!.props.style).width).toBe('0%');
  });

  it('vertical bars keep their day names, size against the largest day and never go negative', () => {
    const days: BarDatum[] = [
      { id: 'd1', label: 'Mon', valueMinor: 0 },
      { id: 'd2', label: 'Today', valueMinor: 250_000, spokenLabel: 'Today' },
    ];
    const { r } = mount({ data: days, orientation: 'vertical', title: 'Spending, last 7 days', scope: 'Last 7 days' });
    expect(texts(r)).toEqual(expect.arrayContaining(['Mon', 'Today', '₹0.00', '₹2,500.00']));
    expect(StyleSheet.flatten(host(r, 'bar-chart-fill-d2')[0]!.props.style).height).toBe('100%');
    for (const t of texts(r)) expect(t).not.toMatch(/[-−]/);
  });
});
