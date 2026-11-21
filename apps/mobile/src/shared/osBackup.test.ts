import fs from 'node:fs';
import path from 'node:path';

const res = path.resolve(__dirname, '../../android/app/src/main');
const read = (p: string) => fs.readFileSync(path.join(res, p), 'utf8');
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];

describe("Android's own backup excludes wmbugo (Story 8.7, BKP-006)", () => {
  it('the manifest turns backup off and points at both rule files', () => {
    const m = read('AndroidManifest.xml');
    expect(m).toMatch(/android:allowBackup="false"/);
    expect(m).toMatch(/android:fullBackupContent="@xml\/backup_rules"/);
    expect(m).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
  });

  it('backup_rules.xml (Android 11 and earlier) excludes every domain and includes nothing', () => {
    const x = read('res/xml/backup_rules.xml');
    for (const d of DOMAINS) expect(x).toContain(`<exclude domain="${d}" path="." />`);
    expect(x).not.toMatch(/<include\b/);
  });

  it('data_extraction_rules.xml (Android 12 and later) excludes every domain from cloud backup and device transfer, and includes nothing', () => {
    const x = read('res/xml/data_extraction_rules.xml');
    for (const section of ['cloud-backup', 'device-transfer']) {
      const body = x.slice(x.indexOf(`<${section}>`), x.indexOf(`</${section}>`));
      expect(body.length).toBeGreaterThan(0);
      for (const d of DOMAINS) expect(body).toContain(`<exclude domain="${d}" path="." />`);
    }
    expect(x).not.toMatch(/<include\b/);
  });

  it('PERMISSIONS.md documents that user-saved backup and export files leave wmbugo\'s control', () => {
    const md = fs.readFileSync(path.resolve(__dirname, 'PERMISSIONS.md'), 'utf8');
    expect(md).toMatch(/leave wmbugo's control/);
    expect(md).toMatch(/bmgr backupnow app\.wmbugo/);
  });
});
