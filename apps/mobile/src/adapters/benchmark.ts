import { ANDROID_DATABASE_PATH } from '@op-engineering/op-sqlite';
import {
  AddAccount,
  createIdGenerator,
  createRedactingLogger,
  entryShape,
  findRegion,
  LedgerWriter,
  openingBalanceShape,
  SubmitCapture,
  searchIndexer,
  SetUpProfile,
  startStorage,
  type KeyStore,
  type Logger,
  type SqlDatabase,
} from '@wmbugo/core';
import migrations from '../../drizzle/migrations';
import { PRIVATE_DIR, rnFileStore } from './files/rnFileStore';
import { createOpSqliteOpener } from './storage/opSqliteOpener';
import { secureRandom } from './storage/secureRandom';

/** Dropping this file into the app's private files (run-as, debuggable build only) runs the save benchmark once at launch. */
export const BENCH_TRIGGER = `${PRIVATE_DIR}/bench-save`;
const BENCH_DB = 'wmbugo-bench.db';
const SEED_ENTRIES = 10_000;
const RUNS = 53; // 3 warm-up + 50 measured (S8 method: p95 needs about 50 samples)
const WARMUP = 3;

const memoryKey = (): KeyStore => {
  let key: string | null = null;
  return { getKey: async () => key, setKey: async (k) => ((key = k), true) };
};

/** Inserts S10k-style data (10,000 entries over 24 months, three categories) in large batches. */
async function seed(db: SqlDatabase, accountId: string, newId: () => string, now: number): Promise<void> {
  const CATS = ['cat_food', 'cat_groceries', 'cat_transport'];
  const DAY = 86_400_000;
  for (let start = 0; start < SEED_ENTRIES; start += 500) {
    const statements = [];
    for (let i = start; i < Math.min(start + 500, SEED_ENTRIES); i++) {
      const at = now - Math.floor((i / SEED_ENTRIES) * 730) * DAY;
      const date = new Date(at).toISOString().slice(0, 10);
      const amount = 100 + (i % 9000);
      const t = newId();
      statements.push(
        { sql: 'INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, tags_json, needs_category, created_at, updated_at) VALUES (?, \'expense\', \'confirmed\', ?, ?, ?, \'UTC\', \'[]\', 0, ?, ?)', params: [t, amount, at, date, at, at] },
        { sql: 'INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, \'out\', ?, \'normal\')', params: [newId(), t, accountId, -amount] },
        { sql: 'INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, ?, ?)', params: [newId(), t, CATS[i % 3]!, amount] },
      );
    }
    await db.executeBatch(statements);
  }
}

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

/**
 * NFR-04 on the device: a separate encrypted database (its own random key, never the user's) is migrated,
 * seeded with 10,000 entries and timed over 50 real `SubmitCapture` writes (3 warm-up). Results go to the
 * log as `bench.save`; the file is deleted afterwards. The user's ledger is never opened or changed.
 */
export async function runSaveBenchmark(log: Logger, clock: { nowMs(): number; timezoneId(): string }): Promise<void> {
  const quiet = createRedactingLogger({ write: () => undefined });
  const opener = createOpSqliteOpener(BENCH_DB);
  const started = await startStorage({ keyStore: memoryKey(), random: secureRandom, opener, migrations, clock, logger: quiet });
  if (!started.ok) {
    log.warn('bench.save', { ok: false, code: started.code });
    return;
  }
  const db = started.value.db;
  try {
    const newId = createIdGenerator(clock, secureRandom);
    const writer = new LedgerWriter({ uow: db, clock, newId, logger: quiet, invariants: [openingBalanceShape, entryShape], indexer: searchIndexer });
    const region = findRegion('IN');
    if (!region) throw new Error('region');
    await writer.run(SetUpProfile, { region, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: clock.timezoneId() }, 'user');
    await writer.run(AddAccount, { name: 'Bench', type: 'bank', openingMinor: 10_000_00 }, 'user');
    const accountId = String((await db.query('SELECT id FROM account'))[0]![0]);
    await seed(db, accountId, newId, clock.nowMs());

    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const r = await writer.run(SubmitCapture, { submissionId: `bench-${i}`, sourceKind: 'manual', entry: { kind: 'expense', amountMinor: 1250 + i, categoryId: 'cat_food', accountId } }, 'user');
      const ms = performance.now() - t0;
      if (!r.ok) throw new Error(r.code);
      if (i >= WARMUP) times.push(ms);
    }
    const sorted = [...times].sort((a, b) => a - b);
    log.info('bench.save', {
      ok: true,
      seeded: SEED_ENTRIES,
      runs: times.length,
      discarded: WARMUP,
      medianMs: Math.round(percentile(sorted, 50) * 10) / 10,
      p95Ms: Math.round(percentile(sorted, 95) * 10) / 10,
      worstMs: Math.round(sorted[sorted.length - 1]! * 10) / 10,
    });
  } catch (e) {
    log.warn('bench.save', { ok: false, error: e instanceof Error ? e.message : 'failed' });
  } finally {
    await db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${ANDROID_DATABASE_PATH}/${BENCH_DB}${suffix}`;
      if (await rnFileStore.exists(path)) await rnFileStore.remove(path);
    }
  }
}
