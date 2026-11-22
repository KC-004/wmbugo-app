import * as fs from 'fs';
import * as path from 'path';
import type { OcrResult } from '../src/ports/OcrEngine';
import { parseReceipt, scoreReceiptFields, type ReceiptGroundTruth } from '../src/capture/receipt';

const truthDir = path.resolve(__dirname, '../../../fixtures/receipts/synthetic');
const ocrDir = path.resolve(__dirname, 'fixtures/receipts');

interface Truth extends ReceiptGroundTruth {
  id: string;
  market: string;
  region: string;
  currency: string;
  items: unknown[];
}

const ids = fs.readdirSync(truthDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const load = (id: string) => ({
  truth: JSON.parse(fs.readFileSync(path.join(truthDir, `${id}.json`), 'utf8')) as Truth,
  ocr: JSON.parse(fs.readFileSync(path.join(ocrDir, `${id}.ocr.json`), 'utf8')) as OcrResult,
});

describe('NFR-17: parsing the 40 recorded synthetic receipts (Story 10.2)', () => {
  it('gets total, merchant and date right on at least 90% of receipts, and prints the result per market group', () => {
    const groups = new Map<string, { n: number; total: number; merchantN: number; merchant: number; date: number }>();
    const misses: string[] = [];
    for (const id of ids) {
      const { truth, ocr } = load(id);
      const r = parseReceipt(ocr, { region: truth.region, profileCurrency: truth.currency });
      const g = groups.get(truth.market) ?? { n: 0, total: 0, merchantN: 0, merchant: 0, date: 0 };
      g.n++;
      if (!r.ok) {
        misses.push(`${id}: UNREADABLE`);
        groups.set(truth.market, g);
        continue;
      }
      const s = scoreReceiptFields(r.value, truth);
      g.total += s.total ? 1 : 0;
      g.date += s.date ? 1 : 0;
      if (s.merchant !== null) {
        g.merchantN++;
        g.merchant += s.merchant ? 1 : 0;
      }
      if (!s.total || s.merchant === false || !s.date) misses.push(`${id}: total ${s.total} merchant ${s.merchant} date ${s.date}`);
      groups.set(truth.market, g);
    }
    const sum = (k: 'n' | 'total' | 'merchantN' | 'merchant' | 'date') => [...groups.values()].reduce((a, g) => a + g[k], 0);
    const lines = [...groups.entries()].map(([m, g]) => `${m.padEnd(14)} total ${g.total}/${g.n}  merchant ${g.merchant}/${g.merchantN}  date ${g.date}/${g.n}`);
    console.log(`Receipt field accuracy per market group\n${lines.join('\n')}\n${misses.length ? `Misses:\n${misses.join('\n')}` : 'No misses'}`);
    expect(sum('merchantN')).toBeGreaterThanOrEqual(30); // non-Latin merchant names are outside the rate; at most 10 of 40 may be
    expect(misses).toEqual([]); // the parser is at 100% on this set today: any drop is a regression to look at
    expect(sum('total') / sum('n')).toBeGreaterThanOrEqual(0.9);
    expect(sum('merchant') / sum('merchantN')).toBeGreaterThanOrEqual(0.9);
    expect(sum('date') / sum('n')).toBeGreaterThanOrEqual(0.9);
  });

  it('reads the Western-numeral total on every Arabic or Devanagari receipt', () => {
    for (const id of ids) {
      const { truth, ocr } = load(id);
      const traits = JSON.parse(fs.readFileSync(path.join(truthDir, `${id}.json`), 'utf8')).traits as { devanagariOrArabicText: boolean };
      if (!traits.devanagariOrArabicText) continue;
      const r = parseReceipt(ocr, { region: truth.region, profileCurrency: truth.currency });
      expect(r.ok && r.value.total.value).toBe(truth.totalMinor);
    }
  });

  it('parses the longest recorded receipt in under 50 ms (Node benchmark)', () => {
    const longest = ids.map((id) => load(id)).sort((a, b) => b.ocr.blocks.length - a.ocr.blocks.length)[0]!;
    expect(longest.truth.items.length).toBeGreaterThanOrEqual(30);
    const opts = { region: longest.truth.region, profileCurrency: longest.truth.currency };
    parseReceipt(longest.ocr, opts); // warm up
    const runs = 20;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) parseReceipt(longest.ocr, opts);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
    console.log(`Longest receipt (${longest.ocr.blocks.length} blocks) parses in ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });
});
