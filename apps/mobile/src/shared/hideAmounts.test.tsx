import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, budgetStatus } from '@wmbugo/core';
import { SettingsBridge } from '../features/settings/SettingsBridge';
import type { SettingsApi, SettingsData } from '../features/settings/settingsApi';
import { amountLabel, spokenAmount, spokenNumber } from './a11y/labels';
import { createQueryClient } from './queryClient';
import { isAmountsHidden, useAmountsStore } from './state/amountsHidden';
import { ThemeProvider } from './theme/ThemeProvider';
import { Amount } from './ui/Amount';
import { LimitBar } from './ui/LimitBar';
import { foreignMoneyText, moneyText } from './ui/moneyText';
import { looksLikeMoney, moneyLeaks } from './moneyLeaks.testkit';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  useAmountsStore.getState().setHidden(false);
});

function render(node: React.ReactElement) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={createQueryClient()}>
        <ThemeProvider>{node}</ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  return r;
}
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const amountNode = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text)[0]!;

describe('Hide amounts (Story 5.3, HOM-008)', () => {
  it('masks to the currency symbol and exactly four dots in the same style, whatever the value', () => {
    useAmountsStore.getState().setHidden(true);
    const small = render(<Amount amountMinor={6000} currency="INR" direction="neutral" role="headline" locale="en-IN" />);
    const big = render(<Amount amountMinor={1_186_000_000} currency="INR" direction="neutral" role="headline" locale="en-IN" />);
    expect(texts(small)).toEqual(['₹ ••••']);
    expect(texts(big)).toEqual(['₹ ••••']);
    expect(amountNode(small).props.style).toEqual(amountNode(big).props.style);
    expect(texts(render(<Amount amountMinor={500} currency="SGD" direction="neutral" locale="en-SG" />))).toEqual(['S$ ••••']);
  });

  it('keeps the direction cue: income reads +₹ ••••, an expense stays unsigned', () => {
    useAmountsStore.getState().setHidden(true);
    expect(texts(render(<Amount amountMinor={500000} currency="INR" direction="income" locale="en-IN" />))).toEqual(['+₹ ••••']);
    expect(texts(render(<Amount amountMinor={500000} currency="INR" direction="expense" locale="en-IN" />))).toEqual(['₹ ••••']);
  });

  it('labels the node Amount hidden and speaks no figure', () => {
    useAmountsStore.getState().setHidden(true);
    const r = render(<Amount amountMinor={500000} currency="INR" direction="income" locale="en-IN" />);
    expect(amountNode(r).props.accessibilityLabel).toMatch(/amount hidden/i);
    expect(moneyLeaks(r)).toEqual([]);
  });

  it('an explicit hidden prop wins over the setting (the Add sheet keypad shows what is being typed)', () => {
    useAmountsStore.getState().setHidden(true);
    expect(texts(render(<Amount amountMinor={1250} currency="SGD" direction="neutral" hidden={false} locale="en-SG" />))).toEqual(['S$12.50']);
  });

  it('flips every mounted amount in place when the flag changes', () => {
    const r = render(<Amount amountMinor={1250} currency="SGD" direction="neutral" locale="en-SG" />);
    expect(texts(r)).toEqual(['S$12.50']);
    act(() => useAmountsStore.getState().setHidden(true));
    expect(texts(r)).toEqual(['S$ ••••']);
    act(() => useAmountsStore.getState().setHidden(false));
    expect(texts(r)).toEqual(['S$12.50']);
  });

  it('spoken labels and money in sentences follow the flag', () => {
    expect(spokenAmount(500000, 'INR', 'en-IN')).toBe('5,000 rupees');
    expect(moneyText(500000, 'INR', 'en-IN')).toBe('₹5,000.00');
    useAmountsStore.getState().setHidden(true);
    expect(isAmountsHidden()).toBe(true);
    expect(spokenAmount(500000, 'INR', 'en-IN')).toBe('amount hidden');
    expect(spokenNumber(500000, 'INR', 'en-IN')).toBe('amount hidden');
    expect(moneyText(500000, 'INR', 'en-IN')).toBe('₹ ••••');
    expect(amountLabel({ amountMinor: 500000, currency: 'INR', kind: 'spent' })).toBe('Spent, amount hidden');
    // An explicit choice still wins.
    expect(moneyText(500000, 'INR', 'en-IN', false)).toBe('₹5,000.00');
  });

  it('a foreign amount in plain text masks too', () => {
    expect(foreignMoneyText('USD', 1299, 2)).toBe('USD 12.99');
    useAmountsStore.getState().setHidden(true);
    expect(foreignMoneyText('USD', 1299, 2)).toBe('USD ••••');
    expect(looksLikeMoney(foreignMoneyText('USD', 1299, 2))).toBe(false);
  });

  it('a limit bar draws no fill, no percentage and no amounts, and keeps the days', () => {
    useAmountsStore.getState().setHidden(true);
    const status = budgetStatus({ usedMinor: 340000, targetMinor: 400000, period: { start: '2026-11-01', end: '2026-11-30' }, today: '2026-11-18' });
    const r = render(<LimitBar name="Groceries" status={status} currency="INR" locale="en-IN" testID="bar" />);
    expect(r.root.findAll((n) => n.props.testID === 'bar-fill')).toHaveLength(0);
    expect(moneyLeaks(r)).toEqual([]);
    expect(texts(r).join(' ')).toMatch(/days? left/);
  });

  it('the money detector recognises money and leaves dates, counts and days alone', () => {
    for (const s of ['₹5,000.00', 'S$12.50', '5,000 rupees', '85% used', '$1', '+₹ 1', '5.000,00 €', '1 234 zł', '500 INR']) expect(looksLikeMoney(s)).toBe(true);
    for (const s of ['₹ ••••', '3 to check', '12 days left', 'Sat 7 Nov', '1–30 Nov', 'Amount hidden']) expect(looksLikeMoney(s)).toBe(false);
  });
});

describe('Hide amounts survives closing the app (SettingsBridge)', () => {
  const data = (hide: boolean): SettingsData => ({ settings: { ...DEFAULT_SETTINGS, hideAmounts: hide }, profile: {}, hasEntries: false }) as unknown as SettingsData;
  const api = (hide: boolean): SettingsApi => ({ load: async () => data(hide) }) as unknown as SettingsApi;
  const mount = async (hide: boolean) => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={createQueryClient()}>
          <ThemeProvider>
            <SettingsBridge api={api(hide)}>
              <Amount amountMinor={500000} currency="INR" direction="neutral" locale="en-IN" />
            </SettingsBridge>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await act(async () => new Promise((res) => setTimeout(res, 0)));
    return r;
  };

  it('applies the saved setting on opening, so the app starts masked', async () => {
    useAmountsStore.getState().setHidden(false); // a freshly opened process
    const r = await mount(true);
    expect(texts(r)).toEqual(['₹ ••••']);
    expect(isAmountsHidden()).toBe(true);
  });

  it('keeps amounts hidden when the saved choice cannot be read, rather than showing money the user may have hidden', async () => {
    useAmountsStore.getState().setHidden(false);
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={createQueryClient()}>
          <ThemeProvider>
            <SettingsBridge api={{ load: async () => { throw new Error('no db'); } } as unknown as SettingsApi}>
              <Amount amountMinor={500000} currency="INR" direction="neutral" locale="en-IN" />
            </SettingsBridge>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await act(async () => new Promise((res) => setTimeout(res, 0)));
    expect(texts(r)).toEqual(['₹ ••••']);
  });

  it('leaves the amounts showing when the setting is off', async () => {
    expect(texts(await mount(false))).toEqual(['₹5,000.00']);
  });
});
