/** 820000 minor at exponent 2 reads "8200"; 820050 reads "8200.5". The text a person would type for that amount. */
export function minorToInput(minor: number | null, exponent: number): string {
  if (minor === null) return '';
  const unit = 10 ** exponent;
  const whole = Math.trunc(minor / unit);
  const frac = String(minor % unit).padStart(exponent, '0').replace(/0+$/, '');
  return frac === '' ? String(whole) : `${whole}.${frac}`;
}
