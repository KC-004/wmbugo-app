import { memoryFiles, rnfsModule } from '../../testing/memoryRnfs';
import { IMPORTS_DIR, rnRawFileStore } from './rnRawFileStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('@dr.pogodin/react-native-fs', () => require('../../testing/memoryRnfs').rnfsModule);
jest.mock('../storage/keychainKeyStore', () => ({ keychainKeyStore: { getKey: jest.fn(async () => 'ab'.repeat(32)) } }));
jest.mock('../backup/backupFiles', () => {
  const written = new Map<string, Uint8Array>();
  return {
    __written: written,
    openEncryptedPhoto: jest.fn(async (path: string) => {
      const parts: Uint8Array[] = [];
      return {
        write: async (c: Uint8Array) => void parts.push(new Uint8Array(c)),
        close: async () => {
          const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let at = 0;
          for (const p of parts) {
            all.set(p, at);
            at += p.length;
          }
          written.set(path, all);
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
          await require('../../testing/memoryRnfs').rnfsModule.writeFile(path, 'x', 'utf8');
        },
        abort: async () => undefined,
      };
    }),
    streamDecrypted: (path: string) => ({
      [Symbol.asyncIterator]() {
        const b = written.get(path);
        let at = 0;
        return {
          async next() {
            if (!b) throw new Error('missing');
            if (at >= b.length) return { done: true as const, value: undefined };
            const value = b.subarray(at, at + 3);
            at += 3;
            return { done: false as const, value };
          },
        };
      },
    }),
  };
});

beforeEach(() => memoryFiles.reset());

describe('the raw copy of an imported file (Story 9.7)', () => {
  it('saves under the private imports folder and reads back the same bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const path = await rnRawFileStore.save('import-a.enc', bytes);
    expect(path).toBe(`${IMPORTS_DIR}/import-a.enc`);
    expect(Array.from(await rnRawFileStore.read(path))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('removing a copy that is not there is not an error, and removes one that is', async () => {
    await expect(rnRawFileStore.remove(`${IMPORTS_DIR}/nothing.enc`)).resolves.toBeUndefined();
    const path = await rnRawFileStore.save('import-b.enc', new Uint8Array([9]));
    await rnRawFileStore.remove(path);
    expect(await rnfsModule.exists(path)).toBe(false);
  });

  it('a write that fails aborts and rethrows, leaving no copy', async () => {
    const backup = jest.requireMock('../backup/backupFiles') as { openEncryptedPhoto: jest.Mock };
    const abort = jest.fn(async () => undefined);
    backup.openEncryptedPhoto.mockResolvedValueOnce({ write: async () => Promise.reject(new Error('disk full')), close: async () => undefined, abort });
    await expect(rnRawFileStore.save('import-c.enc', new Uint8Array([1]))).rejects.toThrow('disk full');
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
