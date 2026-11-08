import { colorTokens } from './designTokens.generated';

export type ColorScheme = 'light' | 'dark';

type TokenKey = keyof typeof colorTokens;
type BaseOf<K> = K extends `${infer B}-dark` ? B : K;

/** Every DESIGN.md colour, by its light name (the `-dark` value is chosen by the scheme). */
export type ColorName = BaseOf<TokenKey>;

/**
 * Resolves a colour for a scheme. Tokens with no `-dark` twin (gradient stops,
 * glass tint and border, on-glass inks, scrim) are the same in both schemes;
 * tokens that exist only as `-dark` (the glows) return that value.
 */
export function resolveColor(scheme: ColorScheme, name: ColorName): string {
  const tokens = colorTokens as Record<string, string>;
  const dark = tokens[`${name}-dark`];
  const light = tokens[name];
  const value = scheme === 'dark' ? (dark ?? light) : (light ?? dark);
  if (value === undefined) throw new Error(`unknown colour token ${name}`);
  return value;
}

export const COLOR_NAMES = [...new Set(Object.keys(colorTokens).map((k) => k.replace(/-dark$/, '')))] as ColorName[];

export { colorTokens };
