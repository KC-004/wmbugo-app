import { toLocalDate } from '../shared/clock';
import { getCurrency } from '../shared/currency';
import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import type { PaydayRule } from './payday';
import type { Region } from './regions';
import { SETTING_DEFAULT_ACCOUNT, validateSetting } from './settings';
import { nextLocalDate, offsetMinutes, PROMPT_TIMEZONE, SETTING_TZ_MISMATCH_SINCE, SETTING_TZ_PENDING, TIMEZONE_GAP_MINUTES } from './timezone';

async function upsertSetting(ctx: WriterContext, key: string, value: unknown): Promise<void> {
  await ctx.execute(
    'INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, version = version + 1, updated_at = excluded.updated_at',
    [key, JSON.stringify(value), ctx.nowMs()],
  );
}

async function readSetting(ctx: WriterContext, key: string): Promise<unknown> {
  const rows = await ctx.query('SELECT value_json FROM settings WHERE key = ?', [key]);
  if (rows.length === 0) return undefined;
  try {
    return JSON.parse(String(rows[0]![0]));
  } catch {
    return undefined;
  }
}

/** Changes one setting. The value is validated per key; the audit row records the key, never the value. */
export const ChangeSetting: UseCase<{ key: string; value: unknown }, void, 'SETTING_INVALID' | 'ACCOUNT_NOT_FOUND'> = {
  name: 'ChangeSetting',
  async execute(ctx, input) {
    const v = validateSetting(input.key, input.value);
    if (!v.ok) return err('SETTING_INVALID');
    if (input.key === SETTING_DEFAULT_ACCOUNT && v.value !== null) {
      const a = await ctx.query("SELECT 1 FROM account WHERE id = ? AND status = 'active'", [v.value as string]);
      if (a.length === 0) return err('ACCOUNT_NOT_FOUND');
    }
    await upsertSetting(ctx, input.key, v.value);
    ctx.touch('settings', input.key, { changed: true });
    ctx.emit('ProfileChanged', { fields: [input.key] });
    return ok(undefined);
  },
};

export interface ProfileChange {
  readonly region?: Region;
  readonly payday?: PaydayRule;
  readonly timezoneId?: string;
}

export type ChangeProfileError = 'NO_PROFILE' | 'CURRENCY_LOCKED' | 'CURRENCY_UNSUPPORTED' | 'TIMEZONE_INVALID' | 'NOTHING_TO_CHANGE';

/**
 * Money basics: region and currency, payday and timezone. A currency change is refused once any
 * transaction exists (amounts are stored in the currency's minor units); no transaction is ever modified.
 */
export const ChangeProfile: UseCase<ProfileChange, void, ChangeProfileError> = {
  name: 'ChangeProfile',
  async execute(ctx, input) {
    if (!input.region && !input.payday && !input.timezoneId) return err('NOTHING_TO_CHANGE');
    const p = (await ctx.query('SELECT id, currency_code FROM profile LIMIT 1'))[0];
    if (!p) return err('NO_PROFILE');
    const fields: string[] = [];

    if (input.region) {
      const cur = getCurrency(input.region.currency);
      if (!cur.ok) return err('CURRENCY_UNSUPPORTED');
      if (cur.value.code !== String(p[1])) {
        const n = Number((await ctx.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
        if (n > 0) return err('CURRENCY_LOCKED');
      }
      await ctx.execute('UPDATE profile SET region = ?, currency_code = ?, currency_exponent = ?, locale = ? WHERE id = ?', [
        input.region.code,
        cur.value.code,
        cur.value.exponent,
        input.region.locale,
        String(p[0]),
      ]);
      fields.push('region', 'currency');
    }
    if (input.payday) {
      await ctx.execute('UPDATE profile SET payday_rule = ?, payday_day = ? WHERE id = ?', [input.payday.kind, input.payday.kind === 'day' ? input.payday.day : null, String(p[0])]);
      fields.push('payday');
    }
    if (input.timezoneId) {
      if (!toLocalDate(ctx.nowMs(), input.timezoneId).ok) return err('TIMEZONE_INVALID');
      await ctx.execute('UPDATE profile SET timezone_id = ? WHERE id = ?', [input.timezoneId, String(p[0])]);
      await ctx.execute('DELETE FROM settings WHERE key = ?', [SETTING_TZ_PENDING]);
      fields.push('timezone');
    }
    ctx.touch('profile', String(p[0]), { fields: fields.join(',') });
    ctx.emit('ProfileChanged', { fields });
    return ok(undefined);
  },
};

/**
 * Remembers when the device zone started to differ from the profile zone by two hours or more
 * (and forgets it when they match again), so the prompt can wait for more than 24 hours.
 */
export const TrackTimezone: UseCase<{ deviceTz: string }, void, 'NO_PROFILE'> = {
  name: 'TrackTimezone',
  async execute(ctx, input) {
    const p = (await ctx.query('SELECT timezone_id FROM profile LIMIT 1'))[0];
    if (!p) return err('NO_PROFILE');
    const now = ctx.nowMs();
    const a = offsetMinutes(String(p[0]), now);
    const b = offsetMinutes(input.deviceTz, now);
    const differs = a !== null && b !== null && Math.abs(a - b) >= TIMEZONE_GAP_MINUTES;
    const since = await readSetting(ctx, SETTING_TZ_MISMATCH_SINCE);
    if (differs && since === undefined) await upsertSetting(ctx, SETTING_TZ_MISMATCH_SINCE, now);
    else if (!differs && since !== undefined) await ctx.execute('DELETE FROM settings WHERE key = ?', [SETTING_TZ_MISMATCH_SINCE]);
    return ok(undefined);
  },
};

/** The answer to "use it for your budget days?": recorded once; Yes takes effect from the next day only. */
export const AnswerTimezonePrompt: UseCase<{ use: boolean; deviceTz: string }, void, 'NO_PROFILE' | 'TIMEZONE_INVALID'> = {
  name: 'AnswerTimezonePrompt',
  async execute(ctx, input) {
    const p = (await ctx.query('SELECT timezone_id FROM profile LIMIT 1'))[0];
    if (!p) return err('NO_PROFILE');
    if (input.use) {
      if (!toLocalDate(ctx.nowMs(), input.deviceTz).ok) return err('TIMEZONE_INVALID');
      const from = nextLocalDate(ctx.nowMs(), String(p[0]));
      if (from === null) return err('TIMEZONE_INVALID');
      await upsertSetting(ctx, SETTING_TZ_PENDING, { tz: input.deviceTz, from });
    }
    await ctx.execute(
      'INSERT INTO prompt_state (key, count, last_shown_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1, last_shown_at = excluded.last_shown_at',
      [PROMPT_TIMEZONE, ctx.nowMs()],
    );
    await ctx.execute('DELETE FROM settings WHERE key = ?', [SETTING_TZ_MISMATCH_SINCE]);
    ctx.touch('prompt_state', PROMPT_TIMEZONE, { answered: input.use ? 'yes' : 'no' });
    ctx.emit('ProfileChanged', { fields: ['timezone'] });
    return ok(undefined);
  },
};

/** Switches the profile zone once the chosen "from" date has arrived. Existing local dates are untouched. */
export const ApplyPendingTimezone: UseCase<void, { applied: boolean }, 'NO_PROFILE'> = {
  name: 'ApplyPendingTimezone',
  async execute(ctx) {
    const p = (await ctx.query('SELECT id, timezone_id FROM profile LIMIT 1'))[0];
    if (!p) return err('NO_PROFILE');
    const pending = (await readSetting(ctx, SETTING_TZ_PENDING)) as { tz?: string; from?: string } | undefined;
    if (!pending || typeof pending.tz !== 'string' || typeof pending.from !== 'string') return ok({ applied: false });
    const today = toLocalDate(ctx.nowMs(), String(p[1]));
    if (!today.ok || today.value < pending.from) return ok({ applied: false });
    await ctx.execute('UPDATE profile SET timezone_id = ? WHERE id = ?', [pending.tz, String(p[0])]);
    await ctx.execute('DELETE FROM settings WHERE key = ?', [SETTING_TZ_PENDING]);
    ctx.touch('profile', String(p[0]), { fields: 'timezone' });
    ctx.emit('ProfileChanged', { fields: ['timezone'] });
    return ok({ applied: true });
  },
};
