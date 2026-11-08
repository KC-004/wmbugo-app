import type { TextStyle } from 'react-native';

/**
 * The 11 DESIGN.md type roles. Inter is bundled with the app (works offline):
 * Regular 400, Medium 500, SemiBold 600 only. Sizes are sp, so system font
 * scale applies. Every role that renders money uses tabular figures.
 */
export const FONT_FAMILY = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
} as const;

export type TypeRole =
  | 'display-amount'
  | 'headline'
  | 'title'
  | 'title-sm'
  | 'body'
  | 'body-medium'
  | 'amount'
  | 'keypad'
  | 'label'
  | 'caption'
  | 'tag';

interface RoleSpec {
  readonly size: number;
  readonly line: number;
  readonly weight: '400' | '500' | '600';
  readonly tnum?: true;
  readonly letterSpacing?: number;
  /** Roles that cap system font scaling (DESIGN.md Typography). */
  readonly maxFontSizeMultiplier?: number;
}

export const TYPE_ROLES: Readonly<Record<TypeRole, RoleSpec>> = {
  'display-amount': { size: 40, line: 48, weight: '600', tnum: true, letterSpacing: -0.5, maxFontSizeMultiplier: 1.5 },
  headline: { size: 28, line: 34, weight: '600', tnum: true, maxFontSizeMultiplier: 1.5 },
  title: { size: 20, line: 26, weight: '600' },
  'title-sm': { size: 17, line: 24, weight: '500' },
  body: { size: 16, line: 24, weight: '400' },
  'body-medium': { size: 16, line: 24, weight: '500' },
  amount: { size: 16, line: 24, weight: '600', tnum: true },
  keypad: { size: 28, line: 34, weight: '500', tnum: true, maxFontSizeMultiplier: 1.5 },
  label: { size: 14, line: 20, weight: '500' },
  caption: { size: 13, line: 18, weight: '400', tnum: true },
  tag: { size: 12, line: 16, weight: '500' },
};

/** Smallest text size anywhere in the app (the `tag` floor). */
export const MIN_FONT_SIZE = 12;

export function textStyle(role: TypeRole): TextStyle {
  const s = TYPE_ROLES[role];
  return {
    fontFamily: FONT_FAMILY[s.weight],
    fontSize: s.size,
    lineHeight: s.line,
    ...(s.letterSpacing !== undefined ? { letterSpacing: s.letterSpacing } : {}),
    ...(s.tnum ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : {}),
  };
}

export function maxFontScale(role: TypeRole): number | undefined {
  return TYPE_ROLES[role].maxFontSizeMultiplier;
}
