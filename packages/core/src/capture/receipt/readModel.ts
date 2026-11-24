/** An entry's receipt lines (Story 10.4), in the order printed. Param: transaction id. */
export const RECEIPT_ITEMS_SQL =
  'SELECT i.name, i.amount_minor, i.discount_minor, i.allocated_minor, i.category_id, COALESCE(c.name, \'Uncategorised\'), i.line_index FROM receipt_item i LEFT JOIN category c ON c.id = i.category_id WHERE i.transaction_id = ? ORDER BY i.line_index, i.id';

export interface ReceiptItemView {
  readonly name: string;
  readonly amountMinor: number;
  readonly discountMinor: number;
  readonly allocatedMinor: number;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly lineIndex: number;
}

export function mapReceiptItems(rows: readonly (readonly unknown[])[]): ReceiptItemView[] {
  return rows.map((r) => ({
    name: String(r[0]),
    amountMinor: Number(r[1]),
    discountMinor: Number(r[2]),
    allocatedMinor: Number(r[3]),
    categoryId: String(r[4]),
    categoryName: String(r[5]),
    lineIndex: Number(r[6]),
  }));
}
