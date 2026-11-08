/**
 * GATE-07 worked examples. Each fixture is a short script of what a person recorded plus the figures the app
 * must show afterwards. The finance reviewer reads these; `finance.test.ts` runs them against the real ledger.
 * Amounts are minor units (INR and SGD have two decimals: 3000000 is 30,000.00). "Period" is November 2026.
 */
import type { AccountType } from '../../../src/ledger/accounts';

export type Step =
  | { readonly op: 'account'; readonly name: string; readonly type: AccountType; readonly opening: number | null }
  /** Sets an account's balance to a target by writing one adjustment posting for the difference (Story 2.5 adds the screen). */
  | { readonly op: 'adjust'; readonly account: string; readonly toMinor: number }
  | { readonly op: 'expense'; readonly account: string; readonly minor: number; readonly daysAgo?: number }
  | { readonly op: 'income'; readonly account: string; readonly minor: number }
  | { readonly op: 'transfer'; readonly from: string; readonly to: string; readonly minor: number; readonly fee?: number };

export interface Expected {
  /** Balance per account; null means "balance not set". For a card this is the ledger balance (negative while owed). */
  readonly balances: Readonly<Record<string, number | null>>;
  readonly inAccounts: number | null;
  readonly cardDues: number | null;
  readonly spent: number;
  readonly income: number;
  /** Entries that sit before their account's tracking start (derived on read). */
  readonly beforeTracking?: Readonly<Record<string, number>>;
}

export interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly region: 'IN' | 'SG';
  readonly steps: readonly Step[];
  readonly expected: Expected;
}

export const FIXTURES: readonly Fixture[] = [
  {
    id: 'F1',
    title: 'Bank opening ₹30,000.00, then adjusted to ₹31,200.00',
    region: 'IN',
    steps: [
      { op: 'account', name: 'HDFC', type: 'bank', opening: 3_000_000 },
      { op: 'adjust', account: 'HDFC', toMinor: 3_120_000 },
    ],
    expected: { balances: { HDFC: 3_120_000 }, inAccounts: 3_120_000, cardDues: null, spent: 0, income: 0 },
  },
  {
    id: 'F2',
    title: 'Card dues ₹8,200.00 paid from HDFC (₹50,000.00 in the bank)',
    region: 'IN',
    steps: [
      { op: 'account', name: 'HDFC', type: 'bank', opening: 5_000_000 },
      { op: 'account', name: 'Visa', type: 'card', opening: 820_000 },
      { op: 'transfer', from: 'HDFC', to: 'Visa', minor: 820_000 },
    ],
    // The card balance is 0 (nothing owed); paying a bill is a transfer, so it is not spending.
    expected: { balances: { HDFC: 4_180_000, Visa: 0 }, inAccounts: 4_180_000, cardDues: 0, spent: 0, income: 0 },
  },
  {
    id: 'F3',
    title: 'S$200.00 from DBS to Cash with a S$2.00 fee',
    region: 'SG',
    steps: [
      { op: 'account', name: 'DBS', type: 'bank', opening: 100_000 },
      { op: 'account', name: 'Cash', type: 'cash', opening: 0 },
      { op: 'transfer', from: 'DBS', to: 'Cash', minor: 20_000, fee: 200 },
    ],
    // Only the fee is spending; the S$200.00 is neither income nor expense.
    expected: { balances: { DBS: 79_800, Cash: 20_000 }, inAccounts: 99_800, cardDues: null, spent: 200, income: 0 },
  },
  {
    id: 'F4',
    title: '₹5,000.00 put into a savings pot',
    region: 'IN',
    steps: [
      { op: 'account', name: 'HDFC', type: 'bank', opening: 1_000_000 },
      { op: 'account', name: 'Holiday', type: 'savings_pot', opening: 0 },
      { op: 'transfer', from: 'HDFC', to: 'Holiday', minor: 500_000 },
    ],
    // Savings pots are asset accounts, so the total in accounts does not change.
    expected: { balances: { HDFC: 500_000, Holiday: 500_000 }, inAccounts: 1_000_000, cardDues: null, spent: 0, income: 0 },
  },
  {
    id: 'F5',
    title: 'An expense dated before the account was opened',
    region: 'IN',
    steps: [
      { op: 'account', name: 'HDFC', type: 'bank', opening: 1_000_000 },
      { op: 'expense', account: 'HDFC', minor: 30_000, daysAgo: 2 },
    ],
    // The balance ignores a posting before the opening instant; the expense still counts in Spent.
    expected: { balances: { HDFC: 1_000_000 }, inAccounts: 1_000_000, cardDues: null, spent: 30_000, income: 0, beforeTracking: { HDFC: 1 } },
  },
  {
    id: 'F6',
    title: 'Card charge, bank income and a card with no balance set',
    region: 'IN',
    steps: [
      { op: 'account', name: 'HDFC', type: 'bank', opening: 2_000_000 },
      { op: 'account', name: 'Visa', type: 'card', opening: 450_000 },
      { op: 'account', name: 'Amex', type: 'card', opening: null },
      { op: 'expense', account: 'Visa', minor: 200_000 },
      { op: 'income', account: 'HDFC', minor: 5_000_000 },
    ],
    // Dues 4,500.00 + 2,000.00 charge = 6,500.00 owed on Visa; Amex is not set and is never counted as zero.
    expected: { balances: { HDFC: 7_000_000, Visa: -650_000, Amex: null }, inAccounts: 7_000_000, cardDues: 650_000, spent: 200_000, income: 5_000_000 },
  },
];
