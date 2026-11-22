import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ImportListItem, ImportRetention } from '@wmbugo/core';
import { createQueryClient } from '../../shared/queryClient';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ImportedFilesScreen, importLine, retentionSummary } from './ImportedFilesScreen';
import type { ImportedFilesApi, ImportedFilesData } from './importedFilesApi';

jest.mock('../../adapters/import/rnRawFileStore', () => ({ rnRawFileStore: {} }));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn() }));

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

const NOV3 = Date.UTC(2026, 10, 3, 12);
const DEC3 = Date.UTC(2026, 11, 3, 12);
const item = (over: Partial<ImportListItem> = {}): ImportListItem => ({ batchId: 'b1', fileName: 'statement-nov.csv', status: 'completed', createdAt: NOV3, completedAt: NOV3, entries: 1170, hasFile: true, keptUntil: DEC3, ...over });

function fakeApi(items: ImportListItem[], retention: ImportRetention = 'days_30', over: Partial<ImportedFilesApi> = {}) {
  let current = items;
  let choice = retention;
  const api = {
    load: jest.fn(async (): Promise<ImportedFilesData> => ({ retention: choice, locale: 'en-GB', items: current })),
    setRetention: jest.fn(async (c: ImportRetention) => {
      choice = c;
      return true;
    }),
    deleteFile: jest.fn(async (id: string) => {
      current = current.map((i) => (i.batchId === id ? { ...i, hasFile: false, keptUntil: null } : i));
      return true;
    }),
    discard: jest.fn(async () => true),
    ...over,
  };
  return api as typeof api & ImportedFilesApi;
}

async function mount(api: ImportedFilesApi) {
  const onChanged = jest.fn();
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <ImportedFilesScreen api={api} onChanged={onChanged} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, onChanged };
}

describe('Imported files (Story 9.8)', () => {
  it('summarises the choice, offers the three choices and says nothing is uploaded', async () => {
    const m = await mount(fakeApi([item()]));
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Kept 30 days', 'Delete right after import', 'Keep for 30 days', 'Keep until I delete them', 'Copies stay encrypted on this phone. Nothing is uploaded.']));
  });

  it('each import is one line: name, date, how many, and when the file goes or that it is deleted', async () => {
    const m = await mount(fakeApi([item(), item({ batchId: 'b2', fileName: 'old.csv', hasFile: false, keptUntil: null, entries: 12 })]));
    expect(texts(m.r)).toEqual(expect.arrayContaining(['statement-nov.csv · 3 Nov · 1,170 imported · file kept until 3 Dec', 'old.csv · 3 Nov · 12 imported · file deleted']));
  });

  it('choosing another option saves it and the summary follows at once', async () => {
    const api = fakeApi([item()]);
    const m = await mount(api);
    await press(m.r, 'import-retention-keep');
    expect(api.setRetention).toHaveBeenCalledWith('keep');
    expect(texts(m.r)).toContain('Kept until you delete them');
    expect(m.onChanged).toHaveBeenCalled();
    await press(m.r, 'import-retention-delete_after');
    expect(texts(m.r)).toContain('Deleted after import');
  });

  it('a choice that cannot be saved says so and leaves the summary alone', async () => {
    const m = await mount(fakeApi([item()], 'days_30', { setRetention: async () => false }));
    await press(m.r, 'import-retention-keep');
    expect(texts(m.r)).toEqual(expect.arrayContaining(["The choice couldn't be saved.", 'Kept 30 days']));
  });

  it('Delete file now asks first, and only the confirm deletes the file; the line then says it is deleted', async () => {
    const api = fakeApi([item()]);
    const m = await mount(api);
    await press(m.r, 'import-delete-b1');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Delete this file?', 'Entries you imported from it stay.']));
    expect(api.deleteFile).not.toHaveBeenCalled();
    await press(m.r, 'import-delete-confirm');
    expect(api.deleteFile).toHaveBeenCalledWith('b1');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['statement-nov.csv · 3 Nov · 1,170 imported · file deleted', 'File deleted']));
    expect(has(m.r, 'import-delete-b1')).toBe(false);
  });

  it('cancelling the confirmation deletes nothing, and a failed delete says so', async () => {
    const api = fakeApi([item()], 'days_30', { deleteFile: async () => false });
    const m = await mount(api);
    await press(m.r, 'import-delete-b1');
    await press(m.r, 'import-delete-cancel');
    expect(has(m.r, 'import-delete-confirm')).toBe(false);
    await press(m.r, 'import-delete-b1');
    await press(m.r, 'import-delete-confirm');
    expect(texts(m.r)).toContain("The file couldn't be deleted.");
  });

  it('a paused import can be discarded but not deleted, and an empty list says so', async () => {
    const api = fakeApi([item({ batchId: 'p1', status: 'paused', completedAt: null, keptUntil: null })]);
    const m = await mount(api);
    expect(has(m.r, 'import-delete-p1')).toBe(false);
    await press(m.r, 'import-discard-p1');
    expect(api.discard).toHaveBeenCalledWith('p1');
    const empty = await mount(fakeApi([]));
    expect(has(empty.r, 'imports-empty')).toBe(true);
  });

  it('the lines for every state, and the three summaries', () => {
    expect(importLine(item({ keptUntil: null }))).toBe('statement-nov.csv · 3 Nov · 1,170 imported · file kept until you delete it');
    expect(importLine(item({ fileName: null, status: 'paused', completedAt: null }))).toBe('A CSV file · 3 Nov · not finished · file kept until 3 Dec');
    expect(retentionSummary('delete_after')).toBe('Deleted after import');
    expect(retentionSummary('days_30')).toBe('Kept 30 days');
    expect(retentionSummary('keep')).toBe('Kept until you delete them');
  });
});
