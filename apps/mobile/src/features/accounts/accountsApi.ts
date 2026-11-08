import {
  ACCOUNT_LIST_SQL,
  AddAccount,
  ArchiveAccount,
  getCurrency,
  mapAccountRows,
  MoveAccount,
  RenameAccount,
  RestoreAccount,
  type AccountRow,
  type CurrencyCode,
  type NewAccount,
} from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';

export interface ProfileCurrency {
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly locale: string;
}

/** What the accounts screen needs. The real one reads and writes through the ledger; tests pass a fake. */
export interface AccountsApi {
  profile(): Promise<ProfileCurrency | null>;
  list(): Promise<AccountRow[]>;
  add(account: NewAccount): Promise<{ ok: boolean }>;
  rename(accountId: string, name: string): Promise<{ ok: boolean; code?: string }>;
  move(accountId: string, direction: 'up' | 'down'): Promise<{ ok: boolean }>;
  archive(accountId: string): Promise<{ ok: boolean }>;
  restore(accountId: string): Promise<{ ok: boolean }>;
}

export const ACCOUNTS_QUERY_KEY = ['ledger', 'accounts'] as const;
export const PROFILE_QUERY_KEY = ['ledger', 'profile'] as const;

export const realAccountsApi: AccountsApi = {
  async profile() {
    const rows = await getServices().db.query('SELECT currency_code, currency_exponent, locale FROM profile LIMIT 1');
    const r = rows[0];
    if (!r) return null;
    const cur = getCurrency(String(r[0]));
    return cur.ok ? { currency: cur.value.code, exponent: Number(r[1]), locale: String(r[2]) } : null;
  },
  async list() {
    return mapAccountRows(await getServices().db.query(ACCOUNT_LIST_SQL));
  },
  add: (account) => getServices().writer.run(AddAccount, account, 'user'),
  rename: (accountId, name) => getServices().writer.run(RenameAccount, { accountId, name }, 'user'),
  move: (accountId, direction) => getServices().writer.run(MoveAccount, { accountId, direction }, 'user'),
  archive: (accountId) => getServices().writer.run(ArchiveAccount, { accountId }, 'user'),
  restore: (accountId) => getServices().writer.run(RestoreAccount, { accountId }, 'user'),
};
