import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';

/** The one-time tip on Home's "In accounts" line. */
export const TIP_IN_ACCOUNTS = 'tip.in-accounts';

export const SEEN_PROMPT_SQL = 'SELECT count FROM prompt_state WHERE key = ?';

/** Records that a tip or prompt was shown and acknowledged. A tip never inserts any other data. */
export const MarkPromptSeen: UseCase<{ key: string }, void, 'KEY_INVALID'> = {
  name: 'MarkPromptSeen',
  async execute(ctx, input) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(input.key)) return err('KEY_INVALID');
    const at = ctx.nowMs();
    await ctx.execute(
      'INSERT INTO prompt_state (key, count, last_shown_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1, last_shown_at = excluded.last_shown_at',
      [input.key, at],
    );
    ctx.touch('prompt_state', input.key, { seen: true });
    return ok(undefined);
  },
};
