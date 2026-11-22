// Generates the 40 synthetic receipt images and their ground-truth JSON (Story 10.1).
// Every merchant, item and number is invented; no real person, card, phone or loyalty ID appears.
// Run: node scripts/gen-synthetic-receipts.mjs [outDir]
// Needs `@napi-rs/canvas`, which is NOT a project dependency: install it in a scratch folder and run with NODE_PATH set to it.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const font = (f, n) => { if (!GlobalFonts.registerFromPath(f, n)) throw new Error('font missing: ' + f); };
font('C:/Windows/Fonts/arial.ttf', 'RcpSans');
font('C:/Windows/Fonts/cour.ttf', 'RcpMono');
font('C:/Windows/Fonts/Nirmala.ttc', 'RcpDeva');

const outDir = process.argv[2] ?? 'fixtures/receipts/synthetic';
fs.mkdirSync(outDir, { recursive: true });

let seed = 20261122;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const MARKETS = {
  IN: { group: 'india', currency: 'INR', exp: 2, dec: '.', grp: 'indian', order: 'DMY', tax: ['CGST', 'SGST'], taxRate: 0.025, total: 'Grand Total',
    shops: ['Sagar Fresh Mart', 'Lotus Sweets and Snacks', 'Green Leaf Pharmacy', 'Blue Door Cafe', 'Metro Basket', 'Raj Stationers', 'Annapurna Kitchen', 'Kiran Hardware', 'City Bazaar', 'Neem Tree Bakery'],
    items: [['Basmati rice 5kg', 64900], ['Toor dal 1kg', 18950], ['Paneer 200g', 9000], ['Masala chai pack', 12500], ['Notebook A4', 6500], ['Samosa x2', 4000], ['Filter coffee', 8000], ['Bath soap', 4400], ['Mango 1kg', 14000], ['Curd 500g', 3800], ['Ghee 500ml', 32500], ['Tea 250g', 11000]] },
  US: { group: 'us-canada', currency: 'USD', exp: 2, dec: '.', grp: ',', order: 'MDY', tax: ['Sales tax'], taxRate: 0.0725, total: 'Total',
    shops: ['Maple Street Grocery', 'Harbor Coffee Roasters', 'Northside Hardware', 'Pine Ridge Diner', 'Cedar Pharmacy', 'Lakeview Market', 'Corner Pizza House', 'Oak and Iron Books', 'Sunrise Bakery', 'Granite Fuel Stop'],
    items: [['Whole milk 1gal', 429], ['Eggs dozen', 389], ['Sourdough loaf', 599], ['Ground coffee 12oz', 1299], ['Chicken breast', 1245], ['Paper towels', 1099], ['Cheddar block', 549], ['Granola bars', 479], ['Bananas', 189], ['Olive oil', 1399], ['Pasta 16oz', 199], ['Sparkling water', 649]] },
  EU: { group: 'uk-europe', currency: 'EUR', exp: 2, dec: ',', grp: '.', order: 'DMY', tax: ['MwSt'], taxRate: 0.19, total: 'Summe',
    shops: ['Bäckerei Lindenhof', 'Café Rosengarten', 'Markt am Fluss', 'Buchhandlung Nord', 'Apotheke am Dom', 'Kleine Metzgerei', 'Gasthaus Zum Anker', 'Papeterie Bleu', 'Fleurs du Matin', 'Tabac du Port'],
    items: [['Brötchen 6 Stk', 330], ['Vollkornbrot', 389], ['Käse Gouda', 479], ['Apfelsaft 1l', 189], ['Kaffee Crema', 749], ['Schokolade', 159], ['Butter 250g', 229], ['Mineralwasser', 99], ['Joghurt', 79], ['Tomaten 500g', 249], ['Eier 10 Stk', 319], ['Nudeln 500g', 149]] },
  UK: { group: 'uk-europe', currency: 'GBP', exp: 2, dec: '.', grp: ',', order: 'DMY', tax: ['VAT'], taxRate: 0.2, total: 'Total',
    shops: ['Bridge Road Deli', 'Thames Newsagent', 'Corner Chemist', 'Hollybush Grocer', 'Red Lion Kitchen', 'Elm Park Books', 'Mill Lane Bakery', 'Penny Hardware', 'Tidal Coffee Bar', 'Station Express'],
    items: [['Semi skimmed milk', 155], ['Sliced bread', 129], ['Cheddar 400g', 325], ['Tea bags 80', 215], ['Baked beans', 85], ['Chicken thighs', 410], ['Biscuits', 120], ['Orange juice', 189], ['Free range eggs', 275], ['Butter 250g', 199], ['Pasta sauce', 140], ['Crisps', 100]] },
  GULF: { group: 'gulf-se-asia', currency: 'AED', exp: 2, dec: '.', grp: ',', order: 'DMY', tax: ['VAT'], taxRate: 0.05, total: 'Total',
    shops: ['Palm Grove Supermarket', 'Desert Rose Cafe', 'Al Noor Pharmacy', 'Marina Bites', 'Souk Spice House', 'Crescent Electronics', 'Falcon Fuel Station', 'Pearl Bakery', 'Dune Grill', 'Oasis Fresh Market'],
    items: [['Arabic bread', 350], ['Laban 1l', 650], ['Dates 500g', 2500], ['Chicken shawarma', 1200], ['Mineral water 6x', 1050], ['Rice 5kg', 3200], ['Hummus', 800], ['Fresh juice', 1500], ['Olive oil 500ml', 3600], ['Falafel box', 1100], ['Tea 100 bags', 1450], ['Saffron 1g', 2200]], fee: 'Service charge' },
  SG: { group: 'gulf-se-asia', currency: 'SGD', exp: 2, dec: '.', grp: ',', order: 'DMY', tax: ['GST'], taxRate: 0.09, total: 'Total',
    shops: ['Lion City Hawker Hub', 'Orchard Tea House', 'Kampong Mart', 'Bayfront Noodles', 'Little India Spices'],
    items: [['Chicken rice', 450], ['Kopi O', 150], ['Laksa', 650], ['Roti prata', 280], ['Soy milk', 190], ['Satay 10 sticks', 1000], ['Teh tarik', 180], ['Fried noodles', 550]], fee: 'Service charge' },
};

const pad = (n) => String(n).padStart(2, '0');
function fmtMoney(minor, m, forceDec) {
  const exp = m.exp; const neg = minor < 0; let v = Math.abs(minor);
  const whole = Math.floor(v / 10 ** exp); const frac = String(v % 10 ** exp).padStart(exp, '0');
  let w = String(whole);
  const dec = forceDec ?? m.dec;
  if (m.grp === 'indian') { const last3 = w.slice(-3); const rest = w.slice(0, -3); w = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3; }
  else if (m.grp === ',' ) w = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  else if (m.grp === '.') w = w.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + w + (exp ? dec + frac : '');
}
function fmtDate(d, m) {
  const [y, mo, da] = d;
  if (m.order === 'MDY') return `${pad(mo)}/${pad(da)}/${y}`;
  return m.dec === ',' ? `${pad(da)}.${pad(mo)}.${y}` : `${pad(da)}/${pad(mo)}/${y}`;
}

// Receipt plan: index -> traits. Counts satisfy the Story 10.1 mix (Devanagari 3, Arabic 3, decimal comma 5, multi-column 5, low contrast or tilted 5, long 2).
const plan = [];
for (let i = 0; i < 10; i++) plan.push({ m: 'IN', i, deva: i < 3, multi: i === 3 || i === 7, tilt: i === 5 ? 3 : i === 9 ? -2 : 0, low: i === 8, long: i === 6 });
for (let i = 0; i < 10; i++) plan.push({ m: 'US', i, multi: i === 2, tilt: i === 4 ? -4 : 0, low: i === 6, long: i === 8, disc: i === 1 || i === 7 });
for (let i = 0; i < 10; i++) plan.push({ m: i < 5 ? 'EU' : 'UK', i, multi: i === 1 || i === 6, tilt: i === 3 ? 2 : 0, low: i === 8, disc: i === 4 });
for (let i = 0; i < 10; i++) plan.push({ m: i < 6 ? 'GULF' : 'SG', i, arabic: i < 3, multi: i === 4, tilt: i === 7 ? -3 : 0, low: i === 9, fee: true });

const truths = [];
plan.forEach((p, idx) => {
  const m = MARKETS[p.m];
  const n = p.long ? 32 : 3 + Math.floor(rnd() * 5);
  const items = [];
  for (let k = 0; k < n; k++) { const [name, price] = pick(m.items); items.push({ name, amountMinor: price + (p.long ? k * 10 : 0) }); }
  const shop = m.shops[p.i % m.shops.length];
  const subtotal = items.reduce((s, x) => s + x.amountMinor, 0);
  const discounts = p.disc ? [{ label: 'Discount', amountMinor: -Math.round(subtotal * 0.1) }] : [];
  const base = subtotal + discounts.reduce((s, d) => s + d.amountMinor, 0);
  const fees = p.fee ? [{ label: m.fee, amountMinor: Math.round(base * 0.1) }] : [];
  const taxBase = base + fees.reduce((s, d) => s + d.amountMinor, 0);
  const taxTotal = Math.round(taxBase * (m.tax.length === 2 ? m.taxRate * 2 : m.taxRate));
  const taxes = m.tax.length === 2 ? [{ label: m.tax[0], amountMinor: Math.floor(taxTotal / 2) }, { label: m.tax[1], amountMinor: taxTotal - Math.floor(taxTotal / 2) }] : [{ label: m.tax[0], amountMinor: taxTotal }];
  const total = taxBase + taxes.reduce((s, t) => s + t.amountMinor, 0);
  const date = [2026, 1 + Math.floor(rnd() * 11), 1 + Math.floor(rnd() * 27)];
  const dateIso = `${date[0]}-${pad(date[1])}-${pad(date[2])}`;
  const id = `${String(idx + 1).padStart(2, '0')}-${m.group}-${p.m.toLowerCase()}`;

  // Layout lines
  const W = p.multi ? 760 : 560; const lh = 34; const lines = [];
  const L = (t, o = {}) => lines.push({ t, ...o });
  const merchantText = p.arabic ? 'سوق النخيل' : p.deva ? ['सागर फ्रेश मार्ट', 'कमल मिठाई घर', 'हरित औषधालय'][p.i] : shop;
  L(merchantText, { big: true, center: true, rtl: !!p.arabic, deva: !!p.deva });
  L(p.deva ? 'धन्यवाद, फिर आइए' : p.arabic ? 'شكرا لزيارتكم' : `${pick(['Tel', 'Open daily'])} 9:00 - 21:00`, { center: true, rtl: !!p.arabic, deva: !!p.deva });
  L('');
  L(`${p.m === 'US' ? 'Date' : p.m === 'EU' ? 'Datum' : 'Date'}: ${fmtDate(date, m)}  ${pad(9 + Math.floor(rnd() * 11))}:${pad(Math.floor(rnd() * 60))}`);
  L('-'.repeat(p.multi ? 52 : 36));
  if (p.multi) L(['ITEM', 'QTY', 'RATE', 'AMOUNT'], { cols: true });
  for (const it of items) {
    const label = p.deva ? `${it.name}` : it.name;
    if (p.multi) L([label, '1', fmtMoney(it.amountMinor, m), fmtMoney(it.amountMinor, m)], { cols: true });
    else L([label, fmtMoney(it.amountMinor, m)], { pair: true });
  }
  L('-'.repeat(p.multi ? 52 : 36));
  const pr = (label, amt) => L(p.multi ? [label, '', '', fmtMoney(amt, m)] : [label, fmtMoney(amt, m)], p.multi ? { cols: true } : { pair: true });
  pr(p.m === 'EU' ? 'Zwischensumme' : 'Subtotal', subtotal);
  for (const d of discounts) pr(d.label, d.amountMinor);
  for (const f of fees) pr(f.label, f.amountMinor);
  for (const t of taxes) pr(t.label, t.amountMinor);
  L('='.repeat(p.multi ? 52 : 36));
  pr(p.deva ? 'Grand Total' : m.total, total);
  L('');
  L(p.arabic ? 'شكرا' : 'Thank you', { center: true, rtl: !!p.arabic });

  const H = lines.length * lh + 100;
  const c = createCanvas(W + (p.tilt ? 120 : 0), H + (p.tilt ? 120 : 0));
  const g = c.getContext('2d');
  g.fillStyle = p.low ? '#8a8a82' : '#e9e6dc'; g.fillRect(0, 0, c.width, c.height);
  g.save(); g.translate(c.width / 2, c.height / 2); g.rotate((p.tilt * Math.PI) / 180); g.translate(-W / 2, -H / 2);
  g.fillStyle = p.low ? '#a2a29a' : '#fbfaf5'; g.fillRect(0, 0, W, H);
  g.fillStyle = p.low ? '#7d7d76' : '#1a1a1a';
  let y = 60;
  for (const ln of lines) {
    const font = ln.deva ? 'RcpDeva' : 'RcpMono';
    g.font = `${ln.big ? 'bold 34px' : '24px'} ${p.arabic && ln.rtl ? 'RcpSans' : font}`;
    if (ln.cols) {
      const xs = [24, W - 330, W - 230, W - 24]; const al = ['left', 'right', 'right', 'right'];
      ln.t.forEach((cell, k) => { g.textAlign = al[k]; g.fillText(cell, k === 0 ? 24 : xs[k], y); });
    } else if (ln.pair) { g.textAlign = 'left'; g.fillText(ln.t[0], 24, y); g.textAlign = 'right'; g.fillText(ln.t[1], W - 24, y); }
    else { g.direction = ln.rtl ? 'rtl' : 'ltr'; g.textAlign = ln.center ? 'center' : 'left'; g.fillText(ln.t, ln.center ? W / 2 : 24, y); g.direction = 'ltr'; }
    y += lh;
  }
  g.restore();
  fs.writeFileSync(path.join(outDir, `${id}.png`), c.toBuffer('image/png'));
  truths.push({ id });
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({
    id, market: m.group, region: p.m === 'GULF' ? 'AE' : p.m === 'SG' ? 'SG' : p.m === 'EU' ? 'DE' : p.m === 'UK' ? 'GB' : p.m, merchant: merchantText,
    date: dateIso, currency: m.currency, subtotalMinor: subtotal, taxes, fees, discounts, totalMinor: total, items,
    traits: { devanagariOrArabicText: !!(p.deva || p.arabic), decimalComma: m.dec === ',', multiColumn: !!p.multi, lowContrastOrTilted: !!(p.low || p.tilt), longReceipt: !!p.long },
  }, null, 2) + '\n');
});
console.log(`wrote ${truths.length} receipts to ${outDir}`);
