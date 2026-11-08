/** The decimal separator a locale writes ("." or ","). Lives outside features/ with the other formatters. */
export function decimalSeparator(locale: string): string {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.';
  } catch {
    return '.';
  }
}
