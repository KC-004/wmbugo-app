import {
  createFileLogSink,
  ATTACHMENT_IDS_SQL,
  RunDailyPurge,
  createIdGenerator,
  searchIndexer,
  createRedactingLogger,
  LedgerWriter,
  OutboxDispatcher,
  entryShape,
  openingBalanceShape,
  SetUpProfile,
  startStorage,
  type Invariant,
  type SetUpProfileInput,
  type SqlDatabase,
} from '@wmbugo/core';
import type { Clock, Logger, Result, StartupErrorCode, StartupOk } from '@wmbugo/core';
import migrations from '../../drizzle/migrations';
import { ensureDir, PRIVATE_DIR, rnFileStore } from './files/rnFileStore';
import { setSaveTimingSink } from '../features/add/saveTiming';
import { setNavTimingSink } from '../features/shell/navTiming';
import { invalidationHandlers, queryClient } from '../shared/queryClient';
import { BENCH_TRIGGER, runSaveBenchmark } from './benchmark';
import { keychainKeyStore } from './storage/keychainKeyStore';
import { realReceiptFiles } from './files/receiptFiles';
import { appStateScheduler } from './appStateScheduler';
import { opSqliteOpener } from './storage/opSqliteOpener';
import { secureRandom } from './storage/secureRandom';

/** There is one profile per install. */
const singleProfile: Invariant = {
  name: 'singleProfile',
  async check(ctx) {
    if (!ctx.touched.some((t) => t.entityKind === 'profile')) return null;
    const rows = await ctx.query('SELECT count(*) AS n FROM profile');
    return Number(rows[0]?.[0] ?? 0) > 1 ? 'more than one profile' : null;
  },
};

const LOG_DIR = `${PRIVATE_DIR}/logs`;
const LOG_MAX_BYTES = 256 * 1024;

/** The one place the app's real clock is read; core only ever sees this port. */
export const systemClock: Clock = {
  nowMs: () => Date.now(),
  timezoneId: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

let logger: Logger | null = null;

/** Redacting Logger writing to a size-capped file in app-private storage. */
export async function getLogger(): Promise<Logger> {
  if (logger) return logger;
  try {
    await ensureDir(LOG_DIR);
  } catch {
    /* the file sink swallows write failures; logging must never block startup */
  }
  logger = createRedactingLogger(
    createFileLogSink(rnFileStore, { path: `${LOG_DIR}/wmbugo.log`, maxBytes: LOG_MAX_BYTES, now: () => systemClock.nowMs() }),
  );
  return logger;
}

export interface AppServices {
  readonly db: SqlDatabase;
  readonly writer: LedgerWriter;
  readonly dispatcher: OutboxDispatcher;
  /** A fresh id (UUID v7), e.g. the submission id of one Add-sheet save. */
  readonly newId: () => string;
}

let services: AppServices | null = null;

/** The single LedgerWriter for the app. Available once startup succeeded. */
export function getServices(): AppServices {
  if (!services) throw new Error('storage not started');
  return services;
}

/**
 * Cold-start path: key, encrypted database, migrations, "does a profile exist?". Single-flight: a second call
 * while one is running (or after it succeeded) gets the same result, so two callers can never both create a key
 * or open a second writer. A failed start may be retried.
 */
let starting: Promise<Result<StartupOk, StartupErrorCode>> | null = null;
export function startApp(): Promise<Result<StartupOk, StartupErrorCode>> {
  if (!starting) {
    starting = startAppOnce().then(
      (r) => {
        if (!r.ok) starting = null;
        return r;
      },
      (e: unknown) => {
        starting = null;
        throw e;
      },
    );
  }
  return starting;
}

async function startAppOnce(): Promise<Result<StartupOk, StartupErrorCode>> {
  const log = await getLogger();
  const started = await startStorage({
    keyStore: keychainKeyStore,
    random: secureRandom,
    opener: opSqliteOpener,
    migrations,
    clock: systemClock,
    logger: log,
  });
  if (!started.ok) return started;

  const dispatcher = new OutboxDispatcher({
    db: started.value.db,
    clock: systemClock,
    logger: log,
    handlers: invalidationHandlers(queryClient),
  });
  const newId = createIdGenerator(systemClock, secureRandom);
  const writer = new LedgerWriter({
    uow: started.value.db,
    clock: systemClock,
    newId,
    logger: log,
    invariants: [singleProfile, openingBalanceShape, entryShape],
    indexer: searchIndexer,
    // Deliver after every commit; a failure stays pending and is retried on the next commit or launch.
    onCommitted: () => void dispatcher.deliverPending().catch(() => undefined),
  });
  services = { db: started.value.db, writer, dispatcher, newId };
  // Tab navigation timings (NFR-03) go to the redacting log; durations and tab names only.
  setNavTimingSink((e) => log.debug('nav.tab', { tab: e.tab, durationMs: e.durationMs }));
  // Save timings (NFR-04): kind and duration only.
  setSaveTimingSink((e) => log.debug('save.entry', { kind: e.kind, durationMs: e.durationMs }));
  // Receipt photos: delete files no attachment row refers to (a kill between the file write and the row commit), and any
  // decrypted copies left in the cache.
  void started.value.db
    .query(ATTACHMENT_IDS_SQL)
    .then((rows) => realReceiptFiles.sweep(new Set(rows.map((r) => String(r[0])))))
    .then(() => realReceiptFiles.clearViewCache())
    .catch(() => undefined);
  // Retention (Story 3.12): once per local day, at start or when the app comes back, expired deleted and rejected entries are
  // removed for good (their photo files after the commit).
  appStateScheduler.onStartOrResume(async () => {
    const r = await writer.run(RunDailyPurge, {}, 'system');
    if (r.ok) for (const name of r.value.fileNames) await realReceiptFiles.remove(name.replace(/\.enc$/, ''));
  });
  // Events committed before the app was last killed are delivered now, without holding up the first screen.
  void dispatcher.deliverPending().catch(() => undefined);
  // NFR-04 benchmark: only when the trigger file was placed in the private directory (debuggable builds via run-as).
  void rnFileStore.exists(BENCH_TRIGGER).then(async (on) => {
    if (!on) return;
    await rnFileStore.remove(BENCH_TRIGGER);
    await runSaveBenchmark(log, systemClock);
  });
  return started;
}

/** Finishes onboarding: writes the profile through the writer. True when saved. */
export async function setUpProfile(input: SetUpProfileInput): Promise<boolean> {
  const result = await getServices().writer.run(SetUpProfile, input, 'user');
  return result.ok;
}
