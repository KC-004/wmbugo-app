/** A count with a comma between thousands (1,284). Counts are not money, so this is plain digit grouping, not number formatting. */
export const groupDigits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
