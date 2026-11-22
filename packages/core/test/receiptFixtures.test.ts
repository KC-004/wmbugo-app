import * as fs from 'fs';
import * as path from 'path';
import { CANCELLED, OCR_UNAVAILABLE, isOcrFailure, type OcrResult } from '../src/ports/OcrEngine';

const truthDir = path.resolve(__dirname, '../../../fixtures/receipts/synthetic');
const ocrDir = path.resolve(__dirname, 'fixtures/receipts');

interface Truth {
  id: string;
  market: string;
  merchant: string;
  date: string;
  currency: string;
  subtotalMinor: number;
  taxes: { amountMinor: number }[];
  fees: { amountMinor: number }[];
  discounts: { amountMinor: number }[];
  totalMinor: number;
  items: { name: string; amountMinor: number }[];
  traits: { devanagariOrArabicText: boolean; decimalComma: boolean; multiColumn: boolean; lowContrastOrTilted: boolean; longReceipt: boolean };
}

const ids = fs.readdirSync(truthDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const truths = ids.map((id) => JSON.parse(fs.readFileSync(path.join(truthDir, `${id}.json`), 'utf8')) as Truth);

describe('Story 10.1 synthetic receipt set', () => {
  it('has 40 receipts, 10 per market group, each with an image', () => {
    expect(truths).toHaveLength(40);
    for (const g of ['india', 'us-canada', 'uk-europe', 'gulf-se-asia']) expect(truths.filter((t) => t.market === g)).toHaveLength(10);
    for (const id of ids) expect(fs.existsSync(path.join(truthDir, `${id}.png`))).toBe(true);
  });

  it('covers the required mix', () => {
    const n = (k: keyof Truth['traits']) => truths.filter((t) => t.traits[k]).length;
    expect(n('devanagariOrArabicText')).toBeGreaterThanOrEqual(4);
    expect(n('decimalComma')).toBeGreaterThanOrEqual(4);
    expect(n('multiColumn')).toBeGreaterThanOrEqual(4);
    expect(n('lowContrastOrTilted')).toBeGreaterThanOrEqual(4);
    expect(truths.filter((t) => t.traits.longReceipt && t.items.length >= 30)).toHaveLength(2);
  });

  it.each(truths.map((t) => [t.id, t] as const))('%s: ground truth adds up exactly', (_id, t) => {
    const items = t.items.reduce((s, i) => s + i.amountMinor, 0);
    expect(items).toBe(t.subtotalMinor);
    const rest = [...t.discounts, ...t.fees, ...t.taxes].reduce((s, x) => s + x.amountMinor, 0);
    expect(t.subtotalMinor + rest).toBe(t.totalMinor);
    expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('contains no phone number, card fragment or e-mail address in any ground truth', () => {
    for (const id of ids) {
      const text = fs.readFileSync(path.join(truthDir, `${id}.json`), 'utf8');
      expect(text).not.toMatch(/\d{10,}/);
      expect(text).not.toMatch(/\*{2,}\s*\d{4}|\bxxxx\b/i);
      expect(text).not.toMatch(/@/);
    }
  });
});

describe('Story 10.1 recorded OcrResult fixtures', () => {
  it('has one recorded result per synthetic receipt, with boxes inside the image', () => {
    for (const id of ids) {
      const r = JSON.parse(fs.readFileSync(path.join(ocrDir, `${id}.ocr.json`), 'utf8')) as OcrResult & { id: string; engine: string };
      expect(r.id).toBe(id);
      expect(r.engine).toBe('paddleocr-ppocrv4-onnx');
      expect(r.width).toBeGreaterThan(0);
      expect(r.blocks.length).toBeGreaterThan(5);
      for (const b of r.blocks) {
        expect(b.text.length).toBeGreaterThan(0);
        expect(b.box.right).toBeGreaterThan(b.box.left);
        expect(b.box.bottom).toBeGreaterThan(b.box.top);
        expect(b.box.right).toBeLessThanOrEqual(r.width + 1);
        expect(b.box.bottom).toBeLessThanOrEqual(r.height + 1);
      }
      const t = truths.find((x) => x.id === id)!;
      const digits = r.blocks.map((b) => b.text).join(' ').replace(/[^0-9]/g, '');
      expect(digits).toContain(String(t.totalMinor));
    }
  });

  it('has no phone number, card fragment or e-mail address in any recorded text', () => {
    for (const id of ids) {
      const text = fs.readFileSync(path.join(ocrDir, id + '.ocr.json'), 'utf8');
      expect(JSON.parse(text).blocks.map((b: { text: string }) => b.text).join(' ')).not.toMatch(/\d{10,}|@|\*{2,}\s*\d{4}/);
    }
  });
});

describe('OcrEngine failures', () => {
  it('recognises the two typed failures and nothing else', () => {
    expect(isOcrFailure({ code: OCR_UNAVAILABLE })).toBe(true);
    expect(isOcrFailure({ code: CANCELLED })).toBe(true);
    expect(isOcrFailure({ code: 'OTHER' })).toBe(false);
    expect(isOcrFailure(new Error('x'))).toBe(false);
    expect(isOcrFailure(null)).toBe(false);
  });
});
