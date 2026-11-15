import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { LedgerWriter } from '../writer/ledgerWriter';
import { defaultHomeLayout, isHomeLayout, resolveHomeLayout, sameHomeLayout, type HomeLayoutEntry, type RegisteredCard } from './homeLayout';
import { findRegion } from './regions';
import { parseSettings, SETTINGS_SQL } from './settings';
import { SaveHomeLayout } from './settingsCommands';

const REGISTRY: RegisteredCard[] = [
  { id: 'income', defaultSize: 'full' },
  { id: 'budgets', defaultSize: 'full' },
  { id: 'nws', defaultSize: 'full' },
  { id: 'top', defaultSize: 'full' },
  { id: 'spend', defaultSize: 'full' },
];
const entry = (cardId: string, over: Partial<HomeLayoutEntry> = {}): HomeLayoutEntry => ({ cardId, hidden: false, size: 'full', ...over });
const ids = (l: readonly HomeLayoutEntry[]) => l.map((e) => e.cardId);

describe('resolveHomeLayout (Story 5.6)', () => {
  it('no saved layout is the PRD order, every card shown at its default size', () => {
    expect(resolveHomeLayout(REGISTRY, null)).toEqual(defaultHomeLayout(REGISTRY));
    expect(resolveHomeLayout(REGISTRY, undefined)).toEqual(defaultHomeLayout(REGISTRY));
  });

  it('keeps the saved order, hidden flags and sizes', () => {
    const saved = [entry('nws'), entry('income'), entry('spend', { hidden: true }), entry('budgets', { size: 'compact' }), entry('top')];
    expect(resolveHomeLayout(REGISTRY, saved)).toEqual(saved);
  });

  it('ignores a saved id that no longer exists, and a repeated one', () => {
    const out = resolveHomeLayout(REGISTRY, [entry('gone'), entry('nws'), entry('nws', { hidden: true }), entry('income')]);
    expect(ids(out)).not.toContain('gone');
    expect(out.filter((e) => e.cardId === 'nws')).toHaveLength(1);
    expect(out.find((e) => e.cardId === 'nws')!.hidden).toBe(false);
  });

  it('puts a card the saved list lacks at its default place relative to its neighbours', () => {
    // The user reordered four cards; a later release added `nws` between `budgets` and `top`.
    const out = resolveHomeLayout(REGISTRY, [entry('spend'), entry('budgets'), entry('income'), entry('top')]);
    expect(ids(out)).toEqual(['spend', 'budgets', 'nws', 'income', 'top']);
    // A new card with nothing before it in the PRD order goes first.
    expect(ids(resolveHomeLayout(REGISTRY, [entry('budgets'), entry('nws'), entry('top'), entry('spend')]))).toEqual(['income', 'budgets', 'nws', 'top', 'spend']);
  });

  it('a missing card arrives shown at its default size', () => {
    const out = resolveHomeLayout([...REGISTRY, { id: 'new', defaultSize: 'compact' }], defaultHomeLayout(REGISTRY));
    expect(out[out.length - 1]).toEqual({ cardId: 'new', hidden: false, size: 'compact' });
  });

  it('always lists every registered card exactly once, whatever was saved (property)', () => {
    const arb = fc.array(fc.record({ cardId: fc.constantFrom('income', 'budgets', 'nws', 'top', 'spend', 'gone', 'other'), hidden: fc.boolean(), size: fc.constantFrom('full' as const, 'compact' as const) }), { maxLength: 12 });
    fc.assert(
      fc.property(arb, (saved) => {
        const out = resolveHomeLayout(REGISTRY, saved);
        expect([...ids(out)].sort()).toEqual(REGISTRY.map((c) => c.id).sort());
      }),
      { numRuns: 200 },
    );
  });
});

describe('resolveHomeLayout sizes and sanitising', () => {
  const SIZED: RegisteredCard[] = [{ id: 'a', defaultSize: 'full', sizes: ['full'] }, { id: 'b', defaultSize: 'full', sizes: ['full', 'compact'] }];
  it('a saved size the card does not support falls back to its default; one it supports stays', () => {
    const out = resolveHomeLayout(SIZED, [entry('a', { size: 'compact' }), entry('b', { size: 'compact' })]);
    expect(out).toEqual([entry('a'), entry('b', { size: 'compact' })]);
  });

  it('saving stores only the three known fields of each entry', async () => {
    const db = new NodeSqliteDatabase().applyRealMigrations();
    const clock = new FakeClock(Date.UTC(2026, 10, 18, 10, 0, 0), 'Asia/Kolkata');
    const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(5)), logger: createRedactingLogger({ write: () => undefined }), invariants: [] });
    await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
    const dirty = [{ cardId: 'a', hidden: false, size: 'full', junk: 'x'.repeat(500) }] as unknown as HomeLayoutEntry[];
    expect((await writer.run(SaveHomeLayout, { layout: dirty }, 'user')).ok).toBe(true);
    const stored = String((await db.query("SELECT value_json FROM settings WHERE key = 'ui.home_layout'"))[0]![0]);
    expect(stored).toBe('[{"cardId":"a","hidden":false,"size":"full"}]');
  });
});

describe('isHomeLayout', () => {
  it('accepts a well-formed list and refuses anything else', () => {
    expect(isHomeLayout([entry('a'), entry('b', { hidden: true, size: 'compact' })])).toBe(true);
    expect(isHomeLayout([])).toBe(true);
    for (const bad of [null, 'x', {}, [entry('a'), entry('a')], [{ cardId: '', hidden: false, size: 'full' }], [{ cardId: 'a', hidden: 'no', size: 'full' }], [{ cardId: 'a', hidden: false, size: 'huge' }], [1], Array.from({ length: 51 }, (_, i) => entry(`c${i}`))]) {
      expect(isHomeLayout(bad)).toBe(false);
    }
  });
});

describe('SaveHomeLayout (Story 5.6, HOM-003)', () => {
  async function setup() {
    const db = new NodeSqliteDatabase().applyRealMigrations();
    const clock = new FakeClock(Date.UTC(2026, 10, 18, 10, 0, 0), 'Asia/Kolkata');
    const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(5)), logger: createRedactingLogger({ write: () => undefined }), invariants: [] });
    const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
    if (!p.ok) throw new Error('setup');
    const layout = async () => parseSettings(await db.query(SETTINGS_SQL)).homeLayout;
    const events = async () => (await db.query('SELECT event FROM outbox')).map((r) => String(r[0]));
    return { db, writer, layout, events };
  }

  it('is null by default, saves a layout in one audited write with ProfileChanged, and reads it back', async () => {
    const { db, writer, layout, events } = await setup();
    expect(await layout()).toBeNull();
    const saved = [entry('nws'), entry('income'), entry('spend', { hidden: true })];
    expect(await writer.run(SaveHomeLayout, { layout: saved }, 'user')).toEqual({ ok: true, value: { changed: true } });
    expect(await layout()).toEqual(saved);
    expect(await events()).toContain('ProfileChanged');
    const audit = JSON.stringify(await db.query("SELECT * FROM audit_event WHERE entity_kind = 'settings'"));
    expect(audit).toContain('ui.home_layout');
    expect(audit).not.toContain('nws'); // the key, never the list
  });

  it('saving what is already stored writes nothing', async () => {
    const { db, writer } = await setup();
    const saved = [entry('income'), entry('budgets', { size: 'compact' })];
    await writer.run(SaveHomeLayout, { layout: saved }, 'user');
    const settingsAudit = async () => (await db.query("SELECT COUNT(*) FROM audit_event WHERE entity_kind = 'settings'"))[0]![0];
    const version = async () => (await db.query("SELECT version FROM settings WHERE key = 'ui.home_layout'"))[0]![0];
    const auditBefore = await settingsAudit();
    const versionBefore = await version();
    const outboxBefore = (await db.query('SELECT COUNT(*) FROM outbox'))[0]![0];
    expect(await writer.run(SaveHomeLayout, { layout: saved }, 'user')).toEqual({ ok: true, value: { changed: false } });
    expect(await settingsAudit()).toBe(auditBefore); // no settings row was touched
    expect(await version()).toBe(versionBefore);
    expect((await db.query('SELECT COUNT(*) FROM outbox'))[0]![0]).toBe(outboxBefore);
    // Resetting an untouched layout writes nothing either.
    const fresh = await setup();
    expect(await fresh.writer.run(SaveHomeLayout, { layout: null }, 'user')).toEqual({ ok: true, value: { changed: false } });
  });

  it('null resets to the PRD order', async () => {
    const { writer, layout } = await setup();
    await writer.run(SaveHomeLayout, { layout: [entry('spend')] }, 'user');
    expect(await writer.run(SaveHomeLayout, { layout: null }, 'user')).toEqual({ ok: true, value: { changed: true } });
    expect(await layout()).toBeNull();
  });

  it('refuses a malformed layout and writes nothing', async () => {
    const { db, writer } = await setup();
    expect(await writer.run(SaveHomeLayout, { layout: [entry('a'), entry('a')] }, 'user')).toEqual({ ok: false, code: 'LAYOUT_INVALID' });
    expect((await db.query("SELECT 1 FROM settings WHERE key = 'ui.home_layout'")).length).toBe(0);
  });

  it('a corrupt stored value reads as the default layout', async () => {
    const { db, layout } = await setup();
    await db.query("INSERT INTO settings (key, value_json, version, updated_at) VALUES ('ui.home_layout', '[{\"cardId\":1}]', 1, 0)");
    expect(await layout()).toBeNull();
  });

  it('the same layout is recognised by sameHomeLayout and a changed one is not', () => {
    expect(sameHomeLayout([entry('a')], [entry('a')])).toBe(true);
    expect(sameHomeLayout([entry('a')], [entry('a', { hidden: true })])).toBe(false);
    expect(sameHomeLayout([entry('a'), entry('b')], [entry('b'), entry('a')])).toBe(false);
  });
});
