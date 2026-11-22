import { runCsvImport } from '@wmbugo/core';
import { createCsvDocument } from '../../adapters/backup/backupFiles';
import { rnRawFileStore } from '../../adapters/import/rnRawFileStore';
import { readProfile } from '../../adapters/readProfile';
import { getServices } from '../../adapters/startApp';
import { realImportApi } from './importApi';
import type { ImportDraft } from './importModel';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn() }));
jest.mock('../../adapters/readProfile', () => ({ readProfile: jest.fn() }));
jest.mock('../../adapters/backup/rnCrypto', () => ({ createRnCrypto: jest.fn(() => ({})) }));
jest.mock('../../adapters/backup/backupFiles', () => ({ pickCsvFile: jest.fn(), createCsvDocument: jest.fn() }));
jest.mock('../../adapters/import/rnRawFileStore', () => ({ rnRawFileStore: { remove: jest.fn(async () => undefined) } }));
jest.mock('@wmbugo/core', () => ({ ...jest.requireActual('@wmbugo/core'), runCsvImport: jest.fn(async () => ({ ok: true, value: {} })) }));

const writerRun = jest.fn();
const query = jest.fn(async () => [] as unknown[][]);
const draft = { bytes: new Uint8Array([1, 2]), fileName: 'statement-nov.csv', overrides: {}, mapping: {}, choice: { kind: 'single', accountId: 'a1' } } as unknown as ImportDraft;
const hooks = { onProgress: jest.fn(), isCancelled: () => false };

beforeEach(() => {
  jest.clearAllMocks();
  (getServices as jest.Mock).mockReturnValue({ writer: { run: writerRun }, db: { query } });
  (readProfile as jest.Mock).mockResolvedValue({ currency: 'GBP', timezoneId: 'Europe/London' });
});

describe('realImportApi (Epic 9 review)', () => {
  it('run passes the picked file name and the retention the person chose', async () => {
    query.mockResolvedValueOnce([['import.raw_retention', JSON.stringify('delete_after')]]);
    await realImportApi.run(draft, {}, hooks);
    const [deps, job] = (runCsvImport as jest.Mock).mock.calls[0]!;
    expect(job.fileName).toBe('statement-nov.csv');
    expect(deps.retainDays).toBe(0);
  });

  it('discard removes the copy the use case returns, and removes nothing when it fails', async () => {
    writerRun.mockResolvedValueOnce({ ok: true, value: { path: '/imports/x.enc' } });
    expect(await realImportApi.discard('b1')).toBe(true);
    expect(rnRawFileStore.remove).toHaveBeenCalledWith('/imports/x.enc');
    jest.clearAllMocks();
    writerRun.mockResolvedValueOnce({ ok: false, code: 'IMPORT_NOT_FOUND' });
    expect(await realImportApi.discard('b1')).toBe(false);
    expect(rnRawFileStore.remove).not.toHaveBeenCalled();
  });

  it('saveRows writes a byte order mark and then the UTF-8 text, and commits', async () => {
    const written: Uint8Array[] = [];
    const doc = { sink: { write: jest.fn(async (b: Uint8Array) => void written.push(b)) }, commit: jest.fn(async () => undefined), abort: jest.fn(async () => undefined) };
    (createCsvDocument as jest.Mock).mockResolvedValue(doc);
    expect(await realImportApi.saveRows('a,b\n1,é\n')).toBe(true);
    expect([...written[0]!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(written[0]!.slice(3))).toBe('a,b\n1,é\n');
    expect(doc.commit).toHaveBeenCalledTimes(1);
    expect(doc.abort).not.toHaveBeenCalled();
  });

  it('saveRows aborts the document when the write throws, and does nothing when the save dialog is closed', async () => {
    const doc = { sink: { write: jest.fn(async () => Promise.reject(new Error('full'))) }, commit: jest.fn(), abort: jest.fn(async () => undefined) };
    (createCsvDocument as jest.Mock).mockResolvedValueOnce(doc);
    expect(await realImportApi.saveRows('x')).toBe(false);
    expect(doc.abort).toHaveBeenCalledTimes(1);
    expect(doc.commit).not.toHaveBeenCalled();
    (createCsvDocument as jest.Mock).mockResolvedValueOnce(null);
    expect(await realImportApi.saveRows('x')).toBe(false);
  });
});
