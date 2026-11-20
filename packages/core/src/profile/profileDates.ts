import type { Querier } from '../planning/budgets';

/** When the profile was made (UTC milliseconds), or 0 before one exists: the earliest day Insights can know about. */
export async function profileCreatedAtMs(q: Querier): Promise<number> {
  const r = (await q.query('SELECT created_at FROM profile LIMIT 1'))[0];
  return Number(r?.[0] ?? 0);
}
