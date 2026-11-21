import * as fc from 'fast-check';
import { decodeCsvBytes, detectEncoding, isValidUtf8, type CsvEncoding } from './decode';
import { detectNumberStyle, NUMBER_STYLES, parseCsvAmount, type NumberStyle } from './amount';
import { detectDateFormat, parseCsvDate } from './date';
import { MAX_CSV_BYTES, readCsv } from './read';
import { tokenizeCsv } from './tokenize';

/** Test-side encoders, so the fixtures are real bytes in each encoding. */
const WIN_HIGH: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
function encode(text: string, encoding: CsvEncoding, bom = false): Uint8Array {
  const out: number[] = [];
  if (encoding === 'UTF-8') {
    if (bom) out.push(0xef, 0xbb, 0xbf);
    return new Uint8Array([...out, ...new TextEncoder().encode(text)]);
  }
  if (encoding === 'UTF-16LE' || encoding === 'UTF-16BE') {
    const le = encoding === 'UTF-16LE';
    if (bom) out.push(...(le ? [0xff, 0xfe] : [0xfe, 0xff]));
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      out.push(...(le ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
    }
    return new Uint8Array(out);
  }
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (encoding === 'Windows-1252' && WIN_HIGH[ch] !== undefined) out.push(WIN_HIGH[ch]!);
    else if (code > 0xff) throw new Error(`${ch} is not in ${encoding}`);
    else out.push(code);
  }
  return new Uint8Array(out);
}
const bytesOf = (...v: number[]) => new Uint8Array(v);
const read = (text: string, encoding: CsvEncoding = 'UTF-8', opts = {}) => readCsv(encode(text, encoding), opts);
const must = <T,>(r: { ok: boolean } & ({ value: T } | { code: string })): T => {
  if (!r.ok) throw new Error(`expected ok, got ${(r as { code: string }).code}`);
  return (r as { value: T }).value;
};

describe('encodings (Story 9.1)', () => {
  const FIXTURE = 'Date,Name,Amount\n01/11/2026,Café,3.50\n02/11/2026,Zürich,£3.50\n';
  const WITH_EURO = `${FIXTURE}03/11/2026,Fee,"€12,00"\n`; // quoted: the amount has a decimal comma in a comma-delimited file
  const cases: [CsvEncoding, string][] = [
    ['UTF-8', WITH_EURO],
    ['UTF-16LE', WITH_EURO],
    ['UTF-16BE', WITH_EURO],
    ['Windows-1252', WITH_EURO],
    ['ISO-8859-1', FIXTURE],
  ];
  for (const [encoding, text] of cases) {
    it(`${encoding}: Café, Zürich, £3.50${encoding === 'ISO-8859-1' ? '' : ' and €12,00'} decode correctly`, () => {
      const bom = encoding === 'UTF-8' || encoding === 'UTF-16LE' || encoding === 'UTF-16BE';
      const r = must(readCsv(encode(text, encoding, bom)));
      expect(r.encoding.value).toBe(encoding);
      expect(r.encoding.overridden).toBe(false);
      const cells = r.rows.map((x) => x.cells);
      expect(cells[0]).toEqual(['01/11/2026', 'Café', '3.50']);
      expect(cells[1]).toEqual(['02/11/2026', 'Zürich', '£3.50']);
      if (encoding !== 'ISO-8859-1') expect(cells[2]).toEqual(['03/11/2026', 'Fee', '€12,00']);
    });
  }

  it('without a byte-order mark UTF-16 is still found, in both byte orders', () => {
    for (const enc of ['UTF-16LE', 'UTF-16BE'] as const) {
      expect(must(readCsv(encode(FIXTURE, enc))).encoding.value).toBe(enc);
    }
  });

  it('a byte-order mark is honoured and stripped: the first heading has no stray character', () => {
    for (const enc of ['UTF-8', 'UTF-16LE', 'UTF-16BE'] as const) {
      const r = must(readCsv(encode(FIXTURE, enc, true)));
      expect(r.encoding.value).toBe(enc);
      expect(r.encoding.confidence).toBeGreaterThan(0.9);
      expect(r.header[0]).toBe('Date');
    }
  });

  it('invalid UTF-8 falls back: ISO-8859-1 when no byte 0x80 to 0x9F appears, Windows-1252 when one does', () => {
    expect(isValidUtf8(bytesOf(0x43, 0x61, 0x66, 0xe9))).toBe(false);
    expect(detectEncoding(bytesOf(0x43, 0x61, 0x66, 0xe9)).encoding).toBe('ISO-8859-1');
    expect(detectEncoding(bytesOf(0x43, 0x61, 0x66, 0xe9, 0x80)).encoding).toBe('Windows-1252'); // a euro sign
    expect(decodeCsvBytes(bytesOf(0x80, 0x96, 0xe9), 'Windows-1252')).toBe('€–é');
    expect(decodeCsvBytes(bytesOf(0x80, 0xe9), 'ISO-8859-1')).toBe(String.fromCharCode(0x80, 0xe9));
  });

  it('rejects overlong forms, surrogates, and a sequence cut short as UTF-8', () => {
    expect(isValidUtf8(bytesOf(0xc0, 0x80))).toBe(false); // overlong NUL
    expect(isValidUtf8(bytesOf(0xed, 0xa0, 0x80))).toBe(false); // a surrogate
    expect(isValidUtf8(bytesOf(0xf4, 0x90, 0x80, 0x80))).toBe(false); // above U+10FFFF
    expect(isValidUtf8(bytesOf(0xe2, 0x82))).toBe(false); // cut short
    expect(isValidUtf8(new TextEncoder().encode('€ 😀 é'))).toBe(true);
  });

  it('an astral character survives UTF-8 and UTF-16', () => {
    for (const enc of ['UTF-8', 'UTF-16LE'] as const) {
      expect(must(readCsv(encode('a,b\n😀,x\n', enc, true))).rows[0]!.cells[0]).toBe('😀');
    }
  });
});

describe('quoting and rows (Story 9.1)', () => {
  it('a quoted field keeps its delimiter, doubled quotes and line break as one cell, and the row count is unchanged by the break', () => {
    const text = 'Date,Name,Amount\n01/11/2026,"PRET A MANGER, LONDON",3.50\n02/11/2026,"He said ""hi""",1.00\n03/11/2026,"two\nlines",2.00\n04/11/2026,plain,4.00\n';
    const r = must(read(text));
    expect(r.rowCount).toBe(4);
    expect(r.rows.map((x) => x.cells[1])).toEqual(['PRET A MANGER, LONDON', 'He said "hi"', 'two\nlines', 'plain']);
    expect(r.rows.map((x) => x.row)).toEqual([2, 3, 4, 5]); // row numbers are records, not lines
  });

  it('handles CRLF, lone CR and a missing final line end, and a final line end makes no empty row', () => {
    expect(tokenizeCsv('a,b\r\nc,d\r\n', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(tokenizeCsv('a,b\rc,d', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(tokenizeCsv('a,b\n', ',')).toEqual([['a', 'b']]);
    expect(tokenizeCsv('a,,c\n,,\n', ',')).toEqual([['a', '', 'c'], ['', '', '']]);
  });

  it('a blank line is a row of its own, so file row numbers stay the file\'s', () => {
    const r = must(read('Date,Name\n\n01/11/2026,x\n'));
    expect(r.rows[0]!.row).toBe(3);
    expect(r.rowCount).toBe(1);
  });
});

describe('delimiter and header detection (Story 9.1)', () => {
  it('finds comma, semicolon and tab', () => {
    for (const d of [',', ';', '\t'] as const) {
      const r = must(read(['Date', 'Name', 'Amount'].join(d) + '\n' + ['01/11/2026', 'Shop', '3.50'].join(d) + '\n' + ['02/11/2026', 'Cafe', '4.00'].join(d) + '\n'));
      expect(r.delimiter.value).toBe(d);
      expect(r.header).toEqual(['Date', 'Name', 'Amount']);
    }
  });

  it('a semicolon file whose amounts use decimal commas is not mistaken for a comma file', () => {
    const r = must(read('Buchungstag;Text;Betrag\n01.11.2026;Miete;-1.234,56\n02.11.2026;Kaffee;-3,50\n'));
    expect(r.delimiter.value).toBe(';');
    expect(r.header).toHaveLength(3);
  });

  it('skips bank preamble before the heading: the first row with the dominant cell count and no amount, preamble reported not imported', () => {
    const text = 'Account: 12-34-56 ****4821\n\nDate,Description,Amount,Balance\n01/11/2026,Shop,-3.50,100.00\n02/11/2026,Cafe,-4.00,96.00\n';
    const r = must(read(text));
    expect(r.headerRow.value).toBe(2);
    expect(r.header).toEqual(['Date', 'Description', 'Amount', 'Balance']);
    expect(r.preamble).toEqual([['Account: 12-34-56 ****4821'], ['']]);
    expect(r.rowCount).toBe(2);
    expect(r.rows[0]!.row).toBe(4);
  });

  it('a first row that holds an amount is data, not a heading: with no heading row found the result says so', () => {
    const r = must(read('01/11/2026,Shop,3.50\n02/11/2026,Cafe,4.00\n'));
    expect(r.headerRow.value).toBeNull();
    expect(r.rowCount).toBe(2);
    expect(r.header).toEqual([]);
  });

  it('keeps only the first 25 data rows as the sample, and all of them as rows', () => {
    const lines = ['Date,Name,Amount', ...Array.from({ length: 60 }, (_, i) => `01/11/2026,Shop ${i},${i + 1}.00`)];
    const r = must(read(lines.join('\n')));
    expect(r.rowCount).toBe(60);
    expect(r.sample).toHaveLength(25);
    expect(r.rows).toHaveLength(60);
  });
});

describe('overrides always win over detection (Story 9.1)', () => {
  const text = 'Date;Name;Amount\n01/11/2026;Café;3.50\n';
  it('encoding', () => {
    const bytes = new TextEncoder().encode(text);
    const r = must(readCsv(bytes, { encoding: 'ISO-8859-1' }));
    expect(r.encoding).toEqual({ value: 'ISO-8859-1', confidence: 1, overridden: true });
    expect(r.rows[0]!.cells[1]).toBe('CafÃ©'); // read as the wrong page on purpose
    expect(must(readCsv(bytes)).rows[0]!.cells[1]).toBe('Café');
  });
  it('delimiter', () => {
    const r = must(readCsv(encode(text, 'UTF-8'), { delimiter: ',' }));
    expect(r.delimiter).toEqual({ value: ',', confidence: 1, overridden: true });
    expect(r.header).toEqual(['Date;Name;Amount']);
  });
  it('headerRow', () => {
    const r = must(read('Date,Name\n01/11/2026,x\n02/11/2026,y\n', 'UTF-8', { headerRow: 1 }));
    expect(r.headerRow).toEqual({ value: 1, confidence: 1, overridden: true });
    expect(r.header).toEqual(['01/11/2026', 'x']);
    expect(r.preamble).toEqual([['Date', 'Name']]);
    expect(r.rowCount).toBe(1);
  });
  it('noHeader', () => {
    const r = must(read('Date,Name\n01/11/2026,x\n', 'UTF-8', { noHeader: true }));
    expect(r.headerRow.value).toBeNull();
    expect(r.rowCount).toBe(2);
    expect(r.header).toEqual([]);
  });
  it('a custom tokenizer is used (the phone puts Papa Parse here)', () => {
    const tokenizer = jest.fn((t: string, d: string) => tokenizeCsv(t, d));
    must(read('a,b\n1,2\n', 'UTF-8', { tokenizer }));
    expect(tokenizer).toHaveBeenCalled();
  });
});

describe('files that cannot be read (Story 9.1)', () => {
  it('EMPTY_FILE, NO_ROWS, NOT_A_CSV, FILE_TOO_LARGE, and nothing is thrown', () => {
    expect(readCsv(new Uint8Array(0))).toEqual({ ok: false, code: 'EMPTY_FILE' });
    expect(readCsv(encode('   \n \n', 'UTF-8'))).toEqual({ ok: false, code: 'EMPTY_FILE' });
    expect(readCsv(encode('Date,Name,Amount\n', 'UTF-8'))).toEqual({ ok: false, code: 'NO_ROWS' });
    const binary = new Uint8Array(2000);
    for (let i = 0; i < binary.length; i++) binary[i] = i % 7 === 0 ? 0 : 65 + (i % 20);
    expect(readCsv(binary)).toEqual({ ok: false, code: 'NOT_A_CSV' });
    expect(readCsv(new Uint8Array(MAX_CSV_BYTES + 1))).toEqual({ ok: false, code: 'FILE_TOO_LARGE' });
  });

  it('a file of exactly 20 MB is read', () => {
    const line = 'Date,Name,Amount\n';
    const bytes = new Uint8Array(MAX_CSV_BYTES).fill(0x20);
    bytes.set(new TextEncoder().encode(`${line}01/11/2026,x,1.00\n`), 0);
    expect(readCsv(bytes).ok).toBe(true);
  });

  it('UTF-16 text is not mistaken for a binary file, although it is full of NUL bytes', () => {
    expect(readCsv(encode('Date,Name\n01/11/2026,x\n', 'UTF-16LE')).ok).toBe(true);
  });
});

describe('amounts: exact minor units, never a float (Story 9.1, NFR-09)', () => {
  const p = (t: string, s: NumberStyle, exp = 2) => parseCsvAmount(t, s, exp);
  it('the spec examples', () => {
    expect(p('-1.234,56', '1.234,56')).toEqual({ ok: true, value: -123456 });
    expect(p('1,234.56', '1,234.56')).toEqual({ ok: true, value: 123456 });
    expect(p('(1,234.56)', '1,234.56')).toEqual({ ok: true, value: -123456 });
    expect(p('£3.50', '1,234.56')).toEqual({ ok: true, value: 350 });
    expect(p('3.50 CR', '1,234.56')).toEqual({ ok: true, value: 350 });
    expect(p('3.50 DR', '1,234.56')).toEqual({ ok: true, value: -350 });
    expect(p('1 234,56', '1 234,56')).toEqual({ ok: true, value: 123456 });
  });

  it('other shapes banks use', () => {
    expect(p('-£3.50', '1,234.56')).toEqual({ ok: true, value: -350 });
    expect(p('+3.50', '1,234.56')).toEqual({ ok: true, value: 350 });
    expect(p('3.50-', '1,234.56')).toEqual({ ok: true, value: -350 });
    expect(p(`${String.fromCharCode(0x2212)}3.50`, '1,234.56')).toEqual({ ok: true, value: -350 });
    expect(p('GBP 3.50', '1,234.56')).toEqual({ ok: true, value: 350 });
    expect(p('3.50 EUR', '1,234.56')).toEqual({ ok: true, value: 350 });
    expect(p(`1${String.fromCharCode(0xa0)}234,56`, '1 234,56')).toEqual({ ok: true, value: 123456 }); // a no-break space
    expect(p('12', '1,234.56')).toEqual({ ok: true, value: 1200 });
    expect(p('.5', '1,234.56')).toEqual({ ok: true, value: 50 });
    expect(p('3.5', '1,234.56')).toEqual({ ok: true, value: 350 });
    expect(p('0.00', '1,234.56')).toEqual({ ok: true, value: 0 });
    expect(p('-0.00', '1,234.56')).toEqual({ ok: true, value: 0 });
    expect(p('1,234', '1,234.56')).toEqual({ ok: true, value: 123400 });
  });

  it('exponent 0 and 3 currencies, and extra zeros are fine but extra digits are refused, never rounded', () => {
    expect(p('1,234', '1,234.56', 0)).toEqual({ ok: true, value: 1234 });
    expect(p('1.234', '1,234.56', 3)).toEqual({ ok: true, value: 1234 });
    expect(p('3.500', '1,234.56', 2)).toEqual({ ok: true, value: 350 });
    expect(p('3.505', '1,234.56', 2)).toEqual({ ok: false, code: 'INVALID_AMOUNT' });
    expect(p('3.5', '1,234.56', 0)).toEqual({ ok: false, code: 'INVALID_AMOUNT' });
  });

  it('text that is not an amount is INVALID_AMOUNT, never 0', () => {
    for (const bad of ['12.3.4', 'abc', '', ' ', '--3', '1,23,456.00', '3.50.', '1e5', 'NaN', '£', '12,5.0', '9'.repeat(40)]) {
      expect({ bad, r: p(bad, '1,234.56') }).toEqual({ bad, r: { ok: false, code: 'INVALID_AMOUNT' } });
    }
    expect(p('1.234,56', '1,234.56')).toEqual({ ok: false, code: 'INVALID_AMOUNT' }); // the wrong style for this text
  });

  it('property: formatting then parsing round-trips for every style, exponent and sign', () => {
    const fmt = (minor: number, style: NumberStyle, exp: number): string => {
      const digits = String(Math.abs(minor)).padStart(exp + 1, '0');
      const int = digits.slice(0, digits.length - exp);
      const frac = digits.slice(digits.length - exp);
      const groupChar = style === '1,234.56' ? ',' : style === '1.234,56' ? '.' : ' ';
      const decChar = style === '1,234.56' ? '.' : ',';
      const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, groupChar);
      return `${minor < 0 ? '-' : ''}${grouped}${exp > 0 ? decChar + frac : ''}`;
    };
    fc.assert(
      fc.property(fc.integer({ min: -9_999_999_999, max: 9_999_999_999 }), fc.constantFrom(...NUMBER_STYLES), fc.constantFrom(0, 2, 3), (minor, style, exp) => {
        const parsed = parseCsvAmount(fmt(minor, style, exp), style, exp);
        return parsed.ok && parsed.value === minor;
      }),
      { numRuns: 500 },
    );
  });

  it('detects the number style from the values', () => {
    expect(detectNumberStyle(['-1.234,56', '12,50', '1.000,00']).style).toBe('1.234,56');
    expect(detectNumberStyle(['1,234.56', '12.50', '-3.00']).style).toBe('1,234.56');
    expect(detectNumberStyle(['1 234,56', '12,50']).style).toBe('1 234,56');
    expect(detectNumberStyle(['12,34', '5,00']).style).toBe('1.234,56'); // a comma and exactly two digits at the end
    expect(detectNumberStyle(['1.234.567', '12.345.678']).style).toBe('1.234,56');
    const unsure = detectNumberStyle(['1,234', '5,678']); // thousands or three decimals: nothing decides it
    expect(unsure.confidence).toBeLessThan(0.5);
    expect(detectNumberStyle(['abc', '']).confidence).toBeLessThan(0.5);
    expect(detectNumberStyle(['3.50 CR', '(4.00)', '£2.00']).style).toBe('1,234.56');
  });
});

describe('dates (Story 9.1, FIN-002)', () => {
  it('detects each supported format', () => {
    const d = (v: string[]) => detectDateFormat(v);
    expect(d(['2026-11-01', '2026-11-30'])).toMatchObject({ kind: 'detected', format: 'YYYY-MM-DD' });
    expect(d(['31/10/2026', '01/11/2026'])).toMatchObject({ kind: 'detected', format: 'DD/MM/YYYY' });
    expect(d(['10/31/2026', '11/01/2026'])).toMatchObject({ kind: 'detected', format: 'MM/DD/YYYY' });
    expect(d(['31.10.2026', '01.11.2026'])).toMatchObject({ kind: 'detected', format: 'DD.MM.YYYY' });
    expect(d(['31-10-2026', '01-11-2026'])).toMatchObject({ kind: 'detected', format: 'DD-MM-YYYY' });
    expect(d(['3 Nov 2026', '12 Dec 2026'])).toMatchObject({ kind: 'detected', format: 'D MMM YYYY' });
    expect(d(['31/10/2026 14:05', '01/11/2026 09:30:15'])).toMatchObject({ kind: 'detected', format: 'DD/MM/YYYY' });
    expect(d(['', 'not a date'])).toEqual({ kind: 'none' });
    expect(d([])).toEqual({ kind: 'none' });
  });

  it('returns AMBIGUOUS_DATE_FORMAT with both candidates when every value has day and month 12 or under', () => {
    expect(detectDateFormat(['04/05/2026', '01/02/2026', '12/12/2026'])).toEqual({
      kind: 'ambiguous',
      code: 'AMBIGUOUS_DATE_FORMAT',
      candidates: ['DD/MM/YYYY', 'MM/DD/YYYY'],
    });
    // one value with a day over 12 settles it
    expect(detectDateFormat(['04/05/2026', '13/05/2026'])).toMatchObject({ kind: 'detected', format: 'DD/MM/YYYY' });
  });

  it('a date alone is the local_date exactly as written: no UTC shift in any timezone', () => {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata', 'UTC', 'Pacific/Kiritimati']) {
      expect(parseCsvDate('01/01/2026', 'DD/MM/YYYY', tz)).toEqual({ ok: true, value: { localDate: '2026-01-01', hasTime: false } });
    }
    expect(parseCsvDate('3 Nov 2026', 'D MMM YYYY', 'UTC')).toEqual({ ok: true, value: { localDate: '2026-11-03', hasTime: false } });
    expect(parseCsvDate('3 November 2026', 'D MMM YYYY', 'UTC')).toMatchObject({ ok: true, value: { localDate: '2026-11-03' } });
    expect(parseCsvDate('1.2.2026', 'DD.MM.YYYY', 'UTC')).toMatchObject({ ok: true, value: { localDate: '2026-02-01' } });
  });

  it('a date with a time is a UTC instant in the profile timezone that keeps the written day', () => {
    const r = parseCsvDate('03/11/2026 21:14:30', 'DD/MM/YYYY', 'Asia/Singapore');
    expect(r).toMatchObject({ ok: true, value: { localDate: '2026-11-03', hasTime: true } });
    expect(r.ok && r.value.instantMs).toBe(Date.UTC(2026, 10, 3, 13, 14, 30)); // UTC+8
    const k = parseCsvDate('2026-11-03T09:00', 'YYYY-MM-DD', 'Asia/Kolkata');
    expect(k.ok && k.value.instantMs).toBe(Date.UTC(2026, 10, 3, 3, 30, 0));
  });

  it('DST: 26 Oct 2025 in Europe/London, the day the clocks go back, keeps the written day for both readings of 01:30', () => {
    for (const t of ['26/10/2025 00:30', '26/10/2025 01:30', '26/10/2025 02:30', '26/10/2025 23:59']) {
      const r = parseCsvDate(t, 'DD/MM/YYYY', 'Europe/London');
      expect({ t, day: r.ok && r.value.localDate }).toEqual({ t, day: '2025-10-26' });
    }
    // spring forward: 01:30 on 30 Mar 2025 does not exist; the written day is kept
    expect(parseCsvDate('30/03/2025 01:30', 'DD/MM/YYYY', 'Europe/London')).toMatchObject({ ok: true, value: { localDate: '2025-03-30' } });
  });

  it('a date that is not on the calendar, or a bad time, is INVALID_DATE', () => {
    for (const [t, f] of [
      ['31/02/2026', 'DD/MM/YYYY'],
      ['29/02/2025', 'DD/MM/YYYY'],
      ['13/13/2026', 'MM/DD/YYYY'],
      ['2026-00-10', 'YYYY-MM-DD'],
      ['01/11/2026 24:00', 'DD/MM/YYYY'],
      ['01/11/2026 10:60', 'DD/MM/YYYY'],
      ['3 Foo 2026', 'D MMM YYYY'],
      ['soon', 'DD/MM/YYYY'],
      ['01/11/2026 later', 'DD/MM/YYYY'],
    ] as const) {
      expect({ t, r: parseCsvDate(t, f, 'UTC') }).toEqual({ t, r: { ok: false, code: 'INVALID_DATE' } });
    }
    expect(parseCsvDate('29/02/2024', 'DD/MM/YYYY', 'UTC')).toMatchObject({ ok: true, value: { localDate: '2024-02-29' } });
    expect(parseCsvDate('01/01/2026', 'DD/MM/YYYY', 'Not/AZone')).toMatchObject({ ok: true }); // a date alone needs no zone
    expect(parseCsvDate('01/01/2026 10:00', 'DD/MM/YYYY', 'Not/AZone')).toEqual({ ok: false, code: 'INVALID_DATE' });
  });
});

describe('the PRD German acceptance fixture (Story 9.1)', () => {
  it('a Windows-1252 file with ; delimiters and the amount -1.234,56 is read with no overrides', () => {
    // The en dash (0x96) is what marks the file as Windows-1252 rather than ISO-8859-1.
    const text = 'Buchungstag;Buchungstext;Betrag;Währung\n03.11.2026;Miete – November;-1.234,56;EUR\n04.11.2026;Bäckerei Müller;-3,50;EUR\n';
    const r = must(readCsv(encode(text, 'Windows-1252')));
    expect(r.encoding.value).toBe('Windows-1252');
    expect(r.delimiter.value).toBe(';');
    expect(r.header).toEqual(['Buchungstag', 'Buchungstext', 'Betrag', 'Währung']);
    expect(r.rows[0]!.cells[1]).toBe('Miete – November');
    const amounts = r.rows.map((x) => x.cells[2]!);
    const style = detectNumberStyle(amounts);
    expect(style.style).toBe('1.234,56');
    expect(parseCsvAmount(amounts[0]!, style.style, 2)).toEqual({ ok: true, value: -123456 });
    expect(detectDateFormat(r.rows.map((x) => x.cells[0]!))).toMatchObject({ kind: 'detected', format: 'DD.MM.YYYY' });
  });
});

describe('the reader never throws (property)', () => {
  it('any bytes give a result, ok or a typed error', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), (bytes) => {
        const r = readCsv(bytes);
        return r.ok || ['EMPTY_FILE', 'NO_ROWS', 'NOT_A_CSV', 'FILE_TOO_LARGE'].includes(r.code);
      }),
      { numRuns: 400 },
    );
  });

  it('any text decoded and tokenized gives back the same cells when written out and read again (round trip of the tokenizer)', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.string({ maxLength: 12 }), { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 6 }), (table) => {
        const esc = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
        const text = table.map((r) => r.map(esc).join(',')).join('\n') + '\n';
        const back = tokenizeCsv(text, ',');
        // a row of one empty cell is a blank line and comes back as that
        return JSON.stringify(back) === JSON.stringify(table);
      }),
      { numRuns: 300 },
    );
  });
});
