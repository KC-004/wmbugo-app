import { exportAccountsCsv, exportTransactionsCsv } from '@wmbugo/core';
import { createCsvDocument } from '../../adapters/backup/backupFiles';
import { readProfile } from '../../adapters/readProfile';
import { realExportApi, type ExportRequest } from './exportApi';

jest.mock('../../adapters/startApp', () => ({
  getServices: () => ({ db: { query: jest.fn(async () => []) } }),
  systemClock: { nowMs: () => Date.UTC(2026, 10, 8, 12), timezoneId: () => 'Europe/London' },
}));
jest.mock('../../adapters/backup/backupFiles', () => ({ createCsvDocument: jest.fn() }));
jest.mock('../../adapters/readProfile', () => ({ readProfile: jest.fn() }));
jest.mock('@wmbugo/core', () => ({ ...jest.requireActual('@wmbugo/core'), exportTransactionsCsv: jest.fn(), exportAccountsCsv: jest.fn() }));

const profile = { timezoneId: 'Europe/London', currency: 'GBP', exponent: 2, payday: { kind: 'first' }, settings: { periodMode: 'pay_cycle', firstDay: 'mon' } };
const doc = () => ({ sink: { write: jest.fn(async () => true) }, commit: jest.fn(async () => undefined), abort: jest.fn(async () => undefined) });
const REQUEST: ExportRequest = { kind: 'transactions', choice: 'all_time', accountIds: null, includeNumbers: false };
const hooks = { onProgress: jest.fn(), isCancelled: () => false };

let d: ReturnType<typeof doc>;
beforeEach(() => {
  jest.clearAllMocks();
  (readProfile as jest.Mock).mockResolvedValue(profile);
  d = doc();
  (createCsvDocument as jest.Mock).mockResolvedValue(d);
});

describe('realExportApi.run (Story 9.9, Epic 9 review)', () => {
  it('on success the document is committed, never aborted, and the count follows the kind', async () => {
    (exportTransactionsCsv as jest.Mock).mockResolvedValue({ ok: true, value: { entries: 12 } });
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'saved', export: 'transactions', count: 12 });
    expect(d.commit).toHaveBeenCalledTimes(1);
    expect(d.abort).not.toHaveBeenCalled();
    (exportAccountsCsv as jest.Mock).mockResolvedValue({ ok: true, value: { accounts: 3 } });
    expect(await realExportApi.run({ ...REQUEST, kind: 'accounts' }, hooks)).toEqual({ kind: 'saved', export: 'accounts', count: 3 });
  });

  it('a cancel deletes the partial file and is reported as cancelled; a write failure deletes it too and is reported as failed', async () => {
    (exportTransactionsCsv as jest.Mock).mockResolvedValueOnce({ ok: false, code: 'CANCELLED' });
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'cancelled' });
    expect(d.abort).toHaveBeenCalledTimes(1);
    expect(d.commit).not.toHaveBeenCalled();
    (exportTransactionsCsv as jest.Mock).mockResolvedValueOnce({ ok: false, code: 'WRITE_FAILED' });
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'failed' });
    expect(d.abort).toHaveBeenCalledTimes(2);
    expect(d.commit).not.toHaveBeenCalled();
  });

  it('an abort that itself fails still reports the cancel', async () => {
    d.abort.mockRejectedValue(new Error('provider'));
    (exportTransactionsCsv as jest.Mock).mockResolvedValue({ ok: false, code: 'CANCELLED' });
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'cancelled' });
  });

  it('an exception while writing aborts the document and fails', async () => {
    (exportTransactionsCsv as jest.Mock).mockRejectedValue(new Error('disk'));
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'failed' });
    expect(d.abort).toHaveBeenCalledTimes(1);
    expect(d.commit).not.toHaveBeenCalled();
  });

  it('closing the save dialog writes nothing, and a save dialog that throws fails', async () => {
    (createCsvDocument as jest.Mock).mockResolvedValueOnce(null);
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'dialog_cancelled' });
    expect(exportTransactionsCsv).not.toHaveBeenCalled();
    (createCsvDocument as jest.Mock).mockRejectedValueOnce(new Error('no activity'));
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'failed' });
  });

  it('an invalid custom range never opens the save dialog', async () => {
    const r = await realExportApi.run({ ...REQUEST, choice: 'custom', custom: { start: '2026-03-31', end: '2026-03-01' } }, hooks);
    expect(r).toMatchObject({ kind: 'invalid_period' });
    expect(createCsvDocument).not.toHaveBeenCalled();
  });

  it('with no profile there is nothing to export', async () => {
    (readProfile as jest.Mock).mockResolvedValue(null);
    expect(await realExportApi.run(REQUEST, hooks)).toEqual({ kind: 'failed' });
  });
});
