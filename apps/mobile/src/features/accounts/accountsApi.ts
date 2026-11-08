import {
  ACCOUNT_LIST_SQL,
  AddAccount,
  ArchiveAccount,
  mapAccountRows,
  MoveAccount,
  RenameAccount,
  RestoreAccount,
  type AccountRow,
  type CurrencyCode,
  type NewAccount,
} from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

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
    const p = await readProfile(getServices().db);
    return p ? { currency: p.currency, exponent: p.exponent, locale: p.locale } : null;
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
