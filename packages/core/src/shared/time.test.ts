import fc from 'fast-check';
import { FakeClock, captureNow, toLocalDate } from './clock';
import { UUID_V7_PATTERN, createIdGenerator, seededRandom, uuidV7 } from './uuid';

const ZONES = ['Europe/London', 'America/Toronto', 'Asia/Kolkata', 'Pacific/Auckland', 'Asia/Kathmandu', 'UTC'];

/** Independent oracle: apply the zone's UTC offset (from Intl longOffset) to the instant. */
function oracleDate(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(ms);
  const off = parts.find((p) => p.type === 'timeZoneName')!.value; // 'GMT', 'GMT+05:30', 'GMT-04:00'
  const m = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(off)!;
  const sign = m[1] === '-' ? -1 : 1;
  const offsetMin = m[1] ? sign * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);
}

describe('toLocalDate', () => {
  it('returns YYYY-MM-DD in the zone', () => {
    const t = Date.UTC(2026, 10, 7, 20, 0, 0); // 2026-11-07T20:00Z
    expect(toLocalDate(t, 'UTC')).toEqual({ ok: true, value: '2026-11-07' });
    expect(toLocalDate(t, 'Asia/Kolkata')).toEqual({ ok: true, value: '2026-11-08' }); // +05:30 -> 01:30 next day
    expect(toLocalDate(t, 'America/Toronto')).toEqual({ ok: true, value: '2026-11-07' });
    expect(toLocalDate(t, 'Pacific/Auckland')).toEqual({ ok: true, value: '2026-11-08' });
  });

  it('rejects bad zones and instants', () => {
    expect(toLocalDate(0, 'Mars/Base')).toEqual({ ok: false, code: 'TIMEZONE_INVALID' });
    expect(toLocalDate(NaN, 'UTC')).toEqual({ ok: false, code: 'INSTANT_INVALID' });
    expect(toLocalDate(1.5, 'UTC')).toEqual({ ok: false, code: 'INSTANT_INVALID' });
    expect(toLocalDate(8.64e15 + 1, 'UTC')).toEqual({ ok: false, code: 'INSTANT_INVALID' });
    expect(toLocalDate(-1, 'UTC')).toEqual({ ok: false, code: 'INSTANT_INVALID' });
    expect(toLocalDate(253_402_300_800_000, 'UTC')).toEqual({ ok: false, code: 'INSTANT_INVALID' });
    expect(toLocalDate(253_402_300_799_999, 'UTC')).toEqual({ ok: true, value: '9999-12-31' });
    expect(toLocalDate(0, 'UTC')).toEqual({ ok: true, value: '1970-01-01' });
  });

  it('handles the exact DST edges in London and Toronto', () => {
    // London spring forward 2026-03-29 01:00Z; fall back 2026-10-25 01:00Z.
    const edges = [Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 9, 25, 1)];
    for (const e of edges) {
      for (const d of [-1, 0, 1]) {
        const ms = e + d * 60_000;
        expect(toLocalDate(ms, 'Europe/London')).toEqual({ ok: true, value: oracleDate(ms, 'Europe/London') });
      }
    }
    // Toronto fall back 2026-11-01 06:00Z.
    const t = Date.UTC(2026, 10, 1, 6);
    for (const d of [-60, -1, 0, 1, 60]) {
      expect(toLocalDate(t + d * 60_000, 'America/Toronto')).toEqual({
        ok: true,
        value: oracleDate(t + d * 60_000, 'America/Toronto'),
      });
    }
  });

  it('property: matches the offset oracle and never lands on a neighbouring day (DST windows)', () => {
    const windows = [
      Date.UTC(2026, 2, 8, 7), // Toronto spring forward
      Date.UTC(2026, 2, 29, 1), // London spring forward
      Date.UTC(2026, 9, 25, 1), // London fall back
      Date.UTC(2026, 10, 1, 6), // Toronto fall back
    ];
    fc.assert(
      fc.property(fc.constantFrom(...windows), fc.integer({ min: -3 * 86_400_000, max: 3 * 86_400_000 }), fc.constantFrom(...ZONES), (base, delta, zone) => {
        const ms = base + delta;
        const r = toLocalDate(ms, zone);
        return r.ok && r.value === oracleDate(ms, zone);
      }),
      { numRuns: 3000 },
    );
  });

  it('property: local date never goes backwards and never skips a day as time moves forward', () => {
    const dayNum = (s: string): number => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }), fc.constantFrom('Europe/London', 'America/Toronto'), (start, zone) => {
        let prev = toLocalDate(start, zone);
        if (!prev.ok) return false;
        for (let i = 1; i <= 100; i++) {
          const cur = toLocalDate(start + i * 30 * 60_000, zone);
          if (!cur.ok) return false;
          const diff = dayNum(cur.value) - dayNum(prev.value);
          if (diff < 0 || diff > 1) return false;
          prev = cur;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });
});

describe('captureNow', () => {
  it('stamps instant, local date and timezone together, once', () => {
    const clock = new FakeClock(Date.UTC(2026, 10, 7, 20), 'Asia/Kolkata');
    const stamp = captureNow(clock);
    expect(stamp).toEqual({
      ok: true,
      value: { instantMs: Date.UTC(2026, 10, 7, 20), localDate: '2026-11-08', timezoneId: 'Asia/Kolkata' },
    });
  });

  it('a stored stamp does not change when the clock zone changes later', () => {
    const clock = new FakeClock(Date.UTC(2026, 10, 7, 20), 'Asia/Kolkata');
    const stamp = captureNow(clock);
    if (!stamp.ok) throw new Error('setup');
    clock.setTimezone('America/Toronto');
    expect(stamp.value.localDate).toBe('2026-11-08');
    expect(captureNow(clock)).toMatchObject({ value: { localDate: '2026-11-07' } });
  });

  it('propagates a bad zone', () => {
    expect(captureNow(new FakeClock(0, 'Nope/Zone'))).toEqual({ ok: false, code: 'TIMEZONE_INVALID' });
  });
});

describe('FakeClock', () => {
  it('sets and advances', () => {
    const c = new FakeClock(10);
    c.advance(5);
    expect(c.nowMs()).toBe(15);
    c.set(100);
    expect(c.nowMs()).toBe(100);
    expect(c.timezoneId()).toBe('UTC');
  });
});

describe('uuid v7', () => {
  it('matches the v7 layout and embeds the timestamp', () => {
    const id = uuidV7(0x018f_1234_5678, new Uint8Array(10).fill(0xff));
    expect(id).toMatch(UUID_V7_PATTERN);
    expect(id.startsWith('018f1234-5678-7')).toBe(true);
    expect(id.charAt(19)).toMatch(/[89ab]/);
  });

  it('rejects bad input', () => {
    expect(() => uuidV7(-1, new Uint8Array(10))).toThrow(RangeError);
    expect(() => uuidV7(2 ** 48, new Uint8Array(10))).toThrow(RangeError);
    expect(() => uuidV7(1, new Uint8Array(3))).toThrow(RangeError);
  });

  it('generator is strictly increasing even with a frozen or backwards clock', () => {
    const clock = new FakeClock(1_000_000);
    const gen = createIdGenerator(clock, seededRandom(7));
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      ids.push(gen());
      if (i === 100) clock.set(500_000); // clock steps back
    }
    for (const id of ids) expect(id).toMatch(UUID_V7_PATTERN);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('property: every id is a valid v7 and ids sort by time', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 47 }), fc.integer({ min: 1, max: 2 ** 31 }), fc.integer(), (ts, delta, seed) => {
        const r = seededRandom(seed);
        const a = uuidV7(ts, r.bytes(10));
        const b = uuidV7(ts + delta, r.bytes(10));
        return UUID_V7_PATTERN.test(a) && UUID_V7_PATTERN.test(b) && a < b;
      }),
      { numRuns: 2000 },
    );
  });
});
