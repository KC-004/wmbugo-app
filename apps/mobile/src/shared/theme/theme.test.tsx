import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import * as RN from 'react-native';
const { Text } = RN;
import { colorTokens, COLOR_NAMES, resolveColor } from './colors';
import { composite, contrastRatio, parseHex } from './contrast';
import { glassFallbackReasons, GLASS_MIN_API, GLASS_MIN_RAM_MB, type DeviceCapabilities } from './glassRules';
import { radii, spacing, motion, elevation, layout } from './tokens';
import { FONT_FAMILY, MIN_FONT_SIZE, TYPE_ROLES, textStyle, type TypeRole } from './typography';
import { ThemeProvider, useTheme, type ThemeMode } from './ThemeProvider';

// The visual contract is read straight from DESIGN.md so drift in either direction fails.
const REPO = resolve(__dirname, '../../../../..');
const DESIGN = readFileSync(
  resolve(REPO, '_bmad-output/planning-artifacts/ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md'),
  'utf8',
).replace(/\r\n/g, '\n');
const FRONT = /^---\n([\s\S]*?)\n---/.exec(DESIGN)![1]!;

function section(name: string): string[] {
  const lines = FRONT.split('\n');
  const start = lines.indexOf(`${name}:`);
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break;
    out.push(l);
  }
  return out;
}

function pairs(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of section(name)) {
    const m = /^ {2}'?([A-Za-z0-9-]+)'?:\s*(?:'([^']*)'|([^\s#][^#]*?))\s*(?:#.*)?$/.exec(l);
    if (m) out[m[1]!] = (m[2] ?? m[3])!;
  }
  return out;
}

describe('colour tokens vs DESIGN.md', () => {
  const doc = pairs('colors');

  it('exposes every DESIGN.md colour with identical values, and nothing extra', () => {
    expect(Object.keys(doc).length).toBeGreaterThanOrEqual(78);
    expect(colorTokens).toEqual(doc);
  });

  it('has light and -dark values for the core, semantic, N/W/S and 12 category tokens', () => {
    const must = [
      'bg-canvas', 'bg-surface', 'bg-muted', 'text-primary', 'text-secondary', 'accent-primary',
      'semantic-income', 'semantic-expense', 'semantic-transfer', 'semantic-warning', 'semantic-info',
      'needs', 'wants', 'savings', 'focus-ring', 'border-control', 'glass-fallback', 'glass-surface', 'border-hairline',
    ];
    for (const n of must) {
      expect(doc[n]).toBeDefined();
      expect(doc[`${n}-dark`]).toBeDefined();
    }
    const cats = Object.keys(doc).filter((k) => /^cat-[a-z]+$/.test(k));
    expect(cats).toHaveLength(12);
    for (const c of cats) expect(doc[`${c}-dark`]).toBeDefined();
    for (const k of ['gradient-brand-start', 'gradient-brand-mid', 'gradient-brand-end', 'glass-tint', 'glass-border', 'on-glass-primary', 'on-glass-accent', 'focus-ring-on-glass', 'scrim']) {
      expect(doc[k]).toBeDefined();
    }
  });

  it('every value is a valid hex colour', () => {
    for (const v of Object.values(colorTokens)) expect(() => parseHex(v)).not.toThrow();
  });

  it('resolves light, dark and single-valued tokens', () => {
    expect(resolveColor('light', 'bg-canvas')).toBe('#F8FAFC');
    expect(resolveColor('dark', 'bg-canvas')).toBe('#0F172A');
    expect(resolveColor('light', 'gradient-brand-start')).toBe(resolveColor('dark', 'gradient-brand-start'));
    expect(resolveColor('dark', 'on-glass-accent')).toBe('#5EEAD4');
    expect(resolveColor('light', 'glow-start')).toBe(colorTokens['glow-start-dark']); // dark-only token
    expect(() => resolveColor('light', 'nope' as never)).toThrow();
    expect(COLOR_NAMES).toContain('bg-canvas');
    expect(COLOR_NAMES).not.toContain('bg-canvas-dark' as never);
  });

  it('dark glow alpha is capped at 45 percent and the dark glass tint is at least the 62 percent floor', () => {
    for (const k of ['glow-start-dark', 'glow-mid-dark', 'glow-end-dark'] as const) {
      expect(parseHex(colorTokens[k]).a).toBeLessThanOrEqual(0.45);
    }
    expect(parseHex(colorTokens['glass-surface-dark']).a).toBeGreaterThanOrEqual(0.62);
    expect(parseHex(colorTokens['glass-surface']).a).toBeCloseTo(0.8, 1);
    expect(parseHex(colorTokens['glass-border']).a).toBeCloseTo(0.22, 1);
  });
});

describe('contrast', () => {
  const c = colorTokens;
  const text = (fg: string, bg: string, claimed: number) => {
    const r = contrastRatio(fg, bg);
    expect(r).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(r - claimed)).toBeLessThan(0.02);
  };

  it('matches the ratios DESIGN.md claims for the listed text pairs (>= 4.5:1)', () => {
    text(c['text-primary'], c['bg-canvas'], 17.06);
    text(c['text-secondary'], c['bg-surface'], 7.58);
    text(c['text-secondary-dark'], c['bg-surface-dark'], 9.85);
    text(c['accent-primary'], '#FFFFFF', 5.47);
    text(c['accent-primary-dark'], c['bg-surface-dark'], 9.89);
    text(c['semantic-income'], '#FFFFFF', 5.02);
    text(c['semantic-expense'], '#FFFFFF', 6.47);
    text(c['semantic-expense-dark'], c['bg-surface-dark'], 7.74);
    text(c['semantic-warning'], '#FFFFFF', 5.02);
    text('#FFFFFF', c['glass-fallback'], 8.23);
    text(c['on-glass-primary'], c['glass-fallback-dark'], 11.13);
    text(c['on-glass-secondary-dark'], c['glass-fallback-dark'], 7.84);
  });

  it('meets 3:1 for non-text boundaries and focus rings', () => {
    expect(contrastRatio(c['border-control'], '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c['border-control-dark'], c['bg-surface-dark'])).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c['focus-ring'], c['bg-canvas'])).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c['focus-ring-dark'], c['bg-canvas-dark'])).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c['focus-ring-on-glass'], c['glass-fallback'])).toBeGreaterThanOrEqual(3);
  });

  it('every text-bearing token pair used on screens passes in both schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const canvas = resolveColor(scheme, 'bg-canvas');
      const surface = resolveColor(scheme, 'bg-surface');
      for (const fg of ['text-primary', 'text-secondary', 'accent-primary'] as const) {
        for (const bg of [canvas, surface]) expect(contrastRatio(resolveColor(scheme, fg), bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('composites translucent colours over a backdrop and parses short hex', () => {
    const over = composite(parseHex('#00000080'), parseHex('#FFFFFF'));
    expect(over.r).toBe(127);
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(() => parseHex('nope')).toThrow();
  });
});

describe('spacing, radii, motion, elevation', () => {
  it('matches the 4pt scale and radii in DESIGN.md', () => {
    const sp = pairs('spacing');
    for (const [k, v] of Object.entries(sp)) expect(spacing[k as keyof typeof spacing]).toBe(Number(v.replace('dp', '')));
    expect(Object.keys(spacing).length).toBe(Object.keys(sp).length);
    const rd = pairs('rounded');
    for (const [k, v] of Object.entries(rd)) expect(radii[k as keyof typeof radii]).toBe(Number(v.replace('dp', '')));
    expect([radii.sm, radii.md, radii.lg]).toEqual([8, 12, 16]);
    expect([4, 8, 12, 16, 20, 24, 32, 40, 48]).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12].map((k) => spacing[String(k) as keyof typeof spacing]));
  });

  it('keeps motion within 150-250 ms (none when reduced) and the only shadow on the add button', () => {
    for (const d of [motion.fast, motion.standard, motion.slow]) {
      expect(d).toBeGreaterThanOrEqual(150);
      expect(d).toBeLessThanOrEqual(250);
    }
    expect(motion.reduced).toBe(0);
    expect(elevation.none).toEqual({});
    expect(Object.keys(elevation)).toEqual(['none', 'addButton']);
    expect(layout.touchMin).toBe(48);
    expect(layout.railBreakpoint).toBe(600);
  });
});

describe('typography', () => {
  const doc = pairs('typography');
  // The typography section is nested, so read each role's size/weight/line from the raw front matter.
  const raw = section('typography').join('\n');
  const role = (name: string) => {
    const block = new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n?)+)`, 'm').exec(raw + '\n')![1]!;
    const get = (k: string) => new RegExp(`${k}:\\s*'?([^'\\n]+)'?`).exec(block)![1]!;
    return { size: Number(get('fontSize').replace('sp', '')), line: Number(get('lineHeight').replace('sp', '')), weight: get('fontWeight') };
  };

  it('has the 11 roles with the DESIGN.md sizes, line heights and weights', () => {
    expect(Object.keys(TYPE_ROLES)).toHaveLength(11);
    for (const name of Object.keys(TYPE_ROLES) as TypeRole[]) {
      const d = role(name);
      expect([name, TYPE_ROLES[name].size, TYPE_ROLES[name].line, TYPE_ROLES[name].weight]).toEqual([name, d.size, d.line, d.weight]);
    }
    expect(doc).toBeDefined();
  });

  it('uses only Inter 400/500/600 and never goes below the 12sp floor', () => {
    expect(Object.keys(FONT_FAMILY)).toEqual(['400', '500', '600']);
    for (const r of Object.values(TYPE_ROLES)) expect(r.size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  it('applies tabular figures on every money role', () => {
    for (const r of ['display-amount', 'headline', 'amount', 'keypad', 'caption'] as TypeRole[]) {
      expect(textStyle(r).fontVariant).toEqual(['tabular-nums']);
    }
    expect(textStyle('body').fontVariant).toBeUndefined();
    expect(textStyle('display-amount').letterSpacing).toBe(-0.5);
    expect(TYPE_ROLES['display-amount'].maxFontSizeMultiplier).toBe(1.5);
  });

  it('bundles the Inter font files in the Android assets, with the OFL licence', () => {
    const dir = resolve(__dirname, '../../../android/app/src/main/assets/fonts');
    for (const f of ['Inter_400Regular.ttf', 'Inter_500Medium.ttf', 'Inter_600SemiBold.ttf', 'OFL.txt']) {
      expect(existsSync(resolve(dir, f))).toBe(true);
      expect(statSync(resolve(dir, f)).size).toBeGreaterThan(1000);
    }
    for (const family of Object.values(FONT_FAMILY)) expect(existsSync(resolve(dir, `${family}.ttf`))).toBe(true);
  });
});

describe('glass fallback rules', () => {
  const good: DeviceCapabilities = { apiLevel: 33, totalRamMb: 5400, batterySaver: false, animatorScale: 1, reduceTransparency: false };

  it('uses glass on a capable device', () => {
    expect(glassFallbackReasons(good)).toEqual([]);
  });

  it.each<[string, Partial<DeviceCapabilities>, string]>([
    ['API below 31', { apiLevel: GLASS_MIN_API - 1 }, 'api-level'],
    ['reported RAM below the S8 threshold', { totalRamMb: GLASS_MIN_RAM_MB - 1 }, 'low-memory'],
    ['battery saver on', { batterySaver: true }, 'battery-saver'],
    ['animator scale 0', { animatorScale: 0 }, 'animator-scale-zero'],
    ['reduce transparency on', { reduceTransparency: true }, 'reduce-transparency'],
  ])('falls back for %s', (_n, patch, reason) => {
    expect(glassFallbackReasons({ ...good, ...patch })).toEqual([reason]);
  });

  it('falls back over photo imagery and collects several reasons', () => {
    expect(glassFallbackReasons(good, { overImagery: true })).toEqual(['over-imagery']);
    expect(glassFallbackReasons({ ...good, apiLevel: 28, batterySaver: true })).toEqual(['api-level', 'battery-saver']);
  });

  it('keeps marketed-4 GB phones on glass, sends 3 GB phones to the fallback, ignores unknown RAM and slow (non-zero) animation', () => {
    expect(glassFallbackReasons({ ...good, totalRamMb: 3700 })).toEqual([]);
    expect(glassFallbackReasons({ ...good, totalRamMb: 2800 })).toEqual(['low-memory']);
    expect(glassFallbackReasons({ ...good, totalRamMb: null })).toEqual([]);
    expect(glassFallbackReasons({ ...good, animatorScale: 0.5 })).toEqual([]);
  });

  it('the reference devices fall on the documented sides', () => {
    expect(glassFallbackReasons({ apiLevel: 33, totalRamMb: 5437, batterySaver: false, animatorScale: 1, reduceTransparency: false })).toEqual([]);
    expect(glassFallbackReasons({ apiLevel: 28, totalRamMb: 1990, batterySaver: false, animatorScale: 1, reduceTransparency: false }).length).toBeGreaterThan(0);
  });
});

describe('ThemeProvider', () => {
  let osScheme: 'light' | 'dark' = 'light';
  beforeEach(() => {
    osScheme = 'light';
    jest.spyOn(RN, 'useColorScheme').mockImplementation(() => osScheme);
  });
  afterEach(() => jest.restoreAllMocks());

  function Probe({ onTheme }: { onTheme: (t: ReturnType<typeof useTheme>) => void }) {
    const t = useTheme();
    onTheme(t);
    return <Text>{t.scheme}</Text>;
  }

  function mount(initialMode: ThemeMode) {
    let latest!: ReturnType<typeof useTheme>;
    let r!: ReactTestRenderer;
    const tree = () => (
      <ThemeProvider initialMode={initialMode}>
        <Probe onTheme={(t) => (latest = t)} />
      </ThemeProvider>
    );
    act(() => {
      r = create(tree());
    });
    return { get: () => latest, rerender: () => act(() => r.update(tree())) };
  }

  it('System follows the OS setting live, without a restart', () => {
    const m = mount('system');
    expect(m.get().scheme).toBe('light');
    osScheme = 'dark';
    m.rerender();
    expect(m.get().scheme).toBe('dark');
    expect(m.get().color('bg-canvas')).toBe('#0F172A');
  });

  it('Light and Dark ignore the OS; switching re-renders immediately', () => {
    const m = mount('light');
    osScheme = 'dark';
    m.rerender();
    expect(m.get().scheme).toBe('light');
    act(() => m.get().setMode('dark'));
    expect(m.get().scheme).toBe('dark');
    expect(m.get().mode).toBe('dark');
    act(() => m.get().setMode('system'));
    expect(m.get().scheme).toBe('dark'); // OS is dark
  });

  it('reports mode changes and offers no accent option', () => {
    const seen: ThemeMode[] = [];
    let latest!: ReturnType<typeof useTheme>;
    act(() => {
      create(
        <ThemeProvider onModeChange={(m) => seen.push(m)}>
          <Probe onTheme={(t) => (latest = t)} />
        </ThemeProvider>,
      );
    });
    act(() => latest.setMode('dark'));
    expect(seen).toEqual(['dark']);
    expect(Object.keys(latest).sort()).toEqual(['color', 'mode', 'scheme', 'setMode']);
  });

  it('useTheme outside a provider is an error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => act(() => void create(<Probe onTheme={() => undefined} />))).toThrow('ThemeProvider');
    spy.mockRestore();
  });
});

describe('brand assets', () => {
  it('ships a valid placeholder coin-flip Lottie', () => {
    const json = JSON.parse(readFileSync(resolve(__dirname, '../brand/coin-flip.json'), 'utf8'));
    expect(json.layers.length).toBeGreaterThan(0);
    expect(json.op).toBeGreaterThan(json.ip);
    expect(json.w).toBe(json.h);
  });
});
