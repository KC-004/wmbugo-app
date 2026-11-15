import { err, ok, type Result } from './result';

/**
 * Clock port. All time in core comes from here: core code never calls
 * Date.now() (enforced by lint). The profile timezone is part of the port so
 * that capture-time stamping is a single, explicit operation.
 */
export interface Clock {
  /** UTC epoch milliseconds. */
  nowMs(): number;
  /** IANA timezone of the profile, e.g. 'Asia/Kolkata'. */
  timezoneId(): string;
}

/** Deterministic clock for tests. */
export class FakeClock implements Clock {
  private ms: number;
  private tz: string;

  constructor(startMs = 0, timezoneId = 'UTC') {
    this.ms = startMs;
    this.tz = timezoneId;
  }

  nowMs(): number {
    return this.ms;
  }

  timezoneId(): string {
    return this.tz;
  }

  set(ms: number): void {
    this.ms = ms;
  }

  advance(ms: number): void {
    this.ms += ms;
  }

  setTimezone(timezoneId: string): void {
    this.tz = timezoneId;
  }
}

/** 9999-12-31T23:59:59.999Z: keeps the year four digits so YYYY-MM-DD is always well formed. */
const MAX_INSTANT_MS = 253_402_300_799_999;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezoneId: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timezoneId);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezoneId,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timezoneId, f);
    return f;
  } catch {
    return null;
  }
}

/** Calendar date (YYYY-MM-DD) of a UTC instant in an IANA timezone. */
export function toLocalDate(instantMs: number, timezoneId: string): Result<string, 'INSTANT_INVALID' | 'TIMEZONE_INVALID'> {
  if (!Number.isSafeInteger(instantMs) || instantMs < 0 || instantMs > MAX_INSTANT_MS) return err('INSTANT_INVALID');
  const f = formatterFor(timezoneId);
  if (!f) return err('TIMEZONE_INVALID');
  let year = '';
  let month = '';
  let day = '';
  for (const p of f.formatToParts(instantMs)) {
    if (p.type === 'year') year = p.value;
    else if (p.type === 'month') month = p.value;
    else if (p.type === 'day') day = p.value;
  }
  return ok(`${year.padStart(4, '0')}-${month}-${day}`);
}

/**
 * The time facts stored with a transaction, fixed at capture. `localDate` is
 * derived once here and then persisted; nothing in core recomputes it from the
 * UTC instant later, so changing timezone, payday or period never moves an entry.
 */
export interface CapturedTime {
  readonly instantMs: number;
  readonly localDate: string;
  readonly timezoneId: string;
}

export function captureNow(clock: Clock): Result<CapturedTime, 'INSTANT_INVALID' | 'TIMEZONE_INVALID'> {
  const instantMs = clock.nowMs();
  const timezoneId = clock.timezoneId();
  const date = toLocalDate(instantMs, timezoneId);
  if (!date.ok) return date;
  return ok({ instantMs, localDate: date.value, timezoneId });
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timezoneId: string): Intl.DateTimeFormat | null {
  const cached = clockFormatters.get(timezoneId);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: timezoneId, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    clockFormatters.set(timezoneId, f);
    return f;
  } catch {
    return null;
  }
}

/** The wall clock of a UTC instant in a timezone, as a UTC-based number of minutes (for differences only). */
function wallMinutes(instantMs: number, f: Intl.DateTimeFormat): { minutesOfDay: number; asUtcMinutes: number } {
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(instantMs)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  const asUtcMinutes = Date.UTC(v.year!, v.month! - 1, v.day!, v.hour!, v.minute!) / 60_000;
  return { minutesOfDay: v.hour! * 60 + v.minute!, asUtcMinutes };
}

/** Minutes since local midnight of a UTC instant in a timezone (0 to 1439). */
export function localMinutesOfDay(instantMs: number, timezoneId: string): Result<number, 'TIMEZONE_INVALID'> {
  const f = wallClockFormatter(timezoneId);
  return f ? ok(wallMinutes(instantMs, f).minutesOfDay) : err('TIMEZONE_INVALID');
}

/**
 * The UTC instant of a local date and time of day in a timezone (`2026-12-05`, 9:00 in Asia/Kolkata). A time that does not
 * exist or exists twice around a clock change resolves to the instant the wall clock first shows it, give or take the shift.
 */
export function localToInstant(localDate: string, hour: number, minute: number, timezoneId: string): Result<number, 'TIMEZONE_INVALID' | 'DATE_INVALID'> {
  const f = wallClockFormatter(timezoneId);
  if (!f) return err('TIMEZONE_INVALID');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) return err('DATE_INVALID');
  const wanted = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute) / 60_000;
  let guess = wanted * 60_000;
  // Two passes settle the offset, including across a daylight-saving change.
  for (let i = 0; i < 2; i++) guess += (wanted - wallMinutes(guess, f).asUtcMinutes) * 60_000;
  return ok(guess);
}
