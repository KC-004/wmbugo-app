import type { ReactElement } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { CsvCandidate, ImportClass, ImportPlan, ImportSummary, PlannedRow } from '@wmbugo/core';
import { createQueryClient } from '../../shared/queryClient';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ImportFlow } from './ImportFlow';
import { ImportRun, unreadableRowsCsv } from './ImportRun';
import type { ImportApi, RunApi, RunHooks } from './importApi';
import type { ImportDraft } from './importModel';

jest.mock('lottie-react-native', () => ({ __esModule: true, default: () => null }));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn() }));
jest.mock('../../adapters/import/rnRawFileStore', () => ({ rnRawFileStore: {} }));
jest.mock('../../adapters/backup/rnCrypto', () => ({ createRnCrypto: jest.fn() }));
jest.mock('../../adapters/backup/backupFiles', () => ({ pickCsvFile: jest.fn(), createCsvDocument: jest.fn() }));

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
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

const cand = (row: number, over: Partial<CsvCandidate> = {}): CsvCandidate => ({
  row,
  direction: 'out',
  amountMinor: 420,
  localDate: '2026-11-13',
  description: `Shop ${row}`,
  merchant: `Shop ${row}`,
  currency: 'GBP',
  foreign: false,
  accountId: 'a1',
  ...over,
});
const planned = (row: number, cls: ImportClass, over: Partial<PlannedRow> = {}): PlannedRow => ({ row, class: cls, candidate: cls === 'error' ? null : cand(row), fingerprint: `f${row}`, errors: [], ...over });
const planOf = (rows: PlannedRow[]): ImportPlan => ({ rows, counts: {} as ImportPlan['counts'] });

const draft = {
  bytes: new Uint8Array(0),
  read: { header: ['Date', 'Description', 'Amount'], delimiter: { value: ',' }, rows: [{ row: 2, cells: ['13/11/2026', 'Shop 1', '-4.20'] }, { row: 3, cells: ['14/11/2026', 'Broken', 'abc'] }] },
  mapping: {},
  choice: { kind: 'single', accountId: 'a1' },
  overrides: {},
  validation: {},
} as unknown as ImportDraft;

const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({ batchId: 'b1', status: 'completed', rowCount: 4, committedThroughRow: 5, imported: 3, skipped: 1, review: 0, errors: 0, ...over });

function fakeRun(plan: ImportPlan | null, over: Partial<RunApi> = {}): RunApi & { run: jest.Mock; resume: jest.Mock; saveRows: jest.Mock } {
  return {
    plan: jest.fn(async () => plan),
    run: jest.fn(async () => ({ ok: true as const, value: summary() })),
    paused: jest.fn(async () => null),
    resume: jest.fn(async () => ({ ok: true as const, value: summary() })),
    saveRows: jest.fn(async () => true),
    discard: jest.fn(async () => true),
    ...over,
  } as never;
}

async function mount(node: (props: { onDone: jest.Mock; onReview: jest.Mock }) => ReactElement) {
  const onDone = jest.fn();
  const onReview = jest.fn();
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>{node({ onDone, onReview })}</SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, onDone, onReview };
}

const ROWS = [planned(2, 'new'), planned(3, 'new'), planned(4, 'possible_duplicate', { matchId: 'x' }), planned(5, 'already_recorded', { matchId: 'y' }), planned(6, 'error', { errors: [{ code: 'INVALID_AMOUNT', value: 'abc', message: 'Not an amount: abc' } as never] })];

describe('check matches (Story 9.7)', () => {
  it('shows the loader while it compares, then each group with its count and what happens to it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const api = fakeRun(null, { plan: async () => (await gate, planOf(ROWS)) });
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} />);
    expect(has(m.r, 'long-task-loader')).toBe(true);
    expect(texts(m.r)).toContain('Checking your file against what you have…');
    release();
    await settle();
    expect(texts(m.r)).toEqual(expect.arrayContaining(['New (2)', 'Possible duplicates (1)', 'Already recorded (1)', "Can't be read (1)", 'These will be added.']));
    expect(texts(m.r)).toContain('Import 3 entries');
  });

  it('a possible duplicate can be skipped or imported anyway, per row or for the whole group, and the count follows', async () => {
    const api = fakeRun(planOf(ROWS));
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} />);
    await press(m.r, 'import-rows-possible_duplicate');
    await press(m.r, 'import-choice-4-skip');
    expect(texts(m.r)).toContain('Import 2 entries');
    await press(m.r, 'import-choice-4-import_anyway');
    expect(texts(m.r)).toContain('Import 3 entries');
    await press(m.r, 'import-all-possible_duplicate-skip');
    expect(texts(m.r)).toContain('Import 2 entries');
    await press(m.r, 'import-all-possible_duplicate-default');
    expect(texts(m.r)).toContain('Import 3 entries');
  });

  it('with nothing left to add the button is disabled and says why', async () => {
    const api = fakeRun(planOf([planned(2, 'already_recorded', { matchId: 'y' })]));
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} />);
    const btn = m.r.root.findAll((n) => n.props.testID === 'import-start' && n.props.accessibilityState)[0]!;
    expect(btn.props.accessibilityState.disabled).toBe(true);
    expect(btn.props.accessibilityHint).toBe('There is nothing to add with these choices.');
  });

  it('Back leaves without running anything', async () => {
    const api = fakeRun(planOf(ROWS));
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} />);
    await press(m.r, 'import-cancel');
    expect(m.onDone).toHaveBeenCalled();
    expect(api.run).not.toHaveBeenCalled();
  });
});

describe('running and the summary (Story 9.7)', () => {
  it('runs with the choices made, shows progress, and ends on a summary with Review and Done', async () => {
    let hooks!: RunHooks;
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const api = fakeRun(planOf(ROWS), {
      run: jest.fn(async (_d: ImportDraft, _dec: unknown, h: RunHooks) => {
        hooks = h;
        h.onProgress(2, 5);
        await gate;
        return { ok: true as const, value: summary({ imported: 2, review: 1, skipped: 1, errors: 1 }) };
      }) as never,
    });
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} onReview={p.onReview} />);
    await press(m.r, 'import-rows-possible_duplicate');
    await press(m.r, 'import-choice-4-skip');
    await press(m.r, 'import-start');
    expect(api.run).toHaveBeenCalledWith(draft, { 4: 'skip' }, expect.any(Object));
    expect(texts(m.r)).toContain('Importing 2 of 5');
    expect(hooks.isCancelled()).toBe(false);
    release();
    await settle();
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Import finished', '3 added', '1 left out', '1 waiting for you to check', "1 couldn't be read", 'Review 1 to check']));
    await press(m.r, 'import-review');
    expect(m.onReview).toHaveBeenCalled();
    await press(m.r, 'import-done');
    expect(m.onDone).toHaveBeenCalled();
  });

  it('Stop is honoured and the summary says it stopped, with Carry on', async () => {
    let hooks!: RunHooks;
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const api = fakeRun(planOf(ROWS), {
      run: jest.fn(async (_d: ImportDraft, _dec: unknown, h: RunHooks) => {
        hooks = h;
        await gate;
        return { ok: true as const, value: summary({ status: 'paused', imported: 2, skipped: 0, rowCount: 5 }) };
      }) as never,
    });
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} />);
    await press(m.r, 'import-start');
    await press(m.r, 'import-stop');
    expect(hooks.isCancelled()).toBe(true);
    expect(texts(m.r)).toContain('Stopping after this batch…');
    release();
    await settle();
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Import stopped', '2 of 5 rows are in. You can carry on from here.']));
    await press(m.r, 'import-resume');
    expect(api.resume).toHaveBeenCalledWith('b1', expect.any(Object));
    await settle();
    expect(texts(m.r)).toContain('Import finished');
  });

  it('a failed run keeps what was added and offers Carry on; a missing raw copy says it cannot carry on', async () => {
    const failing = fakeRun(planOf(ROWS), { run: jest.fn(async () => ({ ok: false as const, code: 'IMPORT_FAILED' as const })) as never, paused: async () => summary({ status: 'paused' }) });
    const a = await mount((p) => <ImportRun draft={draft} api={failing} locale="en-GB" onDone={p.onDone} />);
    await press(a.r, 'import-start');
    expect(texts(a.r)).toEqual(expect.arrayContaining(["The import couldn't finish", 'What was added is kept, and you can carry on from where it stopped.']));
    // The failed run's paused batch is found, so the button the text promises is there (Epic 9 review).
    expect(has(a.r, 'import-resume')).toBe(true);
    await press(a.r, 'import-resume');
    expect(failing.resume).toHaveBeenCalledWith('b1', expect.anything());
    const lost = fakeRun(null, { paused: async () => summary({ status: 'paused' }), resume: jest.fn(async () => ({ ok: false as const, code: 'RAW_COPY_MISSING' as const })) as never });
    const b = await mount((p) => <ImportRun draft={null} api={lost} locale="en-GB" resumeBatchId="b1" onDone={p.onDone} />);
    expect(texts(b.r)).toContain("The saved copy of that file is gone, so this import can't carry on. What was added is kept.");
    expect(has(b.r, 'import-resume')).toBe(false);
  });

  it('a double tap on Import starts one run, not two (Epic 9 review)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const api = fakeRun(planOf(ROWS), { run: jest.fn(async () => (await gate, { ok: true as const, value: summary() })) as never });
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} />);
    const button = m.r.root.findByProps({ testID: 'import-start' });
    await act(async () => {
      button.props.onPress();
      button.props.onPress();
    });
    expect(api.run).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it('rows that could not be read can be saved as a CSV, and the person is told whether it worked', async () => {
    const api = fakeRun(planOf(ROWS), { run: jest.fn(async () => ({ ok: true as const, value: summary({ errors: 1 }) })) as never });
    const m = await mount((p) => <ImportRun draft={draft} api={api} locale="en-GB" onDone={p.onDone} />);
    await press(m.r, 'import-start');
    await press(m.r, 'import-save-rows');
    expect(api.saveRows).toHaveBeenCalledTimes(1);
    expect(texts(m.r)).toContain('Saved the rows that were not imported');
    api.saveRows.mockResolvedValueOnce(false);
    await press(m.r, 'import-save-rows');
    expect(texts(m.r)).toContain("The rows couldn't be saved.");
  });

  it('the saved CSV holds the file\'s own cells for the rows that failed, plus what was wrong', () => {
    const csv = unreadableRowsCsv(draft, planOf([planned(2, 'new'), planned(3, 'error', { errors: [{ code: 'INVALID_AMOUNT', value: 'abc', message: 'Not an amount: abc' } as never] })]));
    expect(csv).toBe('Date,Description,Amount,Problem\n14/11/2026,Broken,abc,Not an amount: abc\n');
  });
});

describe('an interrupted import (Story 9.7)', () => {
  const flowApi = (paused: ImportSummary | null): ImportApi =>
    ({ ...fakeRun(planOf(ROWS), { paused: async () => paused }), pick: jest.fn(async () => null), context: jest.fn(async () => null), savedFormat: jest.fn(async () => null), saveFormat: jest.fn(async () => ({ ok: true })) }) as never;

  it('is offered before a new import, and Carry on resumes it', async () => {
    const api = flowApi(summary({ status: 'paused', imported: 400, skipped: 0, rowCount: 1200 }));
    const m = await mount((p) => <ImportFlow api={api} onExit={p.onDone} />);
    expect(texts(m.r)).toEqual(expect.arrayContaining(['An import was interrupted', '400 of 1200 rows were added before it stopped.']));
    await press(m.r, 'import-interrupted-resume');
    expect(api.resume).toHaveBeenCalledWith('b1', expect.any(Object));
    expect(texts(m.r)).toContain('Import finished');
  });

  it('Not now puts it away, and with none paused the wizard starts straight away', async () => {
    const api = flowApi(summary({ status: 'paused' }));
    const m = await mount((p) => <ImportFlow api={api} onExit={p.onDone} />);
    await press(m.r, 'import-interrupted-dismiss');
    expect(has(m.r, 'import-interrupted')).toBe(false);
    expect(has(m.r, 'import-choose')).toBe(true);
    const none = await mount((p) => <ImportFlow api={flowApi(null)} onExit={p.onDone} />);
    expect(has(none.r, 'import-interrupted')).toBe(false);
    expect(has(none.r, 'import-choose')).toBe(true);
  });

  it('Discard on the interrupted card gives the import up, and a failure says so', async () => {
    const api = flowApi(summary({ status: 'paused', imported: 10, skipped: 0 }));
    const m = await mount((p) => <ImportFlow api={api} onExit={p.onDone} />);
    await press(m.r, 'import-interrupted-discard');
    expect(api.discard).toHaveBeenCalledWith('b1');
    expect(has(m.r, 'import-interrupted')).toBe(false);
    const bad = flowApi(summary({ status: 'paused' }));
    (bad.discard as jest.Mock).mockResolvedValueOnce(false);
    const f = await mount((p) => <ImportFlow api={bad} onExit={p.onDone} />);
    await press(f.r, 'import-interrupted-discard');
    expect(has(f.r, 'import-interrupted')).toBe(true);
    expect(texts(f.r)).toContain("The import couldn't be discarded.");
  });
});
