import { rnRawFileStore } from '../../adapters/import/rnRawFileStore';
import { getServices } from '../../adapters/startApp';
import { realImportedFilesApi } from './importedFilesApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn() }));
jest.mock('../../adapters/readProfile', () => ({ readProfile: jest.fn() }));
jest.mock('../../adapters/import/rnRawFileStore', () => ({ rnRawFileStore: { remove: jest.fn(async () => undefined) } }));

const run = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (getServices as jest.Mock).mockReturnValue({ writer: { run }, db: { query: jest.fn(async () => []) } });
});

describe('realImportedFilesApi (Story 9.8, Epic 9 review): the file goes after the commit clears the row', () => {
  it('Delete file now removes the path the use case returns, and removes nothing when it fails', async () => {
    run.mockResolvedValueOnce({ ok: true, value: { path: '/imports/a.enc' } });
    expect(await realImportedFilesApi.deleteFile('b1')).toBe(true);
    expect(rnRawFileStore.remove).toHaveBeenCalledWith('/imports/a.enc');
    jest.clearAllMocks();
    run.mockResolvedValueOnce({ ok: false, code: 'IMPORT_IN_PROGRESS' });
    expect(await realImportedFilesApi.deleteFile('b1')).toBe(false);
    expect(rnRawFileStore.remove).not.toHaveBeenCalled();
  });

  it('changing the retention removes every copy that has expired under the new choice', async () => {
    run.mockResolvedValueOnce({ ok: true, value: { paths: ['/imports/a.enc', '/imports/b.enc'] } });
    expect(await realImportedFilesApi.setRetention('delete_after')).toBe(true);
    expect(rnRawFileStore.remove).toHaveBeenCalledTimes(2);
    expect(rnRawFileStore.remove).toHaveBeenCalledWith('/imports/b.enc');
    jest.clearAllMocks();
    run.mockResolvedValueOnce({ ok: false, code: 'X' });
    expect(await realImportedFilesApi.setRetention('keep')).toBe(false);
    expect(rnRawFileStore.remove).not.toHaveBeenCalled();
  });

  it('discarding removes the copy when there is one and nothing when there is not', async () => {
    run.mockResolvedValueOnce({ ok: true, value: { path: '/imports/c.enc' } });
    expect(await realImportedFilesApi.discard('b1')).toBe(true);
    expect(rnRawFileStore.remove).toHaveBeenCalledWith('/imports/c.enc');
    jest.clearAllMocks();
    run.mockResolvedValueOnce({ ok: true, value: { path: null } });
    expect(await realImportedFilesApi.discard('b1')).toBe(true);
    expect(rnRawFileStore.remove).not.toHaveBeenCalled();
  });

  it('a file that cannot be removed does not turn a committed delete into a failure', async () => {
    (rnRawFileStore.remove as jest.Mock).mockRejectedValueOnce(new Error('busy'));
    run.mockResolvedValueOnce({ ok: true, value: { path: '/imports/a.enc' } });
    expect(await realImportedFilesApi.deleteFile('b1')).toBe(true);
  });
});
