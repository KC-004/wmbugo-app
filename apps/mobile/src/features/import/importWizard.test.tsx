import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { guessMapping, headerSignature, readCsv, type SavedCsvFormat } from '@wmbugo/core';
import { createQueryClient } from '../../shared/queryClient';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ImportWizard } from './ImportWizard';
import type { ImportContext, PickedCsv, WizardApi } from './importApi';
import type { ImportDraft } from './importModel';

jest.mock('lottie-react-native', () => ({ __esModule: true, default: () => null }));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn() }));
jest.mock('../../adapters/import/rnRawFileStore', () => ({ rnRawFileStore: {} }));
jest.mock('../../adapters/backup/rnCrypto', () => ({ createRnCrypto: jest.fn() }));
jest.mock('../../adapters/backup/backupFiles', () => ({ pickCsvFile: jest.fn() }));

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const bytes = (s: string) => new TextEncoder().encode(s);

const GOOD = 'Date,Description,Amount,Balance\n13/11/2026,Swiggy,-420.00,9580.00\n14/11/2026,Salary,50000.00,59580.00\n';
const REVERSED = 'Date,Description,Amount,Balance\n13/11/2026,Swiggy,420.00,9580.00\n14/11/2026,Salary,-50000.00,59580.00\n';
const AMBIGUOUS = 'Date,Description,Amount\n03/11/2026,Swiggy,-420.00\n04/11/2026,Salary,50000.00\n';

const ONE: ImportContext = { currency: 'GBP', exponent: 2, locale: 'en-GB', timezoneId: 'Europe/London', accounts: [{ id: 'a1', name: 'Monzo Current' }] };
const TWO: ImportContext = { ...ONE, accounts: [...ONE.accounts, { id: 'a2', name: 'Amex' }] };

function fakeApi(csv: string | null, over: Partial<WizardApi> = {}, ctx: ImportContext | null = ONE) {
  const picked: PickedCsv | null = csv === null ? null : { bytes: bytes(csv), size: csv.length };
  const api: WizardApi = {
    pick: jest.fn(async () => picked),
    context: jest.fn(async () => ctx),
    savedFormat: jest.fn(async () => null),
    saveFormat: jest.fn(async () => ({ ok: true })),
    ...over,
  };
  return api;
}

async function mount(api: WizardApi) {
  const onContinue = jest.fn<void, [ImportDraft]>();
  const onBusyChange = jest.fn<void, [boolean]>();
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <ImportWizard api={api} onContinue={onContinue} onBusyChange={onBusyChange} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, onContinue, onBusyChange };
}

const stepper = (r: ReactTestRenderer) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'stepper')[0]!.props.accessibilityLabel as string;

describe('import wizard: choose a file (Story 9.6)', () => {
  it('opens on Step 1 of 3 with one button, and a cancelled picker changes nothing', async () => {
    const m = await mount(fakeApi(null));
    expect(stepper(m.r)).toBe('Step 1 of 3: Choose a file');
    await press(m.r, 'import-choose');
    expect(has(m.r, 'import-error')).toBe(false);
    expect(stepper(m.r)).toBe('Step 1 of 3: Choose a file');
  });

  it('reading shows the coin loader, and tells the app it is busy until it is done', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = await mount(fakeApi(GOOD, { context: async () => (await gate, ONE) }));
    await act(async () => void m.r.root.findAll((n) => n.props.testID === 'import-choose' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    await act(async () => new Promise((res) => setTimeout(res, 5)));
    expect(has(m.r, 'long-task-loader')).toBe(true);
    expect(texts(m.r)).toContain('Reading your file…');
    expect(m.onBusyChange).toHaveBeenLastCalledWith(true);
    release();
    await settle();
    expect(has(m.r, 'long-task-loader')).toBe(false);
    expect(m.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ['', 'That file is empty. Nothing was imported.'],
    ['Date,Description,Amount\n', 'That file has headings but no rows. Nothing was imported.'],
  ])('a file that cannot be read says so and stays on Step 1 (%j)', async (csv, message) => {
    const m = await mount(fakeApi(csv));
    await press(m.r, 'import-choose');
    expect(texts(m.r)).toContain(message);
    expect(stepper(m.r)).toBe('Step 1 of 3: Choose a file');
  });

  it('a file over the size limit is refused', async () => {
    const api = fakeApi(null, { pick: async () => ({ bytes: new Uint8Array(0), size: 30 * 1024 * 1024 }) });
    const m = await mount(api);
    await press(m.r, 'import-choose');
    expect(texts(m.r)).toContain('That file is too large to import. Nothing was imported.');
  });

  it('with no account yet it asks for one first, and a picker that throws says the file could not be opened', async () => {
    const none = await mount(fakeApi(GOOD, {}, { ...ONE, accounts: [] }));
    await press(none.r, 'import-choose');
    expect(texts(none.r)).toContain('Add an account first, then import a file.');
    const broken = await mount(fakeApi(GOOD, { pick: async () => Promise.reject(new Error('x')) }));
    await press(broken.r, 'import-choose');
    expect(texts(broken.r)).toContain("That file couldn't be opened. Nothing was imported.");
  });
});

describe('import wizard: columns and preview (Story 9.6)', () => {
  it('guesses the columns, and with one account goes on without asking which', async () => {
    const m = await mount(fakeApi(GOOD));
    await press(m.r, 'import-choose');
    expect(stepper(m.r)).toBe('Step 2 of 3: Check the columns');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Date', 'Description', 'Amount']));
    await press(m.r, 'import-next');
    expect(stepper(m.r)).toBe('Step 3 of 3: Preview');
    expect(texts(m.r)).toContain('2 ready to import');
    expect(has(m.r, 'import-amount-2')).toBe(true);
    expect(texts(m.r)).toContain('The balances in the file agree with these amounts.');
  });

  it('with several accounts Next waits for the person to choose one, and says what is missing', async () => {
    const m = await mount(fakeApi(GOOD, {}, TWO));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-next');
    expect(texts(m.r)).toContain('Choose an account to go on.');
    expect(stepper(m.r)).toBe('Step 2 of 3: Check the columns');
    await press(m.r, 'import-account-a2');
    await press(m.r, 'import-next');
    expect(stepper(m.r)).toBe('Step 3 of 3: Preview');
  });

  it('dates that read both ways ask which comes first and block Next until chosen', async () => {
    const m = await mount(fakeApi(AMBIGUOUS));
    await press(m.r, 'import-choose');
    expect(has(m.r, 'import-date-order')).toBe(true);
    await press(m.r, 'import-next');
    expect(texts(m.r)).toContain('Choose the order of the dates to go on.');
    await press(m.r, 'import-date-DD/MM/YYYY');
    await press(m.r, 'import-next');
    expect(stepper(m.r)).toBe('Step 3 of 3: Preview');
  });

  it('a column can be changed from its row, and a role can be left out', async () => {
    const m = await mount(fakeApi('Date,Details,Money,Note\n13/11/2026,Swiggy,-420.00,x\n'));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-role-amount');
    expect(has(m.r, 'import-col-amount-2')).toBe(true);
    await press(m.r, 'import-col-amount-none');
    await press(m.r, 'import-next');
    expect(texts(m.r)).toContain('Choose an Amount column, or a Money out and a Money in column.');
    await press(m.r, 'import-role-amount');
    await press(m.r, 'import-col-amount-2');
    await press(m.r, 'import-next');
    expect(stepper(m.r)).toBe('Step 3 of 3: Preview');
  });

  it('file settings re-read the file with another separator', async () => {
    const m = await mount(fakeApi('Date;Description;Amount\n13/11/2026;Swiggy;-420,00\n'));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-file-settings');
    await press(m.r, 'import-delimiter-Commas');
    await press(m.r, 'import-settings-done');
    expect(texts(m.r).some((t) => t.includes('separated by commas'))).toBe(true);
  });

  it('amounts that look reversed are flagged with Flip sign, which turns them round', async () => {
    const m = await mount(fakeApi(REVERSED));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-next');
    expect(texts(m.r)).toContain('Amounts look reversed: payments out should lower the balance.');
    await press(m.r, 'import-flip');
    expect(has(m.r, 'import-reversed')).toBe(false);
    expect(texts(m.r)).toContain('The balances in the file agree with these amounts.');
  });

  it('rows that cannot be read are counted, and the preview still shows the rest', async () => {
    const m = await mount(fakeApi('Date,Description,Amount\n13/11/2026,Swiggy,-420.00\n14/11/2026,Broken,abc\n'));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-next');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['1 ready to import', "1 row can't be read"]));
  });

  it('nothing to import disables Check matches and says why', async () => {
    const m = await mount(fakeApi('Date,Description,Amount\n13/11/2026,Swiggy,abc\n'));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-next');
    expect(has(m.r, 'import-nothing')).toBe(true);
    const btn = m.r.root.findAll((n) => n.props.testID === 'import-check-matches' && n.props.accessibilityState)[0]!;
    expect(btn.props.accessibilityState.disabled).toBe(true);
  });

  it('Back goes from the preview to the columns and from the columns to the file', async () => {
    const m = await mount(fakeApi(GOOD));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-next');
    await press(m.r, 'import-back');
    expect(stepper(m.r)).toBe('Step 2 of 3: Check the columns');
    await press(m.r, 'import-back');
    expect(stepper(m.r)).toBe('Step 1 of 3: Choose a file');
  });

  it('Check matches hands the draft on; remembering the layout saves it first', async () => {
    const api = fakeApi(GOOD);
    const m = await mount(api);
    await press(m.r, 'import-choose');
    await press(m.r, 'import-next');
    await press(m.r, 'import-remember');
    await press(m.r, 'import-check-matches');
    expect(api.saveFormat).toHaveBeenCalledTimes(1);
    const saved = (api.saveFormat as jest.Mock).mock.calls[0]![0];
    expect(saved.name).toBe('Monzo Current');
    expect(saved.headerSignature).toBe(headerSignature(['Date', 'Description', 'Amount', 'Balance'], ','));
    expect(m.onContinue).toHaveBeenCalledTimes(1);
    const draft = m.onContinue.mock.calls[0]![0];
    expect(draft.validation.okCount).toBe(2);
    expect(draft.choice).toEqual({ kind: 'single', accountId: 'a1' });
  });

  it('without the tick nothing is saved, and a save that fails does not stop the import', async () => {
    const plain = fakeApi(GOOD);
    const a = await mount(plain);
    await press(a.r, 'import-choose');
    await press(a.r, 'import-next');
    await press(a.r, 'import-check-matches');
    expect(plain.saveFormat).not.toHaveBeenCalled();
    expect(a.onContinue).toHaveBeenCalledTimes(1);
    const failing = fakeApi(GOOD, { saveFormat: async () => Promise.reject(new Error('x')) });
    const b = await mount(failing);
    await press(b.r, 'import-choose');
    await press(b.r, 'import-next');
    await press(b.r, 'import-remember');
    await press(b.r, 'import-check-matches');
    expect(b.onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('import wizard: a saved layout (Story 9.6)', () => {
  const read = readCsv(bytes(GOOD));
  if (!read.ok) throw new Error('fixture');
  const saved: SavedCsvFormat = {
    id: 'f1',
    name: 'Monzo Current',
    headerSignature: headerSignature(read.value.header, ','),
    mapping: guessMapping(read.value.header, read.value.sample),
    overrides: {},
    account: { kind: 'single', accountId: 'a1' },
  };

  it('skips the Columns step: two steps, with the line that says why', async () => {
    const m = await mount(fakeApi(GOOD, { savedFormat: async () => saved }));
    await press(m.r, 'import-choose');
    expect(stepper(m.r)).toBe('Step 2 of 2: Preview');
    expect(texts(m.r)).toContain('This looks like a file you imported before, so the columns are already set.');
    expect(texts(m.r)).toContain('2 ready to import');
  });

  it('Back from the preview of a saved layout goes to the file step', async () => {
    const m = await mount(fakeApi(GOOD, { savedFormat: async () => saved }));
    await press(m.r, 'import-choose');
    await press(m.r, 'import-back');
    expect(stepper(m.r)).toBe('Step 1 of 3: Choose a file');
  });
});
