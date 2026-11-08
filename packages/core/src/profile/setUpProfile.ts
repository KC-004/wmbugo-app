import { getCurrency } from '../shared/currency';
import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';
import type { BudgetOffer } from './onboarding';
import type { PaydayRule } from './payday';
import type { Region } from './regions';

export interface SetUpProfileInput {
  readonly region: Region;
  readonly payday: PaydayRule;
  readonly budgetOffer: BudgetOffer;
  /** The device's IANA timezone at setup. */
  readonly timezoneId: string;
}

export type SetUpProfileError = 'PROFILE_EXISTS' | 'CURRENCY_UNSUPPORTED';

/** prompt_state keys written by onboarding for the budgets epic. */
export const PROMPT_BUDGET_YES = 'budget_503020_yes';
export const PROMPT_BUDGET_NOT_NOW = 'budget_503020_not_now';
/** The rough monthly income (minor units) the user typed, kept for the budgets epic; no budget is created here. */
export const SETTING_ROUGH_INCOME = 'budget.rough_monthly_income_minor';
export const SETTING_THEME = 'theme';

/**
 * Creates the one profile, its first settings (theme System) and the 50/30/20 answer in a single
 * transaction and raises ProfileChanged. Runs only through the LedgerWriter; nothing is written
 * before the last onboarding step.
 */
export const SetUpProfile: UseCase<SetUpProfileInput, { profileId: string }, SetUpProfileError> = {
  name: 'SetUpProfile',
  async execute(ctx, input) {
    const existing = await ctx.query('SELECT 1 FROM profile LIMIT 1');
    if (existing.length > 0) return err('PROFILE_EXISTS');

    const currency = getCurrency(input.region.currency);
    if (!currency.ok) return err('CURRENCY_UNSUPPORTED');

    const profileId = ctx.newId();
    const at = ctx.nowMs();
    const rule = input.payday;
    await ctx.execute(
      'INSERT INTO profile (id, region, currency_code, currency_exponent, locale, timezone_id, payday_rule, payday_day, clock_wall_ms, clock_elapsed_ms, clock_boot_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)',
      [profileId, input.region.code, currency.value.code, currency.value.exponent, input.region.locale, input.timezoneId, rule.kind, rule.kind === 'day' ? rule.day : null, at],
    );
    await ctx.execute('INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?)', [SETTING_THEME, JSON.stringify('system'), at]);

    const offer = input.budgetOffer;
    if (offer.answer === 'yes') {
      await ctx.execute('INSERT INTO prompt_state (key, count, last_shown_at) VALUES (?, 1, ?)', [PROMPT_BUDGET_YES, at]);
      await ctx.execute('INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?)', [SETTING_ROUGH_INCOME, JSON.stringify(offer.roughMonthlyIncomeMinor), at]);
    } else if (offer.answer === 'not-now') {
      await ctx.execute('INSERT INTO prompt_state (key, count, last_shown_at) VALUES (?, 1, ?)', [PROMPT_BUDGET_NOT_NOW, at]);
    }

    ctx.touch('profile', profileId, { region: input.region.code, currency: currency.value.code, payday: rule.kind });
    ctx.emit('ProfileChanged', { fields: ['profile', 'settings'] });
    return ok({ profileId });
  },
};
