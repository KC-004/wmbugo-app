import { toLocalDate } from '../shared/clock';

/** Minutes the timezone is ahead of UTC at an instant; null for an unknown zone. */
export function offsetMinutes(timezoneId: string, instantMs: number): number | null {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: timezoneId, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const n: Record<string, number> = {};
    for (const p of f.formatToParts(instantMs)) if (p.type !== 'literal') n[p.type] = Number(p.value);
    const wall = Date.UTC(n.year!, n.month! - 1, n.day!, n.hour!, n.minute!);
    return Math.round((wall - Math.floor(instantMs / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

export const TIMEZONE_GAP_MINUTES = 120;
export const TIMEZONE_WAIT_MS = 24 * 60 * 60 * 1000;

/** True when the device zone is at least two hours away from the profile zone right now. */
export function timezonesDiffer(profileTz: string, deviceTz: string, nowMs: number): boolean {
  const a = offsetMinutes(profileTz, nowMs);
  const b = offsetMinutes(deviceTz, nowMs);
  return a !== null && b !== null && Math.abs(a - b) >= TIMEZONE_GAP_MINUTES;
}

/** Ask once, after the zones have differed for more than 24 hours, and never again once answered. */
export function shouldAskTimezone(input: { mismatchSinceMs: number | null; nowMs: number; answered: boolean }): boolean {
  return !input.answered && input.mismatchSinceMs !== null && input.nowMs - input.mismatchSinceMs > TIMEZONE_WAIT_MS;
}

/** The first local date strictly after today in a timezone: a new zone takes effect from the next day. */
export function nextLocalDate(nowMs: number, timezoneId: string): string | null {
  const t = toLocalDate(nowMs, timezoneId);
  if (!t.ok) return null;
  const [y, m, d] = t.value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export const SETTING_TZ_MISMATCH_SINCE = 'tz.mismatch_since';
export const SETTING_TZ_PENDING = 'tz.pending';
export const PROMPT_TIMEZONE = 'prompt.timezone';
