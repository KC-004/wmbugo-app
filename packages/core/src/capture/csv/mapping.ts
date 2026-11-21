import { detectNumberStyle, type NumberStyle } from './amount';
import { detectDateFormat, type DateFormat, parseCsvDate } from './date';
import { parseCsvAmount } from './amount';

/**
 * Which column is which (Story 9.2, IMP-002). `guessMapping` reads the headings (case, accent and punctuation do not matter) and, when
 * there are none, the shape of the values. Every guess is a proposal: any role can be reassigned or cleared by the caller.
 */
export type CsvRole = 'date' | 'time' | 'description' | 'merchant' | 'amount' | 'debit' | 'credit' | 'currency' | 'reference' | 'balance' | 'category' | 'account';
export const CSV_ROLES: readonly CsvRole[] = ['date', 'time', 'description', 'merchant', 'amount', 'debit', 'credit', 'currency', 'reference', 'balance', 'category', 'account'];

export interface CsvMapping {
  /** Role to the 0-based index of the column that holds it. A role that is absent is not used. */
  readonly columns: Readonly<Partial<Record<CsvRole, number>>>;
  /** Treat positive amounts as money out (a card statement that lists charges as positive). Default off. */
  readonly flipSign: boolean;
  /** Null while the order is ambiguous or no column holds dates. */
  readonly dateFormat: DateFormat | null;
  /** Both readings when the day/month order cannot be told from the values; the person is asked. */
  readonly dateCandidates: readonly DateFormat[];
  readonly numberStyle: NumberStyle;
  /** 0 to 1 per role: how sure the guess is (a heading match is high, a value shape is lower). */
  readonly confidence: Readonly<Partial<Record<CsvRole, number>>>;
}

/** Heading patterns per role, tried in this order so the most specific roles claim their columns first. */
const HEADINGS: readonly [CsvRole, RegExp][] = [
  ['date', /^(?:transaction |booking |posting |trans |value |processed |post )?date$|^buchungstag$|^datum$|^dato$|^fecha$|^data$|^date of transaction$|^transaction date$/],
  ['time', /^(?:transaction |booking )?time$|^uhrzeit$|^hora$/],
  ['debit', /^(?:paid out|money out|debit|debits|debit amount|withdrawal|withdrawals|out|outgoing|soll|spent|charges?)$/],
  ['credit', /^(?:paid in|money in|credit|credits|credit amount|deposit|deposits|in|incoming|haben|received|payments?)$/],
  ['amount', /^(?:amount|betrag|value|transaction amount|amount \(.*\)|montant|importe|sum)$/],
  ['balance', /^(?:balance|saldo|running balance|closing balance|account balance|available balance)$/],
  ['reference', /^(?:reference|ref|referenz|transaction id|transaction reference|txn id|txn ref|reference number|ref no|id|bank reference)$/],
  ['currency', /^(?:currency|w[aä]hrung|curr|ccy|currency code)$/],
  ['category', /^(?:category|kategorie|categorie|categoria)$/],
  ['account', /^(?:account|account name|konto|card|card name|account holder|account no)$/],
  ['merchant', /^(?:merchant|payee|counterparty|vendor|auftraggeber|beg[uü]nstigter|empf[aä]nger|merchant name|paid to)$/],
  ['description', /^(?:description|transaction description|details|detail|narrative|memo|buchungstext|verwendungszweck|name|particulars|text|notes?|payment details|transaction details)$/],
];

/** The combining accents NFD leaves behind, built from code points so no invisible character sits in the source. */
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** A heading reduced to lowercase letters, digits and single spaces, accents removed. */
export function normalizeHeading(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9()]+/g, ' ')
    .trim();
}

const column = (rows: readonly (readonly string[])[], i: number): string[] => rows.map((r) => r[i] ?? '');

/**
 * Proposes a mapping from the heading cells and a few sample rows. Roles are assigned in order of how specific they are, each column
 * to at most one role and each role to at most one column. Without a recognisable heading the values decide: a column of dates is
 * the date, a column of amounts the amount, and the longest text column the description.
 */
export function guessMapping(header: readonly string[], sampleRows: readonly (readonly string[])[]): CsvMapping {
  const columns: Partial<Record<CsvRole, number>> = {};
  const confidence: Partial<Record<CsvRole, number>> = {};
  const taken = new Set<number>();
  const headings = header.map(normalizeHeading);
  const width = Math.max(header.length, ...sampleRows.map((r) => r.length), 0);

  for (const [role, pattern] of HEADINGS) {
    const i = headings.findIndex((h, idx) => !taken.has(idx) && pattern.test(h));
    if (i !== -1) {
      columns[role] = i;
      confidence[role] = 0.9;
      taken.add(i);
    }
  }

  // Values decide for what the headings did not name.
  const free = Array.from({ length: width }, (_, i) => i).filter((i) => !taken.has(i));
  if (columns.date === undefined) {
    const i = free.find((c) => detectDateFormat(column(sampleRows, c)).kind !== 'none');
    if (i !== undefined) {
      columns.date = i;
      confidence.date = 0.6;
      taken.add(i);
    }
  }
  const stillFree = () => free.filter((c) => !taken.has(c));
  if (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined) {
    const i = stillFree().find((c) => {
      const values = column(sampleRows, c).filter((v) => v.trim() !== '');
      if (values.length === 0) return false;
      const style = detectNumberStyle(values).style;
      return values.every((v) => parseCsvAmount(v, style).ok);
    });
    if (i !== undefined) {
      columns.amount = i;
      confidence.amount = 0.5;
      taken.add(i);
    }
  }
  if (columns.description === undefined) {
    let best = -1;
    let bestLen = 0;
    for (const c of stillFree()) {
      const values = column(sampleRows, c).filter((v) => v.trim() !== '');
      if (values.length === 0 || detectDateFormat(values).kind !== 'none') continue;
      const style = detectNumberStyle(values).style;
      if (values.every((v) => parseCsvAmount(v, style).ok)) continue;
      const mean = values.reduce((n, v) => n + v.length, 0) / values.length;
      if (mean > bestLen) {
        bestLen = mean;
        best = c;
      }
    }
    if (best !== -1) {
      columns.description = best;
      confidence.description = 0.4;
    }
  }

  const dateValues = columns.date === undefined ? [] : column(sampleRows, columns.date).map((v) => v.trim());
  const dateDetection = detectDateFormat(dateValues);
  const numberRoles = [columns.amount, columns.debit, columns.credit, columns.balance].filter((i): i is number => i !== undefined);
  const numberValues = numberRoles.flatMap((i) => column(sampleRows, i).filter((v) => v.trim() !== ''));
  return {
    columns,
    flipSign: false,
    dateFormat: dateDetection.kind === 'detected' ? dateDetection.format : null,
    dateCandidates: dateDetection.kind === 'ambiguous' ? dateDetection.candidates : dateDetection.kind === 'detected' ? [dateDetection.format] : [],
    numberStyle: detectNumberStyle(numberValues).style,
    confidence,
  };
}

/** What is still missing before the mapping can be used: the roles that must be set and the date order, if it is unknown. */
export type MappingProblem = 'date' | 'description' | 'amount' | 'dateFormat';

export function mappingProblems(mapping: CsvMapping): MappingProblem[] {
  const out: MappingProblem[] = [];
  const c = mapping.columns;
  if (c.date === undefined) out.push('date');
  if (c.description === undefined && c.merchant === undefined) out.push('description');
  if (c.amount === undefined && (c.debit === undefined || c.credit === undefined)) out.push('amount');
  if (c.date !== undefined && mapping.dateFormat === null) out.push('dateFormat');
  return out;
}

/** Reassigns or clears one role (`null` clears it); the column is taken from any other role that held it. Pure. */
export function withRole(mapping: CsvMapping, role: CsvRole, columnIndex: number | null): CsvMapping {
  const columns: Partial<Record<CsvRole, number>> = {};
  const confidence: Partial<Record<CsvRole, number>> = {};
  for (const r of CSV_ROLES) {
    const i = mapping.columns[r];
    if (i === undefined || r === role || i === columnIndex) continue;
    columns[r] = i;
    const conf = mapping.confidence[r];
    if (conf !== undefined) confidence[r] = conf;
  }
  if (columnIndex !== null) {
    columns[role] = columnIndex;
    confidence[role] = 1;
  }
  return { ...mapping, columns, confidence };
}

/** Re-derives the date format and number style for a changed mapping from the sample rows (the caller keeps `flipSign`). */
export function refreshFormats(mapping: CsvMapping, sampleRows: readonly (readonly string[])[]): CsvMapping {
  const dateValues = mapping.columns.date === undefined ? [] : column(sampleRows, mapping.columns.date);
  const d = detectDateFormat(dateValues);
  const numberRoles = [mapping.columns.amount, mapping.columns.debit, mapping.columns.credit, mapping.columns.balance].filter((i): i is number => i !== undefined);
  const numberValues = numberRoles.flatMap((i) => column(sampleRows, i).filter((v) => v.trim() !== ''));
  return {
    ...mapping,
    dateFormat: d.kind === 'detected' ? d.format : null,
    dateCandidates: d.kind === 'ambiguous' ? d.candidates : d.kind === 'detected' ? [d.format] : [],
    numberStyle: detectNumberStyle(numberValues).style,
  };
}

/** A date cell parses in the mapping's format (used to say that a chosen format fits the file). */
export const dateFits = (value: string, format: DateFormat): boolean => parseCsvDate(value, format, 'UTC').ok;
