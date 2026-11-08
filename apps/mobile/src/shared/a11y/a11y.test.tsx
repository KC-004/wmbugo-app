import { AccessibilityInfo } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SUPPORTED_CURRENCIES } from '@wmbugo/core';
import { copy, copyEntries } from '../copy';
import { announce, LiveRegion } from './announce';
import { aboutText, amountLabel, controlA11y, spokenAmount } from './labels';
import { reducedMotion, useReducedMotion } from './useReducedMotion';

describe('amount labels (exact EXPERIENCE.md strings)', () => {
  it('reads direction and amount in full', () => {
    expect(amountLabel({ amountMinor: 8500000, currency: 'INR', kind: 'income' })).toBe('Income, plus 85,000 rupees');
    expect(amountLabel({ amountMinor: 42000, currency: 'INR', kind: 'spent' })).toBe('Spent 420 rupees');
    expect(amountLabel({ amountMinor: 129900, currency: 'INR', kind: 'refund' })).toBe('Refund, plus 1,299 rupees');
    expect(amountLabel({ amountMinor: 500000, currency: 'INR', kind: 'transfer' })).toBe('Transfer 5,000 rupees');
    expect(amountLabel({ amountMinor: 234000, currency: 'INR', kind: 'over-budget' })).toBe('Over budget, 2,340 rupees');
    expect(amountLabel({ amountMinor: 1186000000, currency: 'INR' })).toBe('1,18,60,000 rupees');
  });

  it('reads inline in lower case inside a row label', () => {
    expect(amountLabel({ amountMinor: 8500000, currency: 'INR', kind: 'income', inline: true })).toBe('income, plus 85,000 rupees');
    expect(amountLabel({ amountMinor: 42000, currency: 'INR', kind: 'spent', inline: true })).toBe('spent 420 rupees');
  });

  it('reads hidden amounts as "Amount hidden" and keeps the direction word', () => {
    expect(amountLabel({ amountMinor: 123, currency: 'INR', hidden: true })).toBe('Amount hidden');
    expect(amountLabel({ amountMinor: 123, currency: 'INR', kind: 'income', hidden: true })).toBe('Income, amount hidden');
    expect(amountLabel({ amountMinor: 123, currency: 'INR', kind: 'spent', hidden: true })).not.toMatch(/123/);
  });

  it('says "about" for rough figures', () => {
    expect(amountLabel({ amountMinor: 98800, currency: 'INR', approximate: true })).toBe('About 988 rupees');
    expect(aboutText('~₹988/day · 12 days left')).toBe('about ₹988/day · 12 days left');
    expect(aboutText('~ 5')).toBe('about 5');
    expect(aboutText('no tilde')).toBe('no tilde');
  });

  it('speaks fractions and every Phase 1 currency in words, never a bare code or a minus', () => {
    expect(spokenAmount(123450, 'USD')).toBe('1,234.50 US dollars');
    expect(spokenAmount(1234500, 'BHD')).toBe('1,234.500 dinars');
    expect(spokenAmount(1000000, 'INR')).toBe('10,000 rupees');
    expect(spokenAmount(100000, 'INR')).toBe('1,000 rupees');
    expect(spokenAmount(1000, 'IDR')).toMatch(/^1[.,]000 rupiah$/);
    expect(spokenAmount(1000000, 'HUF')).toMatch(/^1.000.000 forints$/);
    for (const c of SUPPORTED_CURRENCIES) {
      const said = spokenAmount(-12345, c.code);
      expect(said).toMatch(/[a-z]$/);
      expect(said).not.toContain(c.code);
      expect(said).not.toMatch(/[-−]/);
    }
  });

  it('returns an empty string for an unsafe amount instead of speaking nonsense', () => {
    expect(spokenAmount(1.5, 'INR')).toBe('');
  });
});

describe('controlA11y', () => {
  it('exposes role, label and state', () => {
    expect(controlA11y({ label: 'Food', role: 'button', selected: true })).toEqual({
      accessible: true,
      accessibilityRole: 'button',
      accessibilityLabel: 'Food',
      accessibilityState: { selected: true },
    });
  });

  it('a disabled control stays focusable and carries a hint', () => {
    const p = controlA11y({ label: 'Save', disabled: true, hint: 'Enter an amount first' });
    expect(p.accessible).toBe(true);
    expect(p.accessibilityState.disabled).toBe(true);
    expect(p.accessibilityHint).toBe('Enter an amount first');
  });

  it('defaults the role to button and reads ~ as about', () => {
    expect(controlA11y({ label: '~₹988/day' }).accessibilityRole).toBe('button');
    expect(controlA11y({ label: '~₹988/day' }).accessibilityLabel).toBe('about ₹988/day');
  });
});

describe('live regions and announcements', () => {
  it('LiveRegion sets polite or assertive', () => {
    let polite!: ReturnType<typeof create>;
    let assertive!: ReturnType<typeof create>;
    act(() => {
      polite = create(<LiveRegion>{null}</LiveRegion>);
      assertive = create(<LiveRegion politeness="assertive">{null}</LiveRegion>);
    });
    expect(polite.root.findByProps({ accessibilityLiveRegion: 'polite' })).toBeTruthy();
    expect(assertive.root.findByProps({ accessibilityLiveRegion: 'assertive' })).toBeTruthy();
  });

  it('announce speaks through AccessibilityInfo', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    announce('Saved. Undo available');
    expect(spy).toHaveBeenCalledWith('Saved. Undo available');
    spy.mockRestore();
  });
});

describe('reduced motion', () => {
  it('is on for animator scale 0, the system flag, or the in-app setting', () => {
    expect(reducedMotion({ animatorScale: 1, systemReduceMotion: false, inApp: false })).toBe(false);
    expect(reducedMotion({ animatorScale: 0, systemReduceMotion: false, inApp: false })).toBe(true);
    expect(reducedMotion({ animatorScale: 1, systemReduceMotion: true, inApp: false })).toBe(true);
    expect(reducedMotion({ animatorScale: 1, systemReduceMotion: false, inApp: true })).toBe(true);
    expect(reducedMotion({ animatorScale: 0.5, systemReduceMotion: false, inApp: false })).toBe(false);
  });

  it('the hook honours the in-app setting and the system flag', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
    let seen: boolean | undefined;
    function Probe({ inApp }: { inApp: boolean }) {
      seen = useReducedMotion(inApp);
      return null;
    }
    await act(async () => {
      create(<Probe inApp={false} />);
    });
    expect(seen).toBe(false);
    await act(async () => {
      create(<Probe inApp />);
    });
    expect(seen).toBe(true);
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    await act(async () => {
      create(<Probe inApp={false} />);
    });
    expect(seen).toBe(true);
    jest.restoreAllMocks();
  });
});

describe('copy catalogue', () => {
  const entries = copyEntries();
  const BANNED = [/\binbox\b/i, /coming soon/i, /overspent/i, /you failed/i, /\bwasted?\b/i, /!/, /\bunread\b/i];

  it('has entries and reads by key', () => {
    expect(entries.length).toBeGreaterThan(5);
    expect(copy.startup.storageError).toBe("wmbugo couldn't open its secure storage. Nothing was changed.");
  });

  it.each(entries)('%s is calm, sentence case and free of banned wording', (_key, text) => {
    for (const re of BANNED) expect(text).not.toMatch(re);
    expect(text.length).toBeGreaterThan(0);
    // Sentence case: no word in ALL CAPS of 4+ letters (acronyms such as SMS are 3 letters).
    expect(text).not.toMatch(/\b[A-Z]{4,}\b/);
    // Starts like a sentence (capital letter or brand name), unless it is the lower-case brand.
    expect(text).toMatch(/^([A-Z0-9+{]|wmbugo)/);
  });

  it('keys are unique and dotted', () => {
    expect(new Set(entries.map(([k]) => k)).size).toBe(entries.length);
    for (const [k] of entries) expect(k).toMatch(/^[a-zA-Z]+(\.[a-zA-Z]+)*$/);
  });
});
