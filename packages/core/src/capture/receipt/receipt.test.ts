import type { OcrBlock, OcrResult } from '../../ports/OcrEngine';
import { findAmounts, parseDigits } from './amounts';
import { groupLines } from './lines';
import { parseReceipt, SURE_CONFIDENCE } from './parseReceipt';
import { allocateReceipt } from '../../ledger/allocateReceipt';

const blk = (text: string, left: number, top: number, right: number, bottom: number, confidence: number | null = 0.97): OcrBlock => ({
  text,
  box: { left, top, right, bottom },
  confidence,
});

/** A straight receipt: one row per entry, a label at the left and an optional amount at the right. */
function rows(entries: readonly (readonly [string, string?])[], opts: { width?: number; rowH?: number; conf?: number | null; top?: number; height?: number } = {}): OcrResult {
  const width = opts.width ?? 560;
  const rowH = opts.rowH ?? 34;
  const top0 = opts.top ?? 30;
  const blocks: OcrBlock[] = [];
  entries.forEach(([label, amount], i) => {
    const top = top0 + i * rowH;
    blocks.push(blk(label, 20, top, 20 + label.length * 13, top + 26, opts.conf));
    if (amount !== undefined) blocks.push(blk(amount, width - 20 - amount.length * 13, top, width - 20, top + 26, opts.conf));
  });
  return { width, height: opts.height ?? top0 + entries.length * rowH + 60, blocks };
}

const GB = { region: 'GB', profileCurrency: 'GBP' };
const parse = (ocr: OcrResult, o = GB) => {
  const r = parseReceipt(ocr, o);
  if (!r.ok) throw new Error('unreadable');
  return r.value;
};

describe('amounts (Story 10.2: no floats, region decides the decimal mark)', () => {
  it.each([
    ['1.234,56', 'DE', 'EUR', 123456],
    ['1,234.56', 'GB', 'GBP', 123456],
    ['1,23,456.00', 'IN', 'INR', 12345600],
    ['1.234.567,89', 'DE', 'EUR', 123456789],
    ['1,234,567.89', 'US', 'USD', 123456789],
    ['12,50', 'FR', 'EUR', 1250],
    ['12.50', 'DE', 'EUR', 1250],
  ])('%s in %s reads as %i minor units', (text, region, currency, minor) => {
    const exp = currency === 'GBP' || currency === 'EUR' || currency === 'USD' || currency === 'INR' ? 2 : 3;
    const a = findAmounts(`Total ${text}`, exp, region);
    expect(a).toHaveLength(1);
    expect(a[0]!.minor).toBe(minor);
  });

  it('takes the last separator as the decimal mark when both are present', () => {
    expect(parseDigits('1,234.5', 2, '.')).toEqual({ minor: 123450, hasDecimal: true });
    expect(parseDigits('1.234,5', 2, ',')).toEqual({ minor: 123450, hasDecimal: true });
  });

  it('uses the currency exponent: JPY has none, KWD has three', () => {
    expect(findAmounts('Total 1,234', 0, 'JP')[0]!.minor).toBe(1234);
    expect(findAmounts('Total 12.500', 3, 'KW')[0]!.minor).toBe(12500);
    expect(findAmounts('Total 1,500.250', 3, 'KW')[0]!.minor).toBe(1500250);
  });

  it('refuses more decimals than the currency has unless they are zeros, and never rounds', () => {
    expect(parseDigits('3.505', 2, '.')).toBeNull();
    expect(parseDigits('3.500', 2, '.')).toEqual({ minor: 350, hasDecimal: true });
  });

  it('does not read quantities, sizes, dates or times as amounts when currency has cents', () => {
    expect(findAmounts('Milk 2 x 500ml 05.07.2026 15:04', 2, 'DE')).toHaveLength(0);
    expect(findAmounts('Date: 2026-07-05  18:31', 2, 'IN')).toHaveLength(0);
  });

  it('reads a minus before, after or around an amount as negative', () => {
    expect(findAmounts('Discount -2.50', 2, 'GB')[0]!.minor).toBe(-250);
    expect(findAmounts('Discount 2.50-', 2, 'GB')[0]!.minor).toBe(-250);
    expect(findAmounts('Discount (2.50)', 2, 'GB')[0]!.minor).toBe(-250);
  });

  it('does not read Eastern Arabic or Devanagari digits', () => {
    expect(findAmounts('المجموع ١٢٫٥٠٠', 3, 'KW')).toHaveLength(0);
    expect(findAmounts('कुल १२५.००', 2, 'IN')).toHaveLength(0);
  });
});

describe('groupLines', () => {
  it('uses the midpoint (top + bottom) / 2: a regression where top + bottom / 2 would merge two lines', () => {
    const small = Array.from({ length: 8 }, (_, i) => blk(`S${i}`, 10, 400 + i * 40, 60, 420 + i * 40));
    const a = blk('Left line', 10, 200, 120, 220); // midpoint 210; top + bottom / 2 = 310
    const b = blk('Tall line', 200, 160, 330, 300); // midpoint 230; top + bottom / 2 = 310
    const lines = groupLines([...small, a, b], 400, 800);
    const texts = lines.map((l) => l.text);
    expect(texts).toContain('Left line');
    expect(texts).toContain('Tall line');
    expect(texts.find((t) => t.includes('Left line'))).toBe('Left line');
  });

  it('orders by midpoint then left edge and joins fragments of a row', () => {
    const lines = groupLines([blk('9.99', 400, 52, 480, 78), blk('Tea', 20, 50, 80, 80), blk('Coffee', 20, 100, 120, 130)], 500, 300);
    expect(lines.map((l) => l.text)).toEqual(['Tea 9.99', 'Coffee']);
  });

  it('joins prices in a far-right column to their item on a multi-column receipt', () => {
    const r: OcrResult = {
      width: 760,
      height: 400,
      blocks: [
        blk('Basmati rice', 20, 100, 200, 126),
        blk('1', 480, 101, 495, 127),
        blk('649.00', 560, 100, 640, 126),
        blk('649.00', 660, 99, 740, 125),
        blk('Toor dal', 20, 140, 150, 166),
        blk('2', 480, 141, 495, 167),
        blk('189.50', 560, 140, 640, 166),
        blk('379.00', 660, 139, 740, 165),
        blk('Total', 20, 200, 100, 226),
        blk('1028.00', 640, 200, 740, 226),
      ],
    };
    const d = parse(r, { region: 'IN', profileCurrency: 'INR' });
    expect(d.items.map((i) => [i.name, i.amountMinor])).toEqual([
      ['Basmati rice', 64900],
      ['Toor dal', 37900],
    ]);
    expect(d.total.value).toBe(102800);
  });

  it.each([5, -5, 3])('keeps rows together on a photo tilted by %i degrees', (deg) => {
    const base = rows([['Merchant Name'], ['Tea', '2.00'], ['Coffee', '3.50'], ['Bread', '1.25'], ['Milk', '0.99'], ['Eggs', '2.75'], ['Total', '10.49']], { width: 560 });
    const rad = (deg * Math.PI) / 180;
    const cx = base.width / 2;
    const cy = base.height / 2;
    const rot = (x: number, y: number) => [cx + (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad), cy + (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad)] as const;
    const blocks = base.blocks.map((b) => {
      const [l, t] = rot(b.box.left, (b.box.top + b.box.bottom) / 2);
      const [r] = rot(b.box.right, (b.box.top + b.box.bottom) / 2);
      const h = b.box.bottom - b.box.top;
      return blk(b.text, Math.round(l), Math.round(t - h / 2), Math.round(r), Math.round(t + h / 2));
    });
    const d = parse({ ...base, blocks });
    expect(d.total.value).toBe(1049);
    expect(d.items.map((i) => i.amountMinor)).toEqual([200, 350, 125, 99, 275]);
  });
});

describe('field rules', () => {
  const body = [['Corner Cafe'], ['Date: 05/07/2026  15:04'], ['Latte', '3.50'], ['Muffin', '2.25'], ['Subtotal', '5.75'], ['VAT 20%', '1.15'], ['Service charge', '0.58'], ['Total', '7.48']] as const;

  it('reads merchant, date, time, items, charges and total in minor units', () => {
    const d = parse(rows(body));
    expect(d.merchant).toEqual({ value: 'Corner Cafe', certainty: 'sure' });
    expect(d.date).toEqual({ value: '2026-07-05', certainty: 'sure' });
    expect(d.time).toEqual({ value: '15:04', certainty: 'sure' });
    expect(d.currency).toEqual({ value: 'GBP', certainty: 'sure' });
    expect(d.items.map((i) => [i.name, i.amountMinor, i.lineIndex])).toEqual([
      ['Latte', 350, 2],
      ['Muffin', 225, 3],
    ]);
    expect(d.subtotal).toEqual({ value: 575, certainty: 'sure' });
    expect(d.taxes.map((t) => [t.label, t.value])).toEqual([['VAT 20%', 115]]);
    expect(d.fees.map((t) => [t.label, t.value])).toEqual([['Service charge', 58]]);
    expect(d.total).toEqual({ value: 748, certainty: 'sure' });
    expect(d.unparsedLineCount).toBe(0);
  });

  it.each(['Total', 'Grand total', 'Amount due', 'Net amount', 'Balance due', 'To pay', 'Summe', 'Gesamt', 'Total TTC', 'Totale', 'Importe', 'Totaal'])('finds the total on a "%s" line', (kw) => {
    const d = parse(rows([['Shop Name'], ['Thing', '4.00'], [kw, '4.00']]));
    expect(d.total.value).toBe(400);
  });

  it.each(['GST', 'CGST', 'SGST', 'IGST', 'VAT', 'MwSt', 'TVA', 'IVA', 'HST', 'Sales tax'])('reads %s as a tax', (kw) => {
    const d = parse(rows([['Shop Name'], ['Thing', '4.00'], [kw, '0.40'], ['Total', '4.40']]));
    expect(d.taxes.map((t) => t.value)).toEqual([40]);
    expect(d.total.certainty).toBe('sure');
  });

  it('reads GST lines the engine glued to a rate or an amount as taxes, not items (a real receipt)', () => {
    const d = parse(rows([['Shop Name'], ['Rice Prawns Fried', '195.00'], ['Chicken Noodles', '225.00'], ['420.00CGST25%', '10.50'], ['420@SGST2.%', '10.50'], ['Total', '441.00']]));
    expect(d.items.map((i) => i.name)).toEqual(['Rice Prawns Fried', 'Chicken Noodles']);
    expect(d.taxes.map((t) => t.value)).toEqual([1050, 1050]);
    expect(d.total.value).toBe(44100);
  });

  it('takes the last amount on the last total line', () => {
    const d = parse(rows([['Shop Name'], ['Thing', '4.00'], ['Total', '4.00'], ['Total paid', '4.00']]));
    expect(d.total.value).toBe(400);
  });

  it('treats a negative amount directly under an item as that item\'s discount, and a discount line after the items as whole-bill', () => {
    const d = parse(rows([['Shop Name'], ['Jacket', '50.00'], ['Item offer', '-5.00'], ['Shirt', '20.00'], ['Member discount', '-3.00'], ['Total', '62.00']]));
    expect(d.items.map((i) => [i.name, i.amountMinor, i.discountMinor])).toEqual([
      ['Jacket', 5000, 500],
      ['Shirt', 2000, 0],
    ]);
    expect(d.discounts.map((x) => [x.label, x.value])).toEqual([['Member discount', 300]]);
    expect(d.total).toEqual({ value: 6200, certainty: 'sure' });
  });

  it('skips address, phone, URL and tax-ID lines when choosing the merchant, and keeps the first plain name line', () => {
    const d = parse(
      rows([['12 High Street London'], ['Tel 020 7946 0000'], ['www.example.com'], ['GSTIN 29ABCDE1234F1Z5'], ['The Blue Door Cafe'], ['Tea', '2.00'], ['Total', '2.00']], { rowH: 40, height: 1200 }),
    );
    expect(d.merchant.value).toBe('The Blue Door Cafe');
  });

  it('only looks for the merchant in the top fifth', () => {
    const d = parse(rows([['Thing', '4.00'], ['Total', '4.00'], ['x1'], ['x2'], ['x3'], ['x4'], ['x5'], ['x6'], ['x7'], ['x8'], ['Late Name Shop']], { rowH: 50 }));
    expect(d.merchant).toEqual({ value: null, certainty: 'missing' });
  });

  it('reads a 30-item receipt', () => {
    const entries: (readonly [string, string?])[] = [['Big Shop']];
    for (let i = 0; i < 30; i++) entries.push([`Item ${String.fromCharCode(65 + (i % 26))}${i}`, '1.00']);
    entries.push(['Total', '30.00']);
    const d = parse(rows(entries));
    expect(d.items).toHaveLength(30);
    expect(d.total).toEqual({ value: 3000, certainty: 'sure' });
  });
});

describe('currency, item names and unparsed lines', () => {
  it('keeps the profile currency, and flags a different printed ISO code as unsure', () => {
    const plain = parse(rows([['Shop Name'], ['Tea', '2.00'], ['Total GBP', '2.00']]));
    expect(plain.currency).toEqual({ value: 'GBP', certainty: 'sure' });
    const foreign = parse(rows([['Shop Name'], ['Tea', '2.00'], ['Total USD', '2.00']]));
    expect(foreign.currency).toEqual({ value: 'USD', certainty: 'unsure' });
  });

  it.each([
    ['Tea x2', 'Tea'],
    ['Bread 500g', 'Bread 500g'],
    ['Cola:', 'Cola'],
    ['Soap - ', 'Soap'],
    ['Rice 1 2', 'Rice'],
  ])('cleans the item name %j to %j', (printed, name) => {
    const d = parse(rows([['Shop Name'], [printed, '3.00'], ['Total', '3.00']]));
    expect(d.items.map((i) => i.name)).toEqual([name]);
  });

  it('counts lines with an amount that were not recognised', () => {
    const d = parse(rows([['Shop Name'], ['Tea', '2.00'], ['Total', '2.00'], ['Cash tendered', '5.00'], ['Change', '3.00']]));
    expect(d.unparsedLineCount).toBe(2);
    const arabic = parse(rows([['Shop Name'], ['خبز', '2.00'], ['Tea', '1.00'], ['Total', '3.00']]));
    expect(arabic.unparsedLineCount).toBe(1);
    expect(arabic.items.map((i) => i.name)).toEqual(['Tea']);
  });
});

describe('layouts seen on real receipts', () => {
  it('reads a space as the thousands mark (FR, SE, PL) and a percent rate is not an amount', () => {
    const d = parse(rows([['Magasin Central'], ['Meuble', '1 234,56'], ['TVA 5,5%'], ['Total', '1 234,56']]), { region: 'FR', profileCurrency: 'EUR' });
    expect(d.items.map((i) => i.amountMinor)).toEqual([123456]);
    expect(d.total.value).toBe(123456);
    expect(d.taxes).toHaveLength(0);
  });

  it('keeps reading items when a header or an item name looks like a summary word', () => {
    const d = parse(rows([['TAX INVOICE'], ['Corner Cafe'], ['Room service sandwich', '6.00'], ['Tea', '2.00'], ['Total', '8.00']]));
    expect(d.items.map((i) => i.name)).toEqual(['Room service sandwich', 'Tea']);
  });

  it('does not take Total savings, Total VAT or Total items as the bill total', () => {
    const d = parse(rows([['Corner Cafe'], ['Tea', '2.00'], ['Total', '2.00'], ['Total savings', '0.50'], ['Total items', '1.00']]));
    expect(d.total).toEqual({ value: 200, certainty: 'sure' });
    expect(d.unparsedLineCount).toBe(0);
  });

  it('reads a 12-hour time with am or pm', () => {
    const t = (text: string) => parse(rows([['Corner Cafe'], [text], ['Tea', '2.00'], ['Total', '2.00']])).time.value;
    expect([t('Date 03/04/2026 03:04 PM'), t('Date 03/04/2026 12:10 am'), t('Date 03/04/2026 12:10 PM')]).toEqual(['15:04', '00:10', '12:10']);
  });

  it('does not take an item line as the merchant', () => {
    expect(parse(rows([['Cappuccino large', '4.50'], ['Total', '4.50']])).merchant.value).toBeNull();
  });

  it('ignores opening hours when reading the time', () => {
    const d = parse(rows([['Corner Cafe'], ['Open 09:00 - 22:00'], ['Date 03/04/2026 18:45'], ['Tea', '2.00'], ['Total', '2.00']]));
    expect(d.time.value).toBe('18:45');
  });
});

describe('dates follow the region', () => {
  const dateOf = (region: string, text: string, conf = 0.97) => parse(rows([['Some Shop'], [text], ['Tea', '2.00'], ['Total', '2.00']], { conf }), { region, profileCurrency: 'GBP' }).date;

  it('reads day-month-year in IN, GB, DE, SG and AE', () => {
    for (const r of ['IN', 'GB', 'DE', 'SG', 'AE']) expect(dateOf(r, '03/04/2026')).toEqual({ value: '2026-04-03', certainty: 'sure' });
  });

  it('reads month-day-year in US', () => {
    expect(dateOf('US', '03/04/2026')).toEqual({ value: '2026-03-04', certainty: 'sure' });
  });

  it('marks a date that reads both ways in CA as unsure, but not one that only reads one way', () => {
    expect(dateOf('CA', '03/04/2026').certainty).toBe('unsure');
    expect(dateOf('CA', '25/04/2026')).toEqual({ value: '2026-04-25', certainty: 'sure' });
  });

  it('falls back to the other order when the first is impossible, and reads ISO and written months', () => {
    expect(dateOf('US', '25/04/2026').value).toBe('2026-04-25');
    expect(dateOf('GB', '2026-04-25').value).toBe('2026-04-25');
    expect(dateOf('GB', '5 Jul 2026').value).toBe('2026-07-05');
    expect(dateOf('GB', '31/02/2026').value).toBeNull();
  });

  it('is unsure below engine confidence 0.80 and sure at 0.80', () => {
    expect(SURE_CONFIDENCE).toBe(0.8);
    expect(dateOf('GB', '03/04/2026', 0.79).certainty).toBe('unsure');
    expect(dateOf('GB', '03/04/2026', 0.8).certainty).toBe('sure');
  });
});

describe('certainty', () => {
  it('marks a total unsure when two different total candidates exist', () => {
    const d = parse(rows([['Shop Name'], ['Thing', '4.00'], ['Total', '4.00'], ['Total', '4.50']]));
    expect(d.total).toEqual({ value: 450, certainty: 'unsure' });
  });

  it('marks a total unsure when it differs from subtotal plus tax and fees minus discounts', () => {
    const d = parse(rows([['Shop Name'], ['Thing', '4.00'], ['Subtotal', '4.00'], ['VAT', '0.80'], ['Total', '5.00']]));
    expect(d.total).toEqual({ value: 500, certainty: 'unsure' });
  });

  it('fills a missing total from the items and marks it unsure; no items means missing', () => {
    const withItems = parse(rows([['Shop Name'], ['Tea', '2.00'], ['Cake', '3.00']]));
    expect(withItems.total).toEqual({ value: 500, certainty: 'unsure' });
    const none = parse(rows([['Shop Name'], ['Date 03/04/2026'], ['9.99']]));
    expect(none.total).toEqual({ value: null, certainty: 'missing' });
  });

  it('marks a field unsure when its line has engine confidence below 0.80', () => {
    const d = parse(rows([['Shop Name'], ['Tea', '2.00'], ['Total', '2.00']], { conf: 0.6 }));
    expect(d.merchant.certainty).toBe('unsure');
    expect(d.total.certainty).toBe('unsure');
  });

  it('treats a confidence of null as sure', () => {
    const d = parse(rows([['Shop Name'], ['Tea', '2.00'], ['Total', '2.00']], { conf: null }));
    expect(d.total.certainty).toBe('sure');
  });
});

describe('script scope (OCR-007)', () => {
  it('reads the Western-numeral total on an Arabic total line and never uses Arabic text as a merchant or item', () => {
    const d = parse(rows([['سوق النخيل'], ['خبز عربي', '3.500'], ['المجموع', '12.500']]), { region: 'KW', profileCurrency: 'KWD' });
    expect(d.total).toEqual({ value: 12500, certainty: 'sure' });
    expect(d.merchant.value).toBeNull();
    expect(d.items).toHaveLength(0);
  });

  it('reads a Devanagari total line with Western numerals but not Devanagari digits', () => {
    const ok = parse(rows([['सागर मार्ट'], ['कुल', '448.35']]), { region: 'IN', profileCurrency: 'INR' });
    expect(ok.total.value).toBe(44835);
    expect(ok.merchant.value).toBeNull();
    const eastern = parse(rows([['Shop Name'], ['Tea', '2.00'], ['कुल', '४४८.३५']]), { region: 'IN', profileCurrency: 'INR' });
    expect(eastern.total.certainty).toBe('unsure');
    expect(eastern.total.value).toBe(200);
  });

  it('is unreadable when the only amounts are in Eastern Arabic digits', () => {
    const d = parse(rows([['Shop Name'], ['Date 03/04/2026'], ['Tea', '2.00'], ['الإجمالي', '٢٫٠٠']]));
    expect(d.total.value).not.toBeNull();
    const onlyEastern = parseReceipt(rows([['Shop Name'], ['المجموع', '٢٫٠٠']]), GB);
    expect(onlyEastern).toEqual({ ok: false, code: 'UNREADABLE' });
  });
});

describe('UNREADABLE', () => {
  it('is returned for no text and for no readable amount', () => {
    expect(parseReceipt({ width: 100, height: 100, blocks: [] }, GB)).toEqual({ ok: false, code: 'UNREADABLE' });
    expect(parseReceipt(rows([['Hello there'], ['Thank you']]), GB)).toEqual({ ok: false, code: 'UNREADABLE' });
    expect(parseReceipt(rows([['   ']]), GB)).toEqual({ ok: false, code: 'UNREADABLE' });
  });
});

describe('Epic 10 review fixes', () => {
  const read = (entries: readonly (readonly [string, string?])[], o = GB) => parse(rows([['Shop Name'], ...entries]), o);

  it('keeps a quantity apart from the price where a space does not group thousands', () => {
    expect(findAmounts('Basmati rice 1 649.00', 2, 'IN').map((a) => a.minor)).toEqual([64900]);
    expect(findAmounts('Eggs 10 250.00', 2, 'IN').map((a) => a.minor)).toEqual([25000]);
  });

  it.each([
    ['RM12.50', 'MY', 1250],
    ['Rs450.00', 'IN', 45000],
    ['Bread 12.50A', 'GB', 1250],
    ['Total 1’234.50', 'CH', 123450],
  ])('reads %s', (text, region, minor) => {
    expect(findAmounts(text, 2, region).map((a) => a.minor)).toEqual([minor]);
  });

  it('does not read a litre size as an amount with a tax letter', () => {
    expect(findAmounts('Milk 1.50L', 2, 'GB')).toHaveLength(0);
  });

  it('reads a product with a total word as an item, and keeps the items after it', () => {
    const d = read([['Colgate Total', '3.50'], ['Bread', '2.00'], ['Total', '5.50']]);
    expect(d.items.map((i) => i.name)).toEqual(['Colgate Total', 'Bread']);
    expect(d.total).toEqual({ value: 550, certainty: 'sure' });
  });

  it('keeps the items after a fee printed between them', () => {
    const d = read([['Tea', '2.00'], ['Delivery', '1.00'], ['Bread', '2.00'], ['Total', '5.00']]);
    expect(d.items.map((i) => i.name)).toEqual(['Tea', 'Bread']);
    expect(d.fees.map((f) => f.value)).toEqual([100]);
  });

  it('does not read a word containing a GST word as tax, and reads UTGST and Cess', () => {
    expect(read([['BigStack chips', '3.50'], ['Total', '3.50']]).taxes).toHaveLength(0);
    expect(read([['Tea', '10.00'], ['UTGST', '0.25'], ['350@UTGST2%', '0.25'], ['Cess', '0.10'], ['Total', '10.60']]).taxes.map((t) => t.value)).toEqual([25, 25, 10]);
  });

  it('does not take what was paid as the bill total, but uses it when it is the only total', () => {
    expect(read([['Bread', '2.00'], ['Total', '2.00'], ['Total paid', '10.00']]).total.value).toBe(200);
    expect(read([['Bread', '2.00'], ['Total paid', '2.00']]).total.value).toBe(200);
  });

  it('matches a total word that starts with an accented letter', () => {
    expect(read([['Kenyer', '4.00'], ['Összesen', '4.00']]).total.value).toBe(400);
  });

  it('counts a coupon between the subtotal and the total as a discount', () => {
    const d = read([['Bread', '5.00'], ['Subtotal', '5.00'], ['Coupon', '-2.00'], ['Total', '3.00']]);
    expect(d.discounts.map((x) => x.value)).toEqual([200]);
  });

  it('makes a keyword discount between two items the first item own discount', () => {
    const d = read([['Jacket', '50.00'], ['Member discount', '5.00'], ['Shirt', '20.00'], ['Total', '65.00']]);
    expect(d.items.map((i) => i.discountMinor)).toEqual([500, 0]);
    expect(d.discounts).toHaveLength(0);
  });

  it('does not add a tax the prices already include', () => {
    const d = read([['Bread', '6.90'], ['Total', '6.90'], ['VAT included', '1.15']]);
    expect(d.total).toEqual({ value: 690, certainty: 'sure' });
    expect(allocateReceipt(d, [null], 'cat_food')).toMatchObject({ state: 'reconciled', taxIncluded: true });
  });
});
