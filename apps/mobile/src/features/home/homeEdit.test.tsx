import { AccessibilityInfo, BackHandler, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type HomeLayoutEntry } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import type { SettingsApi } from '../settings/settingsApi';
import { SETTINGS_QUERY_KEY } from '../settings/settingsApi';
import { HOME_BUDGETS_KEY } from './HomeCards';
import { HomeEditScreen, indexAfterDrag, moveEntry } from './HomeEditScreen';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
const press = (r: ReactTestRenderer, id: string) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
const toggleHide = (r: ReactTestRenderer, id: string, v: boolean) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onValueChange === 'function')[0]!.props.onValueChange(v));
const entry = (cardId: string, over: Partial<HomeLayoutEntry> = {}): HomeLayoutEntry => ({ cardId, hidden: false, size: 'full', ...over });
const rowIds = (r: ReactTestRenderer) => r.root.findAll((n) => typeof n.type === 'string' && /^edit-row-/.test(String(n.props.testID))).map((n) => String(n.props.testID).replace('edit-row-', ''));

const settingsApi = (homeLayout: HomeLayoutEntry[] | null = null, saveOk = true) => {
  const saveHomeLayout = jest.fn(async (layout: readonly HomeLayoutEntry[] | null) => ({ ok: saveOk && layout !== undefined }));
  const api = { load: async () => ({ settings: { ...DEFAULT_SETTINGS, homeLayout } }), saveHomeLayout } as unknown as SettingsApi;
  return { api, saveHomeLayout };
};

async function mountEditor(homeLayout: HomeLayoutEntry[] | null = null, opts: { saveOk?: boolean; budgetsCache?: unknown } = {}) {
  const qc = createQueryClient();
  clients.push(qc);
  if (opts.budgetsCache !== undefined) qc.setQueryData(HOME_BUDGETS_KEY, opts.budgetsCache);
  const s = settingsApi(homeLayout, opts.saveOk ?? true);
  const onBack = jest.fn();
  let backHandler: (() => boolean) | undefined;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, fn: () => boolean) => {
    backHandler = fn;
    return { remove: () => undefined };
  }) as never);
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <HomeEditScreen settingsApi={s.api} onBack={onBack} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, qc, onBack, save: s.saveHomeLayout, hardwareBack: () => backHandler?.() };
}

describe('drag arithmetic', () => {
  const heights = [100, 100, 100, 100];
  it('a drag past half of a neighbour moves past it', () => {
    expect(indexAfterDrag(1, 40, heights)).toBe(1);
    expect(indexAfterDrag(1, 60, heights)).toBe(2);
    expect(indexAfterDrag(1, 160, heights)).toBe(3);
    expect(indexAfterDrag(1, -60, heights)).toBe(0);
    expect(indexAfterDrag(0, -500, heights)).toBe(0);
    expect(indexAfterDrag(3, 500, heights)).toBe(3);
  });
  it('moveEntry moves one item and changes nothing else', () => {
    expect(moveEntry(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveEntry(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
  });
});

describe('Edit Home (SCR-05, Story 5.6)', () => {
  it('pins Am I okay? first with no controls, lists every editable card in saved order, and not N to check', async () => {
    const { r } = await mountEditor();
    expect(host(r, 'edit-pinned')).toHaveLength(1);
    expect(host(r, 'edit-pinned')[0]!.props.accessibilityLabel).toBe('Am I okay?, Always first');
    expect(host(r, 'edit-handle-pinned')).toHaveLength(0);
    expect(rowIds(r)).toEqual(['income_expense', 'budgets', 'nws', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']);
    expect(texts(r).some((t) => /Things to check/.test(t))).toBe(false);
    expect(texts(r)).toEqual(expect.arrayContaining(['Income and expense', 'Budgets', 'Needs, Wants and Savings', 'Top categories', '7-day spend', 'Coming up', 'Savings goal']));
  });

  it('each row has a handle, Move up, Move down, a Hide switch; only Budgets and Top categories offer Compact and Full', async () => {
    const { r } = await mountEditor();
    for (const id of ['income_expense', 'budgets', 'nws', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']) {
      expect(host(r, `edit-handle-${id}`)).toHaveLength(1);
      expect(host(r, `edit-up-${id}`)).toHaveLength(1);
      expect(host(r, `edit-down-${id}`)).toHaveLength(1);
      expect(host(r, `edit-hide-${id}`)).toHaveLength(1);
    }
    for (const id of ['budgets', 'top_categories']) expect(host(r, `edit-size-compact-${id}`).length).toBeGreaterThan(0);
    for (const id of ['income_expense', 'nws', 'spend_7d']) expect(host(r, `edit-size-compact-${id}`)).toHaveLength(0);
  });

  it('Move up on Needs, Wants and Savings reaches the top and says its position', async () => {
    const { r } = await mountEditor();
    press(r, 'edit-up-nws');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Needs, Wants and Savings moved to position 3 of 8');
    press(r, 'edit-up-nws');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Needs, Wants and Savings moved to position 2 of 8');
    expect(rowIds(r)).toEqual(['nws', 'income_expense', 'budgets', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']);
  });

  it('Hide announces, shows the Hidden caption, and the row stays in the list', async () => {
    const { r } = await mountEditor();
    toggleHide(r, 'edit-hide-spend_7d', true);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('7-day spend hidden');
    expect(host(r, 'edit-hidden-spend_7d')).toHaveLength(1);
    expect(rowIds(r)).toContain('spend_7d');
    expect(r.root.findAll((n) => n.props.testID === 'edit-hide-spend_7d' && n.props.value === true).length).toBeGreaterThan(0);
  });

  it('Move up on the first row and Move down on the last are disabled but focusable, with their hints', async () => {
    const { r } = await mountEditor();
    const up = host(r, 'edit-up-income_expense')[0]!;
    expect(up.props.accessibilityState).toMatchObject({ disabled: true });
    expect(up.props.accessibilityHint).toBe('Already at the top');
    expect(up.props.accessible).toBe(true);
    const down = host(r, 'edit-down-savings_goal')[0]!;
    expect(down.props.accessibilityHint).toBe('Already at the bottom');
    press(r, 'edit-up-income_expense');
    expect(rowIds(r)[0]).toBe('income_expense'); // nothing moved
    expect(host(r, 'edit-up-budgets')[0]!.props.accessibilityHint).toBeUndefined();
  });

  it('exposes Move up and Move down as TalkBack custom actions that move the row', async () => {
    const { r } = await mountEditor();
    // The handle is the row's focusable stop, so the actions sit on it.
    const handle = () => host(r, 'edit-handle-budgets')[0]!;
    expect(handle().props.accessible).toBe(true);
    expect(handle().props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['moveUp', 'moveDown']);
    act(() => handle().props.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } }));
    expect(rowIds(r)).toEqual(['income_expense', 'nws', 'budgets', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']);
    act(() => host(r, 'edit-handle-budgets')[0]!.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } }));
    expect(rowIds(r)).toEqual(['income_expense', 'budgets', 'nws', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']);
  });

  it('the handle is a drag target', async () => {
    const { r } = await mountEditor();
    expect(typeof host(r, 'edit-handle-budgets')[0]!.props.onResponderRelease).toBe('function');
  });

  it('Back saves the whole layout once, in one call, and closes', async () => {
    const { r, onBack, save } = await mountEditor();
    press(r, 'edit-up-nws');
    press(r, 'edit-up-nws');
    toggleHide(r, 'edit-hide-spend_7d', true);
    press(r, 'edit-size-compact-top_categories');
    press(r, 'home-edit-back');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith([entry('nws'), entry('income_expense'), entry('budgets'), entry('top_categories', { size: 'compact' }), entry('spend_7d', { hidden: true }), entry('coming_up'), entry('savings_goal')]);
  });

  it('the hardware Back saves too, and leaving by unmount does not save a second time', async () => {
    const { r, onBack, save, hardwareBack } = await mountEditor();
    press(r, 'edit-down-income_expense');
    expect(hardwareBack()).toBe(true);
    await settle();
    expect(onBack).toHaveBeenCalled();
    act(() => r.unmount());
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when nothing changed, including after a move and its undo', async () => {
    const { r, save } = await mountEditor();
    press(r, 'home-edit-back');
    await settle();
    expect(save).not.toHaveBeenCalled();
    const b = await mountEditor();
    press(b.r, 'edit-down-income_expense');
    press(b.r, 'edit-up-income_expense');
    press(b.r, 'home-edit-back');
    await settle();
    expect(b.save).not.toHaveBeenCalled();
  });

  it('saves null when the layout is back at the PRD order, so the default is stored as the default', async () => {
    const { r, save } = await mountEditor([entry('nws'), entry('income_expense'), entry('budgets'), entry('top_categories'), entry('spend_7d'), entry('coming_up'), entry('savings_goal')]);
    press(r, 'edit-down-nws');
    press(r, 'edit-down-nws'); // nws is now third: the PRD order
    press(r, 'edit-up-income_expense'); // income first again
    press(r, 'home-edit-back');
    await settle();
    expect(save).toHaveBeenCalledWith(null);
  });

  it('Reset to default returns the PRD order at default sizes with a toast, and Undo restores the previous layout', async () => {
    const { r } = await mountEditor([entry('spend_7d', { hidden: true }), entry('income_expense'), entry('budgets', { size: 'compact' }), entry('nws'), entry('top_categories')]);
    expect(rowIds(r)[0]).toBe('spend_7d');
    press(r, 'home-edit-reset');
    expect(rowIds(r)).toEqual(['income_expense', 'budgets', 'nws', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']);
    expect(host(r, 'edit-hidden-spend_7d')).toHaveLength(0);
    expect(texts(r)).toContain('Home reset');
    const undo = r.root.findAll((n) => n.props.label === 'Undo' && typeof n.props.onPress === 'function')[0]!;
    act(() => undo.props.onPress());
    expect(rowIds(r)[0]).toBe('spend_7d');
    expect(host(r, 'edit-hidden-spend_7d')).toHaveLength(1);
  });

  it('a card added by a later release shows in its default place, and a saved id that is gone is ignored', async () => {
    const { r } = await mountEditor([entry('gone'), entry('spend_7d'), entry('budgets'), entry('income_expense'), entry('top_categories')]);
    expect(rowIds(r)).toEqual(['spend_7d', 'coming_up', 'savings_goal', 'budgets', 'nws', 'income_expense', 'top_categories']);
  });

  it('a card whose rule is false is still listed and orderable, saying when it will show', async () => {
    const { r } = await mountEditor(null, { budgetsCache: { categoryBudgets: [], nws: null } });
    expect(host(r, 'edit-caption-nws')).toHaveLength(1);
    expect(texts(r)).toContain('Shows when you use 50/30/20');
    expect(texts(r)).toContain('Shows when you set a category budget');
    press(r, 'edit-up-nws');
    expect(rowIds(r)[1]).toBe('nws');
    const on = await mountEditor(null, { budgetsCache: { categoryBudgets: [{}], nws: {} } });
    expect(host(on.r, 'edit-caption-nws')).toHaveLength(0);
  });

  it('a failed save keeps the screen open with the edits, says so, and Back tries again', async () => {
    const { r, save, onBack } = await mountEditor(null, { saveOk: false });
    press(r, 'edit-down-income_expense');
    press(r, 'home-edit-back');
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled(); // not closed: the edits are still here
    expect(texts(r)).toContain('Could not save your Home layout.');
    expect(rowIds(r)[0]).toBe('budgets');
    save.mockResolvedValue({ ok: true });
    press(r, 'home-edit-back');
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Undo after Reset does not throw away edits made after the reset', async () => {
    const { r } = await mountEditor([entry('spend_7d'), entry('income_expense'), entry('budgets'), entry('nws'), entry('top_categories')]);
    press(r, 'home-edit-reset');
    press(r, 'edit-down-income_expense'); // an edit after the reset
    const undo = r.root.findAll((n) => n.props.label === 'Undo' && typeof n.props.onPress === 'function')[0]!;
    act(() => undo.props.onPress());
    expect(rowIds(r)).toEqual(['budgets', 'income_expense', 'nws', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']); // still the reset order plus the edit
  });

  it('a refresh of the settings while editing does not move the nothing-changed baseline', async () => {
    const { r, qc, save } = await mountEditor();
    press(r, 'edit-down-income_expense');
    press(r, 'edit-up-income_expense'); // back where it started
    await act(async () => {
      qc.setQueryData(SETTINGS_QUERY_KEY, { settings: { ...DEFAULT_SETTINGS, homeLayout: [entry('nws'), entry('income_expense'), entry('budgets'), entry('top_categories'), entry('spend_7d'), entry('coming_up'), entry('savings_goal')] } });
    });
    press(r, 'home-edit-back');
    await settle();
    expect(save).not.toHaveBeenCalled();
  });

  it('after a save the settings cache holds the new layout so Home shows it at once', async () => {
    const { r, qc } = await mountEditor();
    press(r, 'edit-up-nws');
    press(r, 'home-edit-back');
    await settle();
    const cached = qc.getQueryData<{ settings: { homeLayout: HomeLayoutEntry[] | null } }>(SETTINGS_QUERY_KEY);
    expect(cached?.settings.homeLayout?.map((e) => e.cardId)).toEqual(['income_expense', 'nws', 'budgets', 'top_categories', 'spend_7d', 'coming_up', 'savings_goal']);
  });

  it('rows are at least 48dp tall to touch and the screen has a Back and a title', async () => {
    const { r } = await mountEditor();
    expect(texts(r)).toContain('Edit Home');
    expect(host(r, 'home-edit-back')).toHaveLength(1);
    expect(StyleSheet.flatten(host(r, 'edit-handle-budgets')[0]!.props.style)).toMatchObject({ width: 48, height: 48 });
  });
});
