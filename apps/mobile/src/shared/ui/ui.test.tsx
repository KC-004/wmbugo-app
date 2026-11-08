import { StyleSheet, Text } from 'react-native';
import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { House } from 'phosphor-react-native';
import { colorTokens } from '../theme/colors';
import { contrastRatio } from '../theme/contrast';
import { ThemeProvider, type ThemeMode } from '../theme/ThemeProvider';
import { Amount } from './Amount';
import { Button } from './Button';
import { Chip } from './Chip';
import { FocusRing } from './FocusRing';

function mount(node: ReactNode, mode: ThemeMode = 'light'): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<ThemeProvider initialMode={mode}>{node}</ThemeProvider>);
  });
  return r;
}

const text = (r: ReactTestRenderer): string[] =>
  r.root.findAll((n) => n.type === Text && typeof n.props.children === 'string').map((n) => n.props.children as string);

const flat = (n: ReactTestInstance) => StyleSheet.flatten(n.props.style) ?? {};

/** Hit-rect audit: every accessible pressable must be at least 48dp tall and wide. */
export function auditHitRects(r: ReactTestRenderer): string[] {
  const failures: string[] = [];
  const host = (x: ReactTestInstance) => typeof x.type === 'string' && x.props.accessible === true && x.props.accessibilityRole !== undefined;
  for (const n of r.root.findAll(host)) {
    const s = flat(n);
    const h = Number(s.minHeight ?? s.height ?? 0);
    const w = Number(s.minWidth ?? s.width ?? 0);
    if (h < 48 || w < 48) failures.push(`${n.props.accessibilityLabel}: ${w}x${h}`);
  }
  return failures;
}

describe('Amount', () => {
  it('renders expenses unsigned and income with +', () => {
    expect(text(mount(<Amount amountMinor={42000} currency="INR" direction="expense" />))).toEqual(['₹420.00']);
    expect(text(mount(<Amount amountMinor={8500000} currency="INR" direction="income" />))).toEqual(['+₹85,000.00']);
    expect(text(mount(<Amount amountMinor={500000} currency="INR" direction="neutral" />))).toEqual(['₹5,000.00']);
  });

  it('never prints a minus sign, whatever the input', () => {
    for (const d of ['expense', 'income', 'neutral'] as const) {
      expect(text(mount(<Amount amountMinor={-123456} currency="INR" direction={d} />))[0]).not.toMatch(/[-−]/);
    }
  });

  it('shows the 9-digit en-IN amount whole', () => {
    expect(text(mount(<Amount amountMinor={1186000000} currency="INR" direction="expense" />))).toEqual(['₹1,18,60,000.00']);
  });

  it('big roles cap font scale at 1.5, auto-fit to a floor and stay on one line', () => {
    const d = mount(<Amount amountMinor={1186000000} currency="INR" direction="expense" role="display-amount" />).root.findByType(Text);
    expect(d.props.maxFontSizeMultiplier).toBe(1.5);
    expect(d.props.adjustsFontSizeToFit).toBe(true);
    expect(d.props.minimumFontScale).toBeCloseTo(28 / 40, 5);
    expect(d.props.numberOfLines).toBe(1);
    expect(d.props.ellipsizeMode).toBe('clip');
    const h = mount(<Amount amountMinor={1186000000} currency="INR" direction="expense" role="headline" />).root.findByType(Text);
    expect(h.props.minimumFontScale).toBeCloseTo(22 / 28, 5);
    const k = mount(<Amount amountMinor={5} currency="INR" direction="expense" role="keypad" />).root.findByType(Text);
    expect(k.props.maxFontSizeMultiplier).toBe(1.5);
  });

  it('row amounts scale fully and are never truncated or shrunk', () => {
    const a = mount(<Amount amountMinor={1186000000} currency="INR" direction="expense" />).root.findByType(Text);
    expect(a.props.numberOfLines).toBeUndefined();
    expect(a.props.adjustsFontSizeToFit).toBe(false);
    expect(a.props.maxFontSizeMultiplier).toBeUndefined();
    expect(flat(a).flexShrink).toBe(0);
    expect(flat(a).fontVariant).toEqual(['tabular-nums']);
  });

  it('hidden amounts show the symbol plus four dots and leak neither value nor size', () => {
    const small = text(mount(<Amount amountMinor={5} currency="INR" direction="expense" hidden />))[0];
    const big = text(mount(<Amount amountMinor={1186000000} currency="INR" direction="expense" hidden />))[0];
    const income = text(mount(<Amount amountMinor={1186000000} currency="INR" direction="income" hidden />))[0];
    expect(small).toBe('₹ ••••');
    expect(big).toBe(small); // the value and its size never show
    expect(income).toBe('+₹ ••••'); // the + sign stays, per DESIGN.md (labels, signs, icons stay)
    const de = text(mount(<Amount amountMinor={5} currency="EUR" direction="expense" hidden locale="de-DE" />))[0]!;
    expect(de.split(String.fromCharCode(160)).join(' ')).toBe('•••• €');
  });

  it('reads the full label to TalkBack, "about" for rough figures, and shows a leading tilde', () => {
    const inc = mount(<Amount amountMinor={8500000} currency="INR" direction="income" />).root.findByType(Text);
    expect(inc.props.accessibilityLabel).toBe('Income, plus 85,000 rupees');
    const spent = mount(<Amount amountMinor={42000} currency="INR" direction="expense" />).root.findByType(Text);
    expect(spent.props.accessibilityLabel).toBe('Spent 420 rupees');
    const rough = mount(<Amount amountMinor={98800} currency="INR" direction="neutral" approximate />);
    expect(text(rough)).toEqual(['~₹988.00']);
    expect(rough.root.findByType(Text).props.accessibilityLabel).toBe('About 988 rupees');
    const hidden = mount(<Amount amountMinor={8500000} currency="INR" direction="income" hidden />).root.findByType(Text);
    expect(hidden.props.accessibilityLabel).toBe('Income, amount hidden');
  });

  it('every Phase 1 currency renders without a minus or an empty string', () => {
    for (const code of ['INR', 'USD', 'EUR', 'BHD', 'IDR', 'HUF', 'VND', 'SGD', 'CHF'] as const) {
      const t = text(mount(<Amount amountMinor={123456789} currency={code} direction="expense" />))[0]!;
      expect(t.length).toBeGreaterThan(3);
      expect(t).not.toMatch(/[-−]/);
    }
  });
});

describe('Button', () => {
  const press = jest.fn();
  beforeEach(() => press.mockClear());
  const find = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessible === true)[0]!;

  it.each(['primary', 'secondary', 'secondary-on-footer', 'text'] as const)('%s is at least 48dp and presses', (variant) => {
    const r = mount(<Button label="Save" variant={variant} onPress={press} />);
    const b = find(r);
    expect(Number(flat(b).minHeight)).toBeGreaterThanOrEqual(48);
    expect(Number(flat(b).minWidth)).toBeGreaterThanOrEqual(48);
    act(() => b.props.onPress());
    expect(press).toHaveBeenCalledTimes(1);
    expect(auditHitRects(r)).toEqual([]);
  });

  it('the disabled primary stays focusable, announces disabled plus the reason, and does not fire', () => {
    const r = mount(<Button label="Save" disabledReason="Enter an amount first" onPress={press} />);
    const b = find(r);
    expect(b.props.accessible).toBe(true);
    expect(b.props.accessibilityState).toEqual({ disabled: true });
    expect(b.props.accessibilityHint).toBe('Enter an amount first');
    expect(b.props.onPress).toBeUndefined();
    expect(flat(b).backgroundColor).toBe(colorTokens['bg-muted']);
    expect(Number(flat(b).minHeight)).toBeGreaterThanOrEqual(48);
  });

  it('only the enabled primary draws the brand gradient', () => {
    const on = mount(<Button label="Save" onPress={press} />);
    const off = mount(<Button label="Save" disabledReason="why" onPress={press} />);
    const hasGradient = (r: ReactTestRenderer) => JSON.stringify(r.toJSON()).includes('brandDeep');
    expect(hasGradient(on)).toBe(true);
    expect(hasGradient(off)).toBe(false);
    expect(hasGradient(mount(<Button label="Save" variant="secondary" onPress={press} />))).toBe(false);
  });

  it('shows a focus ring when focused (on glass for the footer button)', () => {
    const r = mount(<Button label="Reject" variant="secondary-on-footer" onPress={press} />);
    const ring = () => flat(r.root.findAll((n) => n.props.style && flat(n).borderWidth === 2)[0]!).borderColor;
    expect(ring()).toBe('transparent');
    act(() => find(r).props.onFocus());
    expect(ring()).toBe(colorTokens['focus-ring-on-glass']);
    act(() => find(r).props.onBlur());
    expect(ring()).toBe('transparent');
  });

  describe('contrast per variant (>= 4.5:1 text, both schemes)', () => {
    const white = colorTokens['bg-surface'];
    it('primary: white on the whole deep gradient segment', () => {
      expect(contrastRatio(white, colorTokens['gradient-brand-mid'])).toBeGreaterThanOrEqual(5.47 - 0.02);
      expect(contrastRatio(white, colorTokens['gradient-brand-end'])).toBeGreaterThanOrEqual(9.11 - 0.02);
    });
    it('disabled: text-secondary on bg-muted', () => {
      expect(contrastRatio(colorTokens['text-secondary'], colorTokens['bg-muted'])).toBeGreaterThanOrEqual(6.1);
      expect(contrastRatio(colorTokens['text-secondary-dark'], colorTokens['bg-muted-dark'])).toBeGreaterThanOrEqual(6.9);
    });
    it('secondary: accent on canvas and surface', () => {
      expect(contrastRatio(colorTokens['accent-primary'], colorTokens['bg-canvas'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colorTokens['accent-primary-dark'], colorTokens['bg-canvas-dark'])).toBeGreaterThanOrEqual(4.5);
    });
    it('secondary-on-footer: on-glass ink on the solid fallback', () => {
      expect(contrastRatio(colorTokens['on-glass-primary'], colorTokens['glass-fallback'])).toBeGreaterThanOrEqual(7.8);
      expect(contrastRatio(colorTokens['accent-primary-dark'], colorTokens['glass-fallback-dark'])).toBeGreaterThanOrEqual(7.8);
    });
    it('text: accent on canvas, on-glass ink on glass', () => {
      expect(contrastRatio(colorTokens['on-glass-primary'], colorTokens['glass-fallback'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colorTokens['accent-primary'], colorTokens['bg-surface'])).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe('Chip', () => {
  const press = jest.fn();
  const pressable = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.accessible === true && n.props.accessibilityRole === 'button')[0]!;

  it('has a 48dp hit area around a 32dp visual', () => {
    const r = mount(<Chip label="Food" onPress={press} />);
    expect(Number(flat(pressable(r)).minHeight)).toBeGreaterThanOrEqual(48);
    expect(Number(flat(pressable(r)).minWidth)).toBeGreaterThanOrEqual(48);
    const visual = r.root.findAll((n) => flat(n).minHeight === 32)[0]!;
    expect(flat(visual).borderRadius).toBeGreaterThan(100);
    expect(auditHitRects(r)).toEqual([]);
  });

  it('unselected has a 1px border-control outline; selected is an accent fill with a filled icon and selected state', () => {
    const off = mount(<Chip label="Food" icon={House} onPress={press} />);
    const on = mount(<Chip label="Food" icon={House} selected onPress={press} />);
    const visual = (r: ReactTestRenderer) => r.root.findAll((n) => flat(n).minHeight === 32)[0]!;
    expect(flat(visual(off))).toMatchObject({ borderWidth: 1, borderColor: colorTokens['border-control'] });
    expect(flat(visual(on)).backgroundColor).toBe(colorTokens['accent-primary']);
    expect(pressable(off).props.accessibilityState).toEqual({ selected: false });
    expect(pressable(on).props.accessibilityState).toEqual({ selected: true });
    const weight = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.weight !== undefined)[0]!.props.weight;
    expect(weight(off)).toBe('regular');
    expect(weight(on)).toBe('fill');
  });

  it('greyscale keeps the meaning: selected differs by state and icon weight, not by colour alone', () => {
    const grey = (hex: string): number => {
      const v = parseInt(hex.slice(1, 7), 16);
      return Math.round(0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255));
    };
    const off = mount(<Chip label="Food" icon={House} onPress={press} />);
    const on = mount(<Chip label="Food" icon={House} selected onPress={press} />);
    const cues = [
      pressable(off).props.accessibilityState.selected !== pressable(on).props.accessibilityState.selected,
      off.root.findAll((n) => n.props.weight !== undefined)[0]!.props.weight !== on.root.findAll((n) => n.props.weight !== undefined)[0]!.props.weight,
      Math.abs(grey(colorTokens['accent-primary']) - grey(colorTokens['bg-surface'])) > 40,
    ];
    expect(cues.every(Boolean)).toBe(true);
  });

  it('selected ink passes contrast on the accent fill in both schemes', () => {
    expect(contrastRatio(colorTokens['bg-surface'], colorTokens['accent-primary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colorTokens['bg-canvas-dark'], colorTokens['accent-primary-dark'])).toBeGreaterThanOrEqual(4.5);
    const dark = mount(<Chip label="Food" selected onPress={press} />, 'dark');
    expect(flat(dark.root.findByType(Text)).color).toBe(colorTokens['bg-canvas-dark']);
    const light = mount(<Chip label="Food" selected onPress={press} />, 'light');
    expect(flat(light.root.findByType(Text)).color).toBe(colorTokens['bg-surface']);
  });

  it('Paid with and Paid from chips speak their prefix', () => {
    expect(pressable(mount(<Chip label="Cash" variant="paid-with" onPress={press} />)).props.accessibilityLabel).toBe('Paid with Cash');
    expect(pressable(mount(<Chip label="HDFC" variant="paid-from" selected onPress={press} />)).props.accessibilityLabel).toBe('Paid from HDFC');
    expect(pressable(mount(<Chip label="Food" variant="quick-category" onPress={press} />)).props.accessibilityLabel).toBe('Food');
    for (const v of ['quick-category', 'account', 'period', 'paid-with', 'paid-from'] as const) {
      expect(() => mount(<Chip label="x" variant={v} onPress={press} />)).not.toThrow();
    }
  });

  it('presses', () => {
    press.mockClear();
    const r = mount(<Chip label="Food" onPress={press} />);
    act(() => pressable(r).props.onPress());
    expect(press).toHaveBeenCalledTimes(1);
  });
});

describe('FocusRing', () => {
  const ringColor = (focused: boolean, onGlass: boolean, mode: ThemeMode = 'light') => {
    const r = mount(<FocusRing focused={focused} onGlass={onGlass} testID="ring"><Text>x</Text></FocusRing>, mode);
    return flat(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'ring')[0]!);
  };

  it('draws a 2dp ring with 2dp offset only when focused', () => {
    const on = ringColor(true, false);
    expect(on.borderWidth).toBe(2);
    expect(on.padding).toBe(2);
    expect(on.borderColor).toBe(colorTokens['focus-ring']);
    expect(ringColor(false, false).borderColor).toBe('transparent');
    expect(ringColor(false, false).borderWidth).toBe(2); // space is always reserved: nothing moves
  });

  it('uses focus-ring-dark in dark mode and focus-ring-on-glass on glass', () => {
    expect(ringColor(true, false, 'dark').borderColor).toBe(colorTokens['focus-ring-dark']);
    expect(ringColor(true, true).borderColor).toBe(colorTokens['focus-ring-on-glass']);
    expect(ringColor(true, true, 'dark').borderColor).toBe(colorTokens['focus-ring-on-glass']);
  });
});

describe('hit-rect audit', () => {
  it('fails a control under 48dp (so the audit cannot pass vacuously)', () => {
    const { Pressable } = jest.requireActual('react-native') as typeof import('react-native');
    const r = mount(
      <Pressable accessible accessibilityRole="button" accessibilityLabel="Tiny" onPress={() => undefined} style={{ minHeight: 30, minWidth: 30 }} />,
    );
    expect(auditHitRects(r)).toEqual(['Tiny: 30x30']);
  });
});
