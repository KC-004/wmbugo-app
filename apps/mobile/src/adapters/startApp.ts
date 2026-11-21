import {
  createCrashRecorder,
  AnnounceBackupRestored,
  finishInterruptedErase,
  type InterruptedErase,
  recoverRestore,
  type RecoverOutcome,
  createFileLogSink,
  ATTACHMENT_IDS_SQL,
  budgetAlertHandlers,
  EvaluateBudgetAlerts,
  RebuildBudgetPeriods,
  ReleaseBillLinks,
  ReleaseGoalMoves,
  syncBillReminders,
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
import type { Clock, CrashRecorder, Logger, Result, StartupErrorCode, StartupOk } from '@wmbugo/core';
import migrations from '../../drizzle/migrations';
import { installCrashHandlers } from './crashHandlers';
import { refreshPermissionViews } from './permissions';
import { sweepStaging } from './backup/rnBackupPlatform';
import { localToday, scheduleIntegrityChecks } from './safeMode';
import { interruptedEraseDeps } from './backup/rnErase';
import { restoredDatabaseOpens, RESTORE_LAYOUT, rnRestoreFs } from './backup/rnRestore';
import { ensureDir, PRIVATE_DIR, rnFileStore } from './files/rnFileStore';
import { setSaveTimingSink } from '../features/add/saveTiming';
import { setNavTimingSink } from '../features/shell/navTiming';
import { invalidationHandlers, queryClient } from '../shared/queryClient';
import { BENCH_TRIGGER, runSaveBenchmark } from './benchmark';
import { keychainKeyStore } from './storage/keychainKeyStore';
import { appNotifier, postCaptureFixture, privacyFromSettings, setNotificationPrivacyReader, withNotificationRepost } from './notifier';
import { readProfile } from './readProfile';
import { withBudgetHandlers } from './budgetHandlers';
import { serialize, withBillHandlers, withReminderSync } from './billHandlers';
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
const CAPTURE_FIXTURE_TRIGGER = `${PRIVATE_DIR}/post-capture-fixture`;
/** Rotates at 1 MiB with one previous file kept, so the log never takes more than 2 MiB (Story 8.1). */
export const LOG_MAX_BYTES = 1024 * 1024;
const CRASH_DIR = `${PRIVATE_DIR}/crashes`;
/** The current log file (the previous one is `<path>.1`). */
export const LOG_PATH = `${LOG_DIR}/wmbugo.log`;
/** Matches `versionName` in android/app/build.gradle. */
const APP_VERSION = '1.0';

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
    createFileLogSink(rnFileStore, { path: LOG_PATH, maxBytes: LOG_MAX_BYTES, now: () => systemClock.nowMs() }),
  );
  return logger;
}

let crashRecorder: CrashRecorder | null = null;

/** Local crash records in app-private storage: redacted, newest 20, never sent anywhere (Story 8.1). */
export function getCrashRecorder(): CrashRecorder {
  if (!crashRecorder) {
    crashRecorder = createCrashRecorder(rnFileStore, {
      dir: CRASH_DIR,
      context: () => ({ now: systemClock.nowMs(), appVersion: APP_VERSION, schemaVersion: migrations.journal.entries.length }),
    });
  }
  return crashRecorder;
}

/** Called once from index.js before the app registers, so an error during startup is recorded too. */
export function installCrashCapture(): void {
  void ensureDir(CRASH_DIR).catch(() => undefined);
  installCrashHandlers(getCrashRecorder());
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

/** What the last start found about a restore (Story 8.8): shown once on Home, then cleared. */
let restoreOutcome: RecoverOutcome = 'none';
export function takeRestoreOutcome(): RecoverOutcome {
  const o = restoreOutcome;
  restoreOutcome = 'none';
  return o;
}

async function startAppOnce(): Promise<Result<StartupOk, StartupErrorCode>> {
  // An erase that was interrupted is finished before anything else, even before the logger exists, so that it does not hold open
  // a log file the erase deletes (Story 8.11). The start that follows has no database and no key, so it opens Welcome. If the erase
  // cannot be finished the start stops: opening half-erased data would let new entries be wiped by the next start's erase.
  let erase: InterruptedErase = 'none';
  try {
    erase = await finishInterruptedErase(interruptedEraseDeps());
  } catch {
    erase = 'failed';
  }
  const log = await getLogger();
  if (erase === 'failed') {
    log.error('erase.recovery_failed');
    return { ok: false, code: 'ERASE_UNFINISHED' };
  }
  // The erase is not written about in the log it just deleted: the log of the next start begins here.
  // A restore that was killed, or that did not hold, is finished or undone before the database is opened (Story 8.8). If that cannot
  // be done the start stops: a half-moved database must not be opened.
  try {
    const recovered = await recoverRestore(rnRestoreFs, RESTORE_LAYOUT, restoredDatabaseOpens);
    // A start that is retried after a failure must not forget what the first start found.
    if (recovered !== 'none') restoreOutcome = recovered;
    if (recovered !== 'none') log.warn('restore.recovered', { reason: recovered });
  } catch {
    log.error('restore.recovery_failed');
    return { ok: false, code: 'STORAGE_UNSAFE' };
  }
  const started = await startStorage({
    keyStore: keychainKeyStore,
    random: secureRandom,
    opener: opSqliteOpener,
    migrations,
    clock: systemClock,
    logger: log,
  });
  if (!started.ok) return started;

  // Every reminder sync (a change, the app starting or coming back) goes through one queue, so a slower older sync cannot land last.
  const syncReminders = serialize(() => syncBillReminders(started.value.db, appNotifier, systemClock.nowMs()).then(() => undefined));
  const dispatcher = new OutboxDispatcher({
    db: started.value.db,
    clock: systemClock,
    logger: log,
    handlers: withNotificationRepost(withReminderSync(withBillHandlers(withBudgetHandlers(invalidationHandlers(queryClient), async () => {
      // Payday, the period mode or the first day of the week changed: the derived budget periods are rebuilt from the period
      // service (Story 4.5). A failure is logged and the cache is rebuilt on the next change; no entry is touched either way.
      const w = services?.writer;
      if (!w) return;
      const r = await w.run(RebuildBudgetPeriods, {}, 'system');
      if (!r.ok) log.warn('budget.rebuild_failed', { code: r.code });
    }, budgetAlertHandlers({
      // A change re-checks the current period; the crossing posts through the notifier port (Story 4.9).
      evaluate: async () => {
        const w = services?.writer;
        if (w) await w.run(EvaluateBudgetAlerts, {}, 'system');
      },
      notifier: appNotifier,
      db: started.value.db,
      nowMs: () => systemClock.nowMs(),
    }), log), async () => {
      // A linked entry was deleted, rejected or excluded: its bill's due date is unpaid again (Story 6.3).
      const w = services?.writer;
      if (!w) return;
      // Each release stands alone: a failure in the first must not skip the second.
      await w.run(ReleaseBillLinks, {}, 'system').catch(() => log.warn('bills.release_threw'));
      // A savings move that was deleted, rejected or excluded stops counting toward its goal (Story 6.7).
      await w.run(ReleaseGoalMoves, {}, 'system').catch(() => log.warn('goals.release_threw'));
    }, log), syncReminders, log)),
  });
  // Notification privacy (Story 8.5): every notification passes through the form decided from the saved settings.
  // A profile that cannot be read is the most private form, not the default one.
  setNotificationPrivacyReader(async () => privacyFromSettings((await readProfile(started.value.db))?.settings));
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
  // Bill reminders are scheduled again at start and whenever the app comes back (Story 6.5): the window moves with the day.
  appStateScheduler.onStartOrResume(() => syncReminders().catch(() => log.warn('bills.reminder_sync_threw')));
  // A notification permission changed in Android settings while the app was away shows on the next screen read (Story 8.1).
  appStateScheduler.onStartOrResume(() => void Promise.resolve(refreshPermissionViews(queryClient)).catch(() => undefined));
  // Events committed before the app was last killed are delivered now, without holding up the first screen.
  void dispatcher.deliverPending().catch(() => undefined);
  // NFR-04 benchmark: only when the trigger file was placed in the private directory (debuggable builds via run-as).
  void rnFileStore.exists(BENCH_TRIGGER).then(async (on) => {
    if (!on) return;
    await rnFileStore.remove(BENCH_TRIGGER);
    await runSaveBenchmark(log, systemClock);
  });
  // A backup or restore that was interrupted leaves staging behind: it is swept at every start (Story 8.7). Not after a restore that
  // just held: its journal is already gone and nothing is in staging.
  void sweepStaging().catch(() => undefined);
  // The first start after a restore that held: every query is invalidated and reminders are planned again from the restored data.
  if (restoreOutcome === 'restored') void writer.run(AnnounceBackupRestored, undefined, 'system').catch(() => undefined);
  // Safe mode (Story 8.12): `quick_check` once after the first frame and once per local day. A failure stops every write.
  scheduleIntegrityChecks(started.value.db, writer, log, () => localToday(systemClock.nowMs(), systemClock.timezoneId()), (task) => appStateScheduler.onStartOrResume(task));
  // Debug-only fixture (Story 8.5): a file placed in the private directory posts the hidden capture notification once. Not in a
  // release build, and a failure here is never a crash.
  if (__DEV__) {
    void rnFileStore
      .exists(CAPTURE_FIXTURE_TRIGGER)
      .then(async (on) => {
        if (!on) return;
        await rnFileStore.remove(CAPTURE_FIXTURE_TRIGGER);
        await postCaptureFixture();
      })
      .catch(() => undefined);
  }
  return started;
}

/** Finishes onboarding: writes the profile through the writer. True when saved. */
export async function setUpProfile(input: SetUpProfileInput): Promise<boolean> {
  const result = await getServices().writer.run(SetUpProfile, input, 'user');
  return result.ok;
}
