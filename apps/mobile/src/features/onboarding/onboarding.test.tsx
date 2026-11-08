import { AccessibilityInfo, Linking, PermissionsAndroid, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { findRegion, type SetUpProfileInput } from '@wmbugo/core';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { OnboardingFlow, sampleMinor } from './OnboardingFlow';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

function mount(detectedCode: string | null, onFinish: (i: SetUpProfileInput) => Promise<boolean> = async () => true): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider initialMode="light">
        <OnboardingFlow detected={findRegion(detectedCode)} timezoneId="Asia/Singapore" onFinish={onFinish} />
      </ThemeProvider>,
    );
  });
  live.push(r);
  return r;
}

const fire = (r: ReactTestRenderer, testID: string, handler = 'onPress', ...args: unknown[]) =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.props[handler] === 'function')[0]!.props[handler](...args);
const has = (r: ReactTestRenderer, testID: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const disabled = (r: ReactTestRenderer) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'onboarding-continue')[0]!.props.accessibilityState?.disabled === true;
const next = (r: ReactTestRenderer) => act(() => fire(r, 'onboarding-continue'));

describe('Welcome (SCR-01)', () => {
  it('shows the three facts in one line and one Continue button, with no tutorial', () => {
    const r = mount('SG');
    expect(texts(r)).toEqual(expect.arrayContaining(['Welcome to wmbugo', 'No sign-up · No internet · No bank login', 'Continue']));
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button')).toHaveLength(1);
    expect(has(r, 'onboarding-back')).toBe(false);
    expect(JSON.stringify(r.toJSON())).not.toMatch(/ActivityIndicator|tutorial|skip/i);
  });
});

describe('Region and currency (SCR-02)', () => {
  it('Singapore is pre-selected with a live preview, and Continue confirms in one tap', () => {
    const r = mount('SG');
    next(r);
    expect(texts(r)).toContain('Singapore · S$ SGD');
    expect(texts(r).join(' ')).toContain('Amounts look like');
    expect(texts(r)).toContain('S$1,234.50');
    expect(disabled(r)).toBe(false);
    next(r);
    expect(texts(r)).toContain('When are you paid?');
  });

  it('India is pre-selected whatever the language, and still has to be confirmed', () => {
    const r = mount('IN');
    next(r);
    expect(texts(r)).toContain('India · ₹ INR');
    expect(texts(r)).toContain('₹1,234.50');
    expect(texts(r)).toContain('Where are you?'); // still on the step: nothing auto-advanced
  });

  it('Change opens a searchable list with the detected region pinned first, and the preview updates on selection', () => {
    const r = mount('SG');
    next(r);
    act(() => fire(r, 'region-change'));
    const order = () => r.root.findAll((n) => typeof n.type === 'string' && /^region-[A-Z]{2}$/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(order()[0]).toBe('region-SG');
    expect(order().length).toBeGreaterThanOrEqual(10); // the list is virtualised: the first screenful renders
    act(() => fire(r, 'region-search', 'onChangeText', 'jap'));
    expect(texts(r)).toContain('No match. Try a country name or a currency code.');
    act(() => fire(r, 'region-search', 'onChangeText', 'eur'));
    expect(order().length).toBeGreaterThan(5);
    act(() => fire(r, 'region-search', 'onChangeText', 'ger'));
    expect(order()).toEqual(['region-DE']);
    act(() => fire(r, 'region-DE'));
    expect(texts(r)).toContain('Germany · € EUR');
    const nbsp = String.fromCharCode(160);
    expect(texts(r).some((t) => t.split(nbsp).join(' ') === '1.234,50 €')).toBe(true);
  });

  it('search matches a currency code and cancel returns without changing the region', () => {
    const r = mount('SG');
    next(r);
    act(() => fire(r, 'region-change'));
    act(() => fire(r, 'region-search', 'onChangeText', 'inr'));
    expect(r.root.findAll((n) => typeof n.type === 'string' && /^region-[A-Z]{2}$/.test(String(n.props.testID))).map((n) => n.props.testID)).toEqual(['region-IN']);
    act(() => fire(r, 'region-cancel'));
    expect(texts(r)).toContain('Singapore · S$ SGD');
  });

  it('says currency is fixed once entries exist', () => {
    const r = mount('SG');
    next(r);
    expect(texts(r)).toContain('You can change the currency until you add your first entry.');
  });

  it('a device region that is not a Phase 1 market pre-selects nothing and disables Continue with a hint', () => {
    const r = mount('JP');
    next(r);
    expect(has(r, 'region-summary')).toBe(false);
    expect(disabled(r)).toBe(true);
    expect(texts(r)).toContain('Choose your region to continue.');
    const btn = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'onboarding-continue')[0]!;
    expect(btn.props.accessibilityHint).toBe('Choose your region to continue.');
    act(() => fire(r, 'region-change'));
    act(() => fire(r, 'region-search', 'onChangeText', 'india'));
    act(() => fire(r, 'region-IN'));
    expect(disabled(r)).toBe(false);
    expect(texts(r)).toContain('India · ₹ INR');
  });

  it('sample amounts use the right number of minor digits', () => {
    expect(sampleMinor(findRegion('SG')!)).toBe(123450);
    expect(sampleMinor(findRegion('BH')!)).toBe(1234500);
    expect(sampleMinor(findRegion('ID')!)).toBe(1234);
  });
});

describe('Payday', () => {
  const toPayday = (code = 'SG') => {
    const r = mount(code);
    next(r);
    next(r);
    return r;
  };

  it('Continue stays disabled until a chip is chosen, then the five chips work', () => {
    const r = toPayday();
    expect(disabled(r)).toBe(true);
    expect(texts(r)).toContain('Pick when you are paid to continue.');
    for (const c of ['first', 'last_day', 'last_working_day', 'none']) {
      act(() => fire(r, `payday-${c}`));
      expect(disabled(r)).toBe(false);
    }
    expect(texts(r)).toEqual(expect.arrayContaining(['1st', 'Last day', 'Last working day', 'Other', 'Not salaried']));
  });

  it('Other asks for a day from 1 to 31', () => {
    const r = toPayday();
    expect(has(r, 'payday-day')).toBe(false);
    act(() => fire(r, 'payday-other'));
    expect(has(r, 'payday-day')).toBe(true);
    expect(disabled(r)).toBe(true);
    for (const bad of ['0', '32', '99']) {
      act(() => fire(r, 'payday-day', 'onChangeText', bad));
      expect(disabled(r)).toBe(true);
    }
    act(() => fire(r, 'payday-day', 'onChangeText', 'ab3'));
    expect(disabled(r)).toBe(false); // letters are stripped: "3"
    act(() => fire(r, 'payday-day', 'onChangeText', '25'));
    expect(disabled(r)).toBe(false);
  });
});

describe('50/30/20 and Finish', () => {
  const toLast = (onFinish: (i: SetUpProfileInput) => Promise<boolean>, code = 'SG') => {
    const r = mount(code, onFinish);
    next(r);
    next(r);
    act(() => fire(r, 'payday-last_day'));
    next(r);
    return r;
  };

  it('Finish is disabled until the step is answered or skipped', () => {
    const r = toLast(async () => true);
    expect(texts(r)).toContain('Try 50/30/20?');
    expect(texts(r)).toContain('Finish');
    expect(disabled(r)).toBe(true);
    act(() => fire(r, 'budget-skip'));
    expect(disabled(r)).toBe(false);
  });

  it('Not now saves the answer and nothing else; nothing is written before Finish', async () => {
    const onFinish = jest.fn<Promise<boolean>, [SetUpProfileInput]>(async () => true);
    const r = toLast(onFinish);
    expect(onFinish).not.toHaveBeenCalled();
    act(() => fire(r, 'budget-not-now'));
    expect(onFinish).not.toHaveBeenCalled();
    await act(async () => fire(r, 'onboarding-continue'));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({ region: findRegion('SG'), payday: { kind: 'last_day' }, budgetOffer: { answer: 'not-now' }, timezoneId: 'Asia/Singapore' });
  });

  it('Yes needs a rough monthly income in the profile currency', async () => {
    const onFinish = jest.fn<Promise<boolean>, [SetUpProfileInput]>(async () => true);
    const r = toLast(onFinish);
    act(() => fire(r, 'budget-yes'));
    expect(disabled(r)).toBe(true);
    act(() => fire(r, 'budget-income', 'onChangeText', 'abc'));
    expect(disabled(r)).toBe(true);
    act(() => fire(r, 'budget-income', 'onChangeText', '4500.50'));
    expect(disabled(r)).toBe(false);
    await act(async () => fire(r, 'onboarding-continue'));
    expect(onFinish.mock.calls[0]![0]).toMatchObject({ budgetOffer: { answer: 'yes', roughMonthlyIncomeMinor: 450050 } });
  });

  it('Skip finishes without a stored answer', async () => {
    const onFinish = jest.fn<Promise<boolean>, [SetUpProfileInput]>(async () => true);
    const r = toLast(onFinish);
    act(() => fire(r, 'budget-skip'));
    await act(async () => fire(r, 'onboarding-continue'));
    expect(onFinish.mock.calls[0]![0].budgetOffer).toEqual({ answer: 'skipped' });
  });

  it('a failed save shows the calm error with "Nothing was saved" and lets Mei try again', async () => {
    const onFinish = jest.fn<Promise<boolean>, [SetUpProfileInput]>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const r = toLast(onFinish);
    act(() => fire(r, 'budget-skip'));
    await act(async () => fire(r, 'onboarding-continue'));
    expect(texts(r).join(' ')).toContain('Something went wrong while setting up. Nothing was saved');
    expect(r.root.findAllByProps({ accessibilityLiveRegion: 'assertive' }).length).toBeGreaterThan(0);
    await act(async () => fire(r, 'onboarding-continue'));
    expect(onFinish).toHaveBeenCalledTimes(2);
  });

  it('double-tapping Finish saves once', async () => {
    let release!: (v: boolean) => void;
    const onFinish = jest.fn<Promise<boolean>, [SetUpProfileInput]>(() => new Promise<boolean>((res) => (release = res)));
    const r = toLast(onFinish);
    act(() => fire(r, 'budget-skip'));
    await act(async () => {
      fire(r, 'onboarding-continue');
      fire(r, 'onboarding-continue');
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
    await act(async () => release(true));
  });

  it('Back at any step keeps the earlier answers', () => {
    const r = toLast(async () => true);
    act(() => fire(r, 'budget-skip'));
    act(() => fire(r, 'onboarding-back'));
    expect(texts(r)).toContain('When are you paid?');
    act(() => fire(r, 'onboarding-back'));
    expect(texts(r)).toContain('Singapore · S$ SGD');
    act(() => fire(r, 'onboarding-back'));
    expect(texts(r)).toContain('Welcome to wmbugo');
    next(r);
    next(r);
    expect(disabled(r)).toBe(false); // the payday chosen earlier is still there
  });
});

describe('permissions and offline', () => {
  it('requests no permission anywhere in the flow (SMS, camera, photos, notifications)', async () => {
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('denied');
    const requestMultiple = jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({} as never);
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const r = mount('SG', async () => true);
    next(r);
    act(() => fire(r, 'region-change'));
    act(() => fire(r, 'region-cancel'));
    next(r);
    act(() => fire(r, 'payday-first'));
    next(r);
    act(() => fire(r, 'budget-yes'));
    act(() => fire(r, 'budget-income', 'onChangeText', '1000'));
    await act(async () => fire(r, 'onboarding-continue'));
    expect(request).not.toHaveBeenCalled();
    expect(requestMultiple).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('makes no network request while it runs', async () => {
    const fetchSpy = jest.fn();
    const g = globalThis as { fetch?: unknown; XMLHttpRequest?: unknown };
    const original = g.fetch;
    g.fetch = fetchSpy;
    const r = mount('SG', async () => true);
    next(r);
    next(r);
    act(() => fire(r, 'payday-none'));
    next(r);
    act(() => fire(r, 'budget-skip'));
    await act(async () => fire(r, 'onboarding-continue'));
    g.fetch = original;
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
