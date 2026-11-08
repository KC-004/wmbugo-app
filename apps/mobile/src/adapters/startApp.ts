import {
  createFileLogSink,
  createIdGenerator,
  createRedactingLogger,
  LedgerWriter,
  OutboxDispatcher,
  startStorage,
} from '@wmbugo/core';
import type { Clock, Logger, Result, StartupErrorCode, StartupOk } from '@wmbugo/core';
import migrations from '../../drizzle/migrations';
import { ensureDir, PRIVATE_DIR, rnFileStore } from './files/rnFileStore';
import { invalidationHandlers, queryClient } from '../shared/queryClient';
import { keychainKeyStore } from './storage/keychainKeyStore';
import { opSqliteOpener } from './storage/opSqliteOpener';
import { secureRandom } from './storage/secureRandom';

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
  readonly writer: LedgerWriter;
  readonly dispatcher: OutboxDispatcher;
}

let services: AppServices | null = null;

/** The single LedgerWriter for the app. Available once startup succeeded. */
export function getServices(): AppServices {
  if (!services) throw new Error('storage not started');
  return services;
}

/** Cold-start path: key, encrypted database, migrations, "does a profile exist?". */
export async function startApp(): Promise<Result<StartupOk, StartupErrorCode>> {
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
  const writer = new LedgerWriter({
    uow: started.value.db,
    clock: systemClock,
    newId: createIdGenerator(systemClock, secureRandom),
    logger: log,
    // Deliver after every commit; a failure stays pending and is retried on the next commit or launch.
    onCommitted: () => void dispatcher.deliverPending().catch(() => undefined),
  });
  services = { writer, dispatcher };
  // Events committed before the app was last killed are delivered now, without holding up the first screen.
  void dispatcher.deliverPending().catch(() => undefined);
  return started;
}
