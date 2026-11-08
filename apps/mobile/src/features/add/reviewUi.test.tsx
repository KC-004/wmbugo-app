import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { colorTokens } from '../../shared/theme/colors';
import { SheetHost, useSheet } from '../../shared/feedback/SheetHost';
import { ToastHost, useToast } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { Amount } from '../../shared/ui/Amount';
import { Chip } from '../../shared/ui/Chip';
import { cleanup, fire, host, mountReady, quietAccessibility, settle, tap, texts } from './testKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

afterEach(cleanup);
beforeEach(quietAccessibility);

const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean));

describe('chips on the dark glass sheet', () => {
  it('use the on-glass ink in light mode (not dark slate on dark teal)', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider initialMode="light">
          <Chip label="Food" onGlass onPress={() => undefined} testID="c" />
        </ThemeProvider>,
      );
    });
    const label = r.root.findAll((n) => n.type === Text)[0]!;
    expect(flat(label.props.style).color).toBe(colorTokens['on-glass-primary']);
    act(() => r.unmount());
  });

  it('the typed amount on the sheet uses on-glass ink', async () => {
    const { r } = await mountReady();
    tap(r, '5');
    const amount = r.root.findAll((n) => n.type === Text && n.props.children === 'S$5.00')[0]!;
    expect(flat(amount.props.style).color).toBe(colorTokens['on-glass-primary']);
  });
});

describe('money text uses tabular figures in every role', () => {
  it('Amount in the body role carries tabular-nums', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider>
          <Amount amountMinor={123450} currency="SGD" direction="neutral" role="body" />
        </ThemeProvider>,
      );
    });
    const t = r.root.findAll((n) => n.type === Text)[0]!;
    expect(JSON.stringify(flat(t.props.style).fontVariant)).toContain('tabular-nums');
    act(() => r.unmount());
  });
});

describe('Undo that fails says so', () => {
  it('shows "Could not undo that entry." when the entry cannot be removed', async () => {
    const m = await mountReady();
    m.remove.mockResolvedValue({ ok: false });
    tap(m.r, '5');
    act(() => fire(m.r, 'category-cat_food'));
    await act(async () => fire(m.r, 'save'));
    await settle();
    await act(async () => fire(m.r, 'toast-undo'));
    await settle();
    expect(texts(m.r)).toContain('Could not undo that entry.');
  });
});

describe('the toast is also drawn above an open sheet', () => {
  it('appears inside the sheet so "Save & add another" shows its Undo', async () => {
    const qc = createQueryClient();
    let toastApi!: ReturnType<typeof useToast>;
    let sheetApi!: ReturnType<typeof useSheet>;
    const Grab = () => {
      toastApi = useToast();
      sheetApi = useSheet();
      return null;
    };
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost>
              <SheetHost>
                <Grab />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    act(() => sheetApi.open({ id: 'x', title: 'Sheet', body: () => <Text>body</Text> }));
    await act(async () => toastApi.show({ message: 'Saved', undo: { label: 'Undo', onUndo: () => undefined } }));
    await settle();
    // one toast under the modal, one inside it
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'toast').length).toBe(2);
    expect(host(r, 'sheet-scrim')).toBeDefined();
    act(() => r.unmount());
    qc.clear();
  });
});
