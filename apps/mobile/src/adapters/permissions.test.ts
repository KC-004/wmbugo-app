import fs from 'node:fs';
import path from 'node:path';
import { PermissionsAndroid } from 'react-native';

jest.mock('./notifier', () => ({
  appNotifier: { available: true, permission: jest.fn(async () => 'granted'), requestPermission: jest.fn(async () => 'granted') },
}));

import { appNotifier } from './notifier';
import { PERMISSION_VIEW_AREAS, permissionState, refreshPermissionViews, requestPermission } from './permissions';

const repo = path.resolve(__dirname, '../../../..');
const md = fs.readFileSync(path.join(repo, 'apps/mobile/src/shared/PERMISSIONS.md'), 'utf8');
const allowlist = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/android-permission-allowlist.json'), 'utf8')) as { allowed: string[] };

describe('permission inventory', () => {
  it('has a PERMISSIONS.md row for every permission on the release allowlist', () => {
    for (const permission of allowlist.allowed) {
      const short = permission.replace('${applicationId}.', '').replace('android.permission.', '');
      // Only a table row counts: prose that mentions the permission name does not satisfy the inventory.
      const row = md.split('\n').find((l) => l.startsWith('|') && (l.includes(`\`${permission.replace('${applicationId}', '<applicationId>')}\``) || l.includes(`\`${short}\``)));
      expect({ permission, row: Boolean(row) }).toEqual({ permission, row: true });
    }
  });

  it('every row names the feature, the rationale, the denied behaviour and revocation (five filled cells)', () => {
    const rows = md.split('\n').filter((l) => /^\| `/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(allowlist.allowed.length);
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((c) => c.trim());
      expect(cells).toHaveLength(6);
      for (const c of cells) expect(c.length).toBeGreaterThan(0);
    }
  });

  it('requests no runtime permission anywhere but the shared helper', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'permissions.ts' && e.name !== 'notifier.ts') {
          const text = fs.readFileSync(full, 'utf8');
          if (/PermissionsAndroid\.request|\.requestPermission\(\)/.test(text)) offenders.push(path.relative(repo, full));
        }
      }
    };
    walk(path.join(repo, 'apps/mobile/src'));
    expect(offenders).toEqual([]);
  });
});

describe('requestPermission and revocation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('goes through the notifier and does not touch PermissionsAndroid', async () => {
    const spy = jest.spyOn(PermissionsAndroid, 'request');
    expect(await requestPermission('notifications')).toBe('granted');
    expect(appNotifier.requestPermission).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reads the state fresh each time', async () => {
    (appNotifier.permission as jest.Mock).mockResolvedValueOnce('denied').mockResolvedValueOnce('granted');
    expect(await permissionState('notifications')).toBe('denied');
    expect(await permissionState('notifications')).toBe('granted');
  });

  it('on resume invalidates the screens that show the permission state, without prompting', async () => {
    const keys: unknown[][] = [];
    await refreshPermissionViews({ invalidateQueries: async (f) => void keys.push([...f.queryKey]) });
    expect(keys).toEqual(PERMISSION_VIEW_AREAS.map((a) => [a]));
    expect(appNotifier.requestPermission).not.toHaveBeenCalled();
  });
});

describe('the camera permission (Story 10.7)', () => {
  const vision = { VisionCamera: { cameraPermissionStatus: 'not-determined', requestCameraPermission: jest.fn(async () => true) } };
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native-vision-camera', () => vision, { virtual: true });
  });

  it('asks through VisionCamera, never PermissionsAndroid, and reports the new state', async () => {
    const spy = jest.spyOn(PermissionsAndroid, 'request');
    vision.VisionCamera.requestCameraPermission.mockImplementationOnce(async () => {
      vision.VisionCamera.cameraPermissionStatus = 'authorized';
      return true;
    });
    const p = jest.requireActual<typeof import('./permissions')>('./permissions');
    expect(await p.permissionState('camera')).toBe('undetermined');
    expect(await p.requestPermission('camera')).toBe('granted');
    expect(spy).not.toHaveBeenCalled();
    vision.VisionCamera.cameraPermissionStatus = 'denied';
    expect(await p.permissionState('camera')).toBe('denied');
  });

  it('is denied (never a crash) when the camera module cannot load', async () => {
    jest.doMock('react-native-vision-camera', () => { throw new Error('no native module'); }, { virtual: true });
    const p = jest.requireActual<typeof import('./permissions')>('./permissions');
    expect(await p.permissionState('camera')).toBe('denied');
    expect(await p.requestPermission('camera')).toBe('denied');
  });
});
