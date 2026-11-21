import { toLocalDate } from '../shared/clock';
import { dayMonthLabel } from '../profile/period';
import { REJECTED_KEEP_DAYS } from '../ledger/activitySearch';
import { DELETED_KEEP_DAYS } from '../ledger/purge';

/** The shortest passphrase a backup accepts: counted in characters (code points), not bytes. */
export const MIN_PASSPHRASE_CHARS = 12;

export type PassphraseHint = 'too-short' | 'strong-enough';

/** `Use at least 12 characters` until the passphrase has 12 or more characters, then `Strong enough`. */
export function passphraseHint(passphrase: string): PassphraseHint {
  return [...passphrase].length >= MIN_PASSPHRASE_CHARS ? 'strong-enough' : 'too-short';
}

export interface PassphraseCheck {
  readonly hint: PassphraseHint;
  /** `Passphrases don't match` shows while the confirmation differs (and has been started). */
  readonly mismatch: boolean;
  /** `Save backup` stays disabled until both are satisfied. */
  readonly canSave: boolean;
}

export function checkPassphrase(passphrase: string, confirmation: string): PassphraseCheck {
  const hint = passphraseHint(passphrase);
  const mismatch = confirmation.length > 0 && confirmation !== passphrase;
  return { hint, mismatch, canSave: hint === 'strong-enough' && confirmation === passphrase };
}

/** `wmbugo-backup-2026-11-08.wmbugo`, dated in the profile timezone. */
export function suggestedBackupName(nowMs: number, timezoneId: string): string {
  const d = toLocalDate(nowMs, timezoneId);
  return `wmbugo-backup-${d.ok ? d.value : 'file'}.wmbugo`;
}

/** The Data group summary: `Last backup 3 Nov` or `No backup yet`. */
export function backupSummary(lastBackupAt: number | null, timezoneId: string): string {
  if (lastBackupAt === null) return 'No backup yet';
  const d = toLocalDate(lastBackupAt, timezoneId);
  return d.ok ? `Last backup ${dayMonthLabel(d.value)}` : 'No backup yet';
}

/** `1,284 entries · 6 accounts · 42 photos`, with singular forms for one. */
export function backupCountsLine(counts: { readonly entries: number; readonly accounts: number; readonly photos: number }): string {
  const fmt = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
  return [fmt(counts.entries, 'entry', 'entries'), fmt(counts.accounts, 'account', 'accounts'), fmt(counts.photos, 'photo', 'photos')].join(' · ');
}

const TWELVE_HOUR = (tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });

/** `3 Nov 2026, 9:14 pm`, in the given time zone: when a backup was made. */
export function madeAtLabel(utcMs: number, timezoneId: string): string {
  const d = toLocalDate(utcMs, timezoneId);
  if (!d.ok) return '';
  let time: string;
  try {
    time = TWELVE_HOUR(timezoneId).format(new Date(utcMs)).replace(/\s?([AP])M/i, (_, x: string) => ` ${x.toLowerCase()}m`);
  } catch {
    time = '';
  }
  return `${dayMonthLabel(d.value)} ${d.value.slice(0, 4)}${time ? `, ${time}` : ''}`;
}

/** The read-only retention line on Settings › Data (Story 8.11): the Story 3.12 rules, from the same constants the purge uses. */
export function retentionLine(): string {
  return `Deleted entries stay in Recently deleted for ${DELETED_KEEP_DAYS} days. Rejected payments stay ${REJECTED_KEEP_DAYS} days. Then they're removed for good.`;
}
