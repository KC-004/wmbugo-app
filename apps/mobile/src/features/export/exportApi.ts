import {
  exportAccountsCsv,
  exportFileName,
  exportTransactionsCsv,
  mapAccountRows,
  ACCOUNT_LIST_SQL,
  periodRule,
  resolveExportPeriod,
  toLocalDate,
  type ExportKind,
  type ExportOptions,
  type ExportPeriodChoice,
  type ExportPeriodError,
  type PeriodProfile,
} from '@wmbugo/core';
import { createCsvDocument } from '../../adapters/backup/backupFiles';
import { readProfile } from '../../adapters/readProfile';
import { getServices, systemClock } from '../../adapters/startApp';

export interface ExportAccount {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

/** What the screen needs to know before it offers choices. */
export interface ExportContext {
  readonly accounts: readonly ExportAccount[];
  readonly today: string;
  readonly timezoneId: string;
  readonly currency: string;
  readonly exponent: number;
  readonly firstEntryDate: string | null;
  readonly profile: PeriodProfile;
}

export interface ExportRequest {
  readonly kind: ExportKind;
  readonly choice: ExportPeriodChoice;
  readonly custom?: { readonly start: string; readonly end: string };
  /** null exports every account. */
  readonly accountIds: readonly string[] | null;
  readonly includeNumbers: boolean;
}

export interface ExportRunHooks {
  onProgress(done: number, total: number): void;
  isCancelled(): boolean;
}

export type ExportOutcome =
  | { readonly kind: 'saved'; readonly export: ExportKind; readonly count: number }
  /** The person closed the save dialog: nothing was written. */
  | { readonly kind: 'dialog_cancelled' }
  /** Cancel while writing: the partial document was deleted. */
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'invalid_period'; readonly code: ExportPeriodError }
  | { readonly kind: 'failed' };

export interface ExportApi {
  context(): Promise<ExportContext | null>;
  run(request: ExportRequest, hooks: ExportRunHooks): Promise<ExportOutcome>;
}

const FIRST_ENTRY_SQL = "SELECT MIN(local_date) FROM \"transaction\" WHERE status = 'confirmed' AND removed_at IS NULL AND event_type IN ('expense','income','transfer','refund','adjustment')";

export const realExportApi: ExportApi = {
  async context() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const today = toLocalDate(systemClock.nowMs(), systemClock.timezoneId());
    if (!today.ok) return null;
    const first = (await db.query(FIRST_ENTRY_SQL))[0]?.[0];
    return {
      accounts: mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).map((a) => ({ id: a.id, name: a.name, archived: a.status === 'archived' })),
      today: today.value,
      timezoneId: p.timezoneId,
      currency: p.currency,
      exponent: p.exponent,
      firstEntryDate: first === null || first === undefined ? null : String(first),
      profile: { rule: periodRule(p.payday, p.settings.periodMode), firstDay: p.settings.firstDay },
    };
  },

  async run(request, hooks) {
    const ctx = await this.context();
    if (!ctx) return { kind: 'failed' };
    const range = resolveExportPeriod(request.choice, ctx.today, ctx.profile, ctx.firstEntryDate, request.custom);
    if (!range.ok) return { kind: 'invalid_period', code: range.code };
    const chosen = request.accountIds === null ? [] : ctx.accounts.filter((a) => request.accountIds!.includes(a.id)).map((a) => a.name);
    const options: ExportOptions = {
      range: range.value,
      accountIds: request.accountIds,
      accountNames: chosen,
      includeNumbers: request.includeNumbers,
      // The app does not keep account numbers, so there are no digits to mask: the column stays empty (Story 9.9).
      numbers: new Map(),
      timezoneId: ctx.timezoneId,
      currency: ctx.currency,
      exponent: ctx.exponent,
    };
    let doc;
    try {
      doc = await createCsvDocument(exportFileName(request.kind, range.value));
    } catch {
      return { kind: 'failed' };
    }
    if (doc === null) return { kind: 'dialog_cancelled' };
    try {
      const db = getServices().db;
      const done = request.kind === 'transactions' ? await exportTransactionsCsv(db, options, doc.sink, hooks) : await exportAccountsCsv(db, options, doc.sink, hooks);
      if (!done.ok) {
        // Cancelled, a full destination or a provider error: the partial document is deleted, nothing is left in the person's folder.
        await doc.abort().catch(() => undefined);
        return done.code === 'CANCELLED' ? { kind: 'cancelled' } : { kind: 'failed' };
      }
      await doc.commit();
      return { kind: 'saved', export: request.kind, count: 'entries' in done.value ? done.value.entries : done.value.accounts };
    } catch {
      await doc.abort().catch(() => undefined);
      return { kind: 'failed' };
    }
  },
};
