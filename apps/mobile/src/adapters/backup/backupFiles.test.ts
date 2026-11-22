import { NativeModules } from 'react-native';
import { createBackupDocument, openEncryptedPhoto, pickBackupFile, pickCsvFile } from './backupFiles';

const native = {
  createDocument: jest.fn(),
  createTextDocument: jest.fn(),
  pickDocument: jest.fn(),
  pickCsvDocument: jest.fn(),
  openWrite: jest.fn(),
  write: jest.fn(),
  closeWrite: jest.fn(),
  deleteDocument: jest.fn(),
  openRead: jest.fn(),
  readAt: jest.fn(),
  closeRead: jest.fn(),
  openEncryptedWrite: jest.fn(),
  writeEncrypted: jest.fn(),
  closeEncrypted: jest.fn(),
  abortEncrypted: jest.fn(),
};

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mockReset().mockResolvedValue(undefined);
  (NativeModules as Record<string, unknown>).WmbugoBackupFiles = native;
});

describe('the save document (Story 8.7)', () => {
  it('a cancelled dialog gives null and opens nothing', async () => {
    native.createDocument.mockResolvedValue(null);
    expect(await createBackupDocument('x.wmbugo')).toBeNull();
    expect(native.openWrite).not.toHaveBeenCalled();
  });

  it('commit closes the document and does not delete it', async () => {
    native.createDocument.mockResolvedValue('content://doc/1');
    native.openWrite.mockResolvedValue(7);
    const doc = (await createBackupDocument('x.wmbugo'))!;
    await doc.sink.write(new Uint8Array([1, 2]));
    await doc.commit();
    expect(native.write).toHaveBeenCalledWith(7, 'AQI=');
    expect(native.closeWrite).toHaveBeenCalledTimes(1);
    expect(native.deleteDocument).not.toHaveBeenCalled();
  });

  it('abort closes once and deletes the partial document, even if closing fails', async () => {
    native.createDocument.mockResolvedValue('content://doc/1');
    native.openWrite.mockResolvedValue(7);
    native.closeWrite.mockRejectedValue(new Error('provider gone'));
    const doc = (await createBackupDocument('x.wmbugo'))!;
    await doc.abort();
    expect(native.deleteDocument).toHaveBeenCalledWith('content://doc/1');
  });

  it('a document the provider will not open for writing is removed, not left empty in the person\'s folder', async () => {
    native.createDocument.mockResolvedValue('content://doc/2');
    native.openWrite.mockRejectedValue(new Error('mode wt not supported'));
    await expect(createBackupDocument('x.wmbugo')).rejects.toThrow('wt');
    expect(native.deleteDocument).toHaveBeenCalledWith('content://doc/2');
  });
});

describe('the picked backup and the staged photos', () => {
  it('reads at an offset through the handle and closes it', async () => {
    native.pickDocument.mockResolvedValue('content://doc/3');
    native.openRead.mockResolvedValue({ handle: 4, size: 100 });
    native.readAt.mockResolvedValue('AQI=');
    const picked = (await pickBackupFile())!;
    expect(picked.source.size).toBe(100);
    expect(await picked.source.read(10, 2)).toEqual(new Uint8Array([1, 2]));
    expect(native.readAt).toHaveBeenCalledWith(4, 10, 2);
    await picked.close();
    expect(native.closeRead).toHaveBeenCalledWith(4);
  });

  it('a cancelled picker gives null', async () => {
    native.pickDocument.mockResolvedValue(null);
    expect(await pickBackupFile()).toBeNull();
  });

  it('an encrypted photo writes, closes, and can be aborted, each through its own handle', async () => {
    native.openEncryptedWrite.mockResolvedValue(9);
    const photo = await openEncryptedPhoto('/p/a.enc', 'k'.repeat(64));
    await photo.write(new Uint8Array([1, 2]));
    await photo.close();
    await photo.abort();
    expect(native.writeEncrypted).toHaveBeenCalledWith(9, 'AQI=');
    expect(native.closeEncrypted).toHaveBeenCalledWith(9);
    expect(native.abortEncrypted).toHaveBeenCalledWith(9);
  });
});

describe('the bank file picker (Story 9.6)', () => {
  it('a cancelled picker gives null and opens nothing', async () => {
    native.pickCsvDocument.mockResolvedValue(null);
    expect(await pickCsvFile(100)).toBeNull();
    expect(native.openRead).not.toHaveBeenCalled();
  });

  it('reads the whole file in pieces and closes it', async () => {
    native.pickCsvDocument.mockResolvedValue('content://doc/2');
    native.openRead.mockResolvedValue({ handle: 4, size: 3 });
    native.readAt.mockResolvedValue('AQID');
    const r = (await pickCsvFile(100))!;
    expect(Array.from(r.bytes)).toEqual([1, 2, 3]);
    expect(r.size).toBe(3);
    expect(native.closeRead).toHaveBeenCalledWith(4);
  });

  it('a file over the limit is not read: only its size comes back', async () => {
    native.pickCsvDocument.mockResolvedValue('content://doc/2');
    native.openRead.mockResolvedValue({ handle: 4, size: 500 });
    const r = (await pickCsvFile(100))!;
    expect(r.bytes.length).toBe(0);
    expect(r.size).toBe(500);
    expect(native.readAt).not.toHaveBeenCalled();
    expect(native.closeRead).toHaveBeenCalledWith(4);
  });
});
