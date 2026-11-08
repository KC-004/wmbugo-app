/** Keys on the Add sheet keypad. */
export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'decimal' | 'delete' | 'clear';

/** Most integer digits the keypad accepts; keeps every typed amount inside the safe-integer range. */
export const MAX_INTEGER_DIGITS = 12;

/**
 * Applies one key to the typed amount text ('.' is the only separator in the text; the display follows the
 * locale). A third decimal on a 2-digit currency is blocked, never rounded; a 0-exponent currency takes no
 * decimal key; leading zeros collapse ("007" is "7", "0" then "5" is "5").
 */
export function applyKey(text: string, key: KeypadKey, exponent: number): string {
  if (key === 'clear') return '';
  if (key === 'delete') return text.slice(0, -1);
  if (key === 'decimal') {
    if (exponent === 0 || text.includes('.')) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  const dot = text.indexOf('.');
  if (dot >= 0) return text.length - dot - 1 >= exponent ? text : text + key;
  if (text === '0') return key === '0' ? text : key;
  return text.length >= MAX_INTEGER_DIGITS ? text : text + key;
}

/** Maps a hardware key name (React Native's onKeyPress `key`) to a keypad key, or null. */
export function keypadKeyFromHardware(key: string): KeypadKey | null {
  if (/^[0-9]$/.test(key)) return key as KeypadKey;
  if (key === 'Backspace') return 'delete';
  if (key === '.' || key === ',') return 'decimal';
  return null;
}
