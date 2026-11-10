import {
  mapDeletedRows,
  mapPurgeFacts,
  PURGE_FACTS_SQL,
  PurgeEntry,
  RECENTLY_DELETED_SQL,
  recentlyDeletedSince,
  RestoreDeleted,
  RestoreRejected,
  RestoreTransaction,
  type CurrencyCode,
  type DeletedRow,
  type PurgeFacts,
  type TxSnapshot,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface DeletedData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly rows: DeletedRow[];
}

type Snap = { ok: true; value: { snapshot: TxSnapshot } } | { ok: false; code: string };

export interface DeletedApi {
  load(): Promise<DeletedData | null>;
  /** Restore a deleted manual entry (kind 'deleted') or a rejected capture (kind 'rejected'). */
  restore(transactionId: string, kind: 'deleted' | 'rejected'): Promise<Snap>;
  undoRestore(snapshot: TxSnapshot): Promise<{ ok: boolean }>;
  purgeFacts(transactionId: string): Promise<PurgeFacts>;
  /** Delete permanently: removes the entry for good and leaves a tombstone. */
  purge(transactionId: string): Promise<{ ok: boolean; value?: { fileNames: string[] } }>;
}

export const DELETED_QUERY_KEY = ['ledger', 'deleted'] as const;

export const realDeletedApi: DeletedApi = {
  async load() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const now = systemClock.nowMs();
    return { currency: p.currency, locale: p.locale, rows: mapDeletedRows(await db.query(RECENTLY_DELETED_SQL, [recentlyDeletedSince(now)]), now) };
  },
  restore: (transactionId, kind) => getServices().writer.run(kind === 'deleted' ? RestoreDeleted : RestoreRejected, { transactionId }, 'user'),
  undoRestore: (snapshot) => getServices().writer.run(RestoreTransaction, { snapshot }, 'user'),
  async purgeFacts(transactionId) {
    return mapPurgeFacts(await getServices().db.query(PURGE_FACTS_SQL, [transactionId])) ?? { isTransfer: false, hasRefund: false };
  },
  async purge(transactionId) {
    const r = await getServices().writer.run(PurgeEntry, { transactionId }, 'user');
    if (!r.ok) return { ok: false };
    // The row and the entry are gone and committed: now any photo files.
    const { realReceiptFiles } = await import('../../adapters/files/receiptFiles');
    for (const name of r.value.fileNames) await realReceiptFiles.remove(name.replace(/\.enc$/, '')).catch(() => undefined);
    return { ok: true, value: { fileNames: r.value.fileNames } };
  },
};
