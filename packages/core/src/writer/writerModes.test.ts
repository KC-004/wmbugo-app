import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { ok } from '../shared/result';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { MemoryDatabase } from './fakes';
import { AnnounceBackupRestored } from '../backup/restore';
import { EVENT_CATALOGUE, areasFor } from './events';
import { LedgerWriter, type UseCase } from './ledgerWriter';

function setup() {
  const db = new MemoryDatabase();
  const clock = new FakeClock(1_700_000_000_000);
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(1)), logger: createRedactingLogger({ write: () => undefined }) });
  return { db, writer };
}

const noop: UseCase<void, string, never> = {
  name: 'Noop',
  async execute(ctx) {
    await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', ['x']);
    return ok('ran');
  },
};

describe('writer maintenance mode (Story 8.8)', () => {
  it('refuses every use case with MAINTENANCE, writes nothing, and resumes when it ends', async () => {
    const { db, writer } = setup();
    writer.setMaintenance(true);
    expect(await writer.run(noop, undefined, 'user')).toEqual({ ok: false, code: 'MAINTENANCE' });
    expect(await writer.run(noop, undefined, 'system')).toEqual({ ok: false, code: 'MAINTENANCE' }); // scheduled work skips itself
    expect(db.data).toEqual([]);
    writer.setMaintenance(false);
    expect(await writer.run(noop, undefined, 'user')).toEqual({ ok: true, value: 'ran' });
  });

  it('an exclusive job (the restore itself) still runs during maintenance', async () => {
    const { writer } = setup();
    writer.setMaintenance(true);
    expect(await writer.exclusive(async () => 'restoring')).toBe('restoring');
  });
});

describe('writer safe mode (Story 8.12)', () => {
  it('refuses every use case with SAFE_MODE, keeps the reason, and nothing is written', async () => {
    const { db, writer } = setup();
    expect(writer.inSafeMode).toBe(false);
    writer.setSafeMode('quick_check_failed');
    expect(writer.inSafeMode).toBe(true);
    expect(writer.safeReason).toBe('quick_check_failed');
    expect(await writer.run(noop, undefined, 'user')).toEqual({ ok: false, code: 'SAFE_MODE' });
    expect(await writer.run(noop, undefined, 'system')).toEqual({ ok: false, code: 'SAFE_MODE' });
    expect(db.data).toEqual([]);
    writer.setSafeMode(null);
    expect((await writer.run(noop, undefined, 'user')).ok).toBe(true);
  });

  it('safe mode wins over maintenance', async () => {
    const { writer } = setup();
    writer.setMaintenance(true);
    writer.setSafeMode('x');
    expect(await writer.run(noop, undefined, 'user')).toEqual({ ok: false, code: 'SAFE_MODE' });
  });
});

describe('BackupRestored', () => {
  it('is in the catalogue and invalidates every area; AnnounceBackupRestored raises it', async () => {
    expect(areasFor('BackupRestored')).toEqual(expect.arrayContaining(['ledger', 'budgets', 'plan', 'bills', 'goals', 'insights', 'home', 'widget']));
    expect(Object.keys(EVENT_CATALOGUE)).toContain('BackupRestored');
    const { db, writer } = setup();
    expect((await writer.run(AnnounceBackupRestored, undefined, 'system')).ok).toBe(true);
    expect(db.outbox.map((o) => o.event)).toContain('BackupRestored');
  });
});
