import { ACCOUNT_LIST_SQL, balanceOf, mapAccountRows } from '../ledger/accounts';
import type { Querier } from '../planning/budgets';

/** What a backup's manifest records about the data it holds: how much, and what each account's balance is (Story 8.7). */
export interface BackupFacts {
  readonly schemaVersion: number;
  readonly counts: { readonly entries: number; readonly accounts: number; readonly photos: number };
  readonly accountBalances: readonly { readonly accountId: string; readonly balanceMinor: number }[];
}

const SCHEMA_SQL = 'SELECT COALESCE(MAX(version), 0) FROM schema_migration';
const ENTRIES_SQL = `SELECT COUNT(*) FROM "transaction" WHERE removed_at IS NULL AND status IN ('confirmed','reversed')`;
const PHOTOS_SQL = 'SELECT COUNT(*) FROM attachment';

/**
 * Reads the facts for the manifest from the live database. An account whose balance is not set has no balance to compare, so it
 * is left out; a restore compares the rest to the balances it recomputes (Story 8.8). Read only.
 */
export async function readBackupFacts(db: Querier): Promise<BackupFacts> {
  const one = async (sql: string): Promise<number> => Number((await db.query(sql))[0]?.[0] ?? 0);
  const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const balances: { accountId: string; balanceMinor: number }[] = [];
  for (const a of accounts) {
    const b = balanceOf(a);
    if (b.kind === 'known') balances.push({ accountId: a.id, balanceMinor: b.minor });
  }
  return {
    schemaVersion: await one(SCHEMA_SQL),
    counts: { entries: await one(ENTRIES_SQL), accounts: accounts.length, photos: await one(PHOTOS_SQL) },
    accountBalances: balances,
  };
}
