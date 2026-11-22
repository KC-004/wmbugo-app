import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { buildCsv, entriesToImport, type CurrencyCode, type ImportClass, type ImportPlan, type ImportSummary, type PlannedRow, type RowDecision, type RunImportError } from '@wmbugo/core';
import { LongTaskLoader } from '../../shared/brand/LongTaskLoader';
import { copy } from '../../shared/copy';
import { useToast } from '../../shared/feedback/ToastHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import type { RunApi } from './importApi';
import type { ImportDraft } from './importModel';

const c = copy.csvImport;
const SHOWN = 30;

/** What each class is called and what happens to its rows by default; the choices a person can make for a row of that class. */
const GROUPS: readonly { cls: ImportClass; title: string; note: string; choices: readonly RowDecision[] }[] = [
  { cls: 'new', title: c.groupNew, note: c.noteNew, choices: [] },
  { cls: 'possible_duplicate', title: c.groupDuplicate, note: c.noteDuplicate, choices: ['default', 'import_anyway', 'skip'] },
  { cls: 'transfer_pair', title: c.groupTransfer, note: c.noteTransfer, choices: ['default', 'import_anyway', 'skip'] },
  { cls: 'held_pair', title: c.groupHeld, note: c.noteHeld, choices: ['default', 'import_anyway', 'skip'] },
  { cls: 'edge_day_review', title: c.groupEdge, note: c.noteEdge, choices: ['default', 'import_anyway', 'skip'] },
  { cls: 'foreign_currency', title: c.groupForeign, note: c.noteForeign, choices: ['default', 'skip'] },
  { cls: 'previously_deleted', title: c.groupDeleted, note: c.noteDeleted, choices: ['default', 'import_anyway'] },
  { cls: 'previously_rejected', title: c.groupDeleted, note: c.noteDeleted, choices: ['default', 'import_anyway'] },
  { cls: 'already_recorded', title: c.groupAlready, note: c.noteAlready, choices: [] },
  { cls: 'error', title: c.groupError, note: c.noteError, choices: [] },
];

/** The chip's words for a decision, which mean different things in different groups (`default` is `Check later` or `Leave out`). */
function choiceLabel(cls: ImportClass, d: RowDecision): string {
  if (d === 'import_anyway') return c.choiceAnyway;
  if (d === 'skip') return c.choiceSkip;
  return cls === 'previously_deleted' || cls === 'previously_rejected' ? c.choiceLeaveOut : c.choiceCheckLater;
}

const bulkLabel = (d: RowDecision): string => (d === 'import_anyway' ? c.allAnyway : d === 'skip' ? c.allSkip : c.allDefault);
const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), s);

/** The rows the file had that could not be read, as a CSV the person can fix and bring back: the file's own cells and what was wrong. */
export function unreadableRowsCsv(draft: ImportDraft, plan: ImportPlan): string {
  const bad = new Map(plan.rows.filter((r) => r.class === 'error').map((r) => [r.row, r.errors.map((e) => e.message).join('; ')]));
  const header = draft.read.header.length > 0 ? [...draft.read.header] : draft.read.rows[0]?.cells.map((_, i) => `Column ${i + 1}`) ?? [];
  const rows = draft.read.rows.filter((r) => bad.has(r.row)).map((r) => [...r.cells, bad.get(r.row)!]);
  return buildCsv([], [...header, c.problemColumn], rows);
}

type Phase = { kind: 'checking' } | { kind: 'matches'; plan: ImportPlan } | { kind: 'importing'; done: number; total: number; stopping: boolean } | { kind: 'summary'; summary: ImportSummary; failed?: RunImportError; plan: ImportPlan | null };

function GroupCard({ group, rows, decisions, setDecisions, locale }: { group: (typeof GROUPS)[number]; rows: readonly PlannedRow[]; decisions: Record<number, RowDecision>; setDecisions: (d: Record<number, RowDecision>) => void; locale: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const set = (list: readonly PlannedRow[], d: RowDecision) => {
    const next = { ...decisions };
    for (const r of list) {
      if (d === 'default') delete next[r.row];
      else next[r.row] = d;
    }
    setDecisions(next);
  };
  const ink = { color: theme.color('text-primary') };
  const quiet = { color: theme.color('text-secondary') };
  const expandable = group.choices.length > 0;
  return (
    <View testID={'import-group-' + group.cls} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text accessibilityRole="header" style={[textStyle('body-medium'), ink]}>
        {`${group.title} (${rows.length})`}
      </Text>
      <Text style={[textStyle('caption'), quiet]}>{group.note}</Text>
      {expandable ? (
        <>
          <View style={[styles.chips, fontScale >= 1.3 && styles.stack]}>
            {group.choices.map((d) => (
              <Chip key={d} variant="quick-category" label={d === 'default' ? c.allDefault : bulkLabel(d)} onPress={() => set(rows, d)} testID={`import-all-${group.cls}-${d}`} />
            ))}
            <Chip label={open ? c.hideRows : c.showRows} onPress={() => setOpen((o) => !o)} testID={'import-rows-' + group.cls} />
          </View>
          {open ? (
            <View style={styles.list}>
              {rows.slice(0, SHOWN).map((r) => (
                <View key={r.row} testID={'import-row-' + r.row} style={styles.listRow}>
                  <View style={styles.rowTop}>
                    <View style={styles.rowText}>
                      <Text style={[textStyle('body-medium'), ink]}>{r.candidate?.merchant || r.candidate?.description || ''}</Text>
                      <Text style={[textStyle('caption'), quiet]}>{r.candidate?.localDate ?? ''}</Text>
                    </View>
                    {r.candidate ? <Amount amountMinor={r.candidate.amountMinor} currency={r.candidate.currency as CurrencyCode} direction={r.candidate.direction === 'out' ? 'expense' : 'income'} locale={locale} /> : null}
                  </View>
                  <View style={styles.chips}>
                    {group.choices.map((d) => (
                      <Chip key={d} role="radio" label={choiceLabel(group.cls, d)} selected={(decisions[r.row] ?? 'default') === d} onPress={() => set([r], d)} testID={`import-choice-${r.row}-${d}`} />
                    ))}
                  </View>
                </View>
              ))}
              {rows.length > SHOWN ? <Text style={[textStyle('caption'), quiet]}>{fill(c.moreRows, { n: rows.length - SHOWN })}</Text> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * Check matches, run and summary (Story 9.7, FLOW-11): the file is compared with what is already in wmbugo before anything is added;
 * each kind of row says what will happen to it, and the person can change that per row or per group. Nothing is added until
 * `Import N entries`. Progress shows with Stop; a stopped or interrupted import can be carried on.
 */
export function ImportRun({
  draft,
  api,
  locale,
  onDone,
  onReview,
  onBusyChange,
  resumeBatchId,
}: {
  draft: ImportDraft | null;
  api: RunApi;
  locale: string;
  onDone: () => void;
  onReview?: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** A paused import to carry on instead of a new one. */
  resumeBatchId?: string;
}) {
  const theme = useTheme();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(resumeBatchId ? { kind: 'importing', done: 0, total: 0, stopping: false } : { kind: 'checking' });
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});
  const cancelled = useRef(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const hooks = {
    onProgress: (done: number, total: number) => {
      if (mounted.current) setPhase((p) => (p.kind === 'importing' ? { ...p, done, total } : p));
    },
    isCancelled: () => cancelled.current,
  };

  const finish = async (r: Awaited<ReturnType<RunApi['run']>>, plan: ImportPlan | null, batchId = '') => {
    running.current = false;
    onBusyChange?.(false);
    if (!mounted.current) return;
    if (r.ok) return setPhase({ kind: 'summary', summary: r.value, plan });
    // A failed run leaves its batch paused: find it so Carry on is offered (Epic 9 review).
    let known = batchId;
    if (known === '' && r.code === 'IMPORT_FAILED') known = await api.paused().then((p) => p?.batchId ?? '').catch(() => '');
    if (!mounted.current) return;
    setPhase({ kind: 'summary', summary: { batchId: known, status: 'paused', rowCount: 0, committedThroughRow: 0, imported: 0, skipped: 0, review: 0, errors: 0 }, failed: r.code, plan });
  };

  // Compare the file with what is there, once.
  useEffect(() => {
    if (resumeBatchId || !draft) return;
    let live = true;
    void api
      .plan(draft)
      .then((plan) => {
        if (!live) return;
        if (plan === null) return onDone();
        setPhase({ kind: 'matches', plan });
      })
      .catch(() => live && onDone());
    return () => {
      live = false;
    };
    // The file is compared once per mount.
  }, []);

  const carryOn = (batchId: string, plan: ImportPlan | null) => {
    if (running.current) return;
    running.current = true;
    cancelled.current = false;
    onBusyChange?.(true);
    setPhase({ kind: 'importing', done: 0, total: 0, stopping: false });
    void api
      .resume(batchId, hooks)
      .then((r) => finish(r, plan, batchId))
      .catch(() => finish({ ok: false, code: 'IMPORT_FAILED' }, plan, batchId));
  };

  useEffect(() => {
    if (resumeBatchId) carryOn(resumeBatchId, null);
    // A resume starts once per mount.
  }, []);

  const start = (plan: ImportPlan) => {
    if (!draft || running.current) return;
    running.current = true;
    cancelled.current = false;
    onBusyChange?.(true);
    setPhase({ kind: 'importing', done: 0, total: plan.rows.length, stopping: false });
    void api
      .run(draft, decisions, hooks)
      .then((r) => finish(r, plan))
      .catch(() => finish({ ok: false, code: 'IMPORT_FAILED' }, plan));
  };

  const grouped = useMemo(() => {
    if (phase.kind !== 'matches') return [];
    return GROUPS.map((g) => ({ g, rows: phase.plan.rows.filter((r) => r.class === g.cls) })).filter((x) => x.rows.length > 0);
  }, [phase]);

  const ink = { color: theme.color('text-primary') };
  const quiet = { color: theme.color('text-secondary') };

  if (phase.kind === 'checking') return <LongTaskLoader message={c.checking} detail={c.checkingDetail} />;

  if (phase.kind === 'importing') {
    return (
      <LongTaskLoader message={phase.total > 0 ? fill(c.importing, { done: phase.done, total: phase.total }) : c.reading} detail={phase.stopping ? c.stopping : c.importingDetail}>
        <Button
          label={c.stop}
          variant="secondary"
          testID="import-stop"
          onPress={() => {
            cancelled.current = true;
            setPhase((p) => (p.kind === 'importing' ? { ...p, stopping: true } : p));
          }}
        />
      </LongTaskLoader>
    );
  }

  if (phase.kind === 'matches') {
    const n = entriesToImport(phase.plan.rows, decisions);
    return (
      <View testID="import-matches" style={styles.block}>
        <Text accessibilityRole="header" style={[textStyle('title'), ink]}>
          {c.matchesTitle}
        </Text>
        <Text style={[textStyle('body'), quiet]}>{c.matchesExplain}</Text>
        {grouped.map(({ g, rows }) => (
          <GroupCard key={g.cls} group={g} rows={rows} decisions={decisions} setDecisions={setDecisions} locale={locale} />
        ))}
        <Button
          label={n === 1 ? c.importEntry : fill(c.importEntries, { n })}
          testID="import-start"
          onPress={() => start(phase.plan)}
          {...(n === 0 ? { disabledReason: c.nothingToAdd } : {})}
        />
        <Button label={c.back} variant="text" onPress={onDone} testID="import-cancel" />
      </View>
    );
  }

  const s = phase.summary;
  const stopped = phase.failed === undefined && s.status === 'paused';
  const failed = phase.failed !== undefined;
  const title = failed ? c.failedTitle : stopped ? c.stoppedTitle : c.finishedTitle;
  const done = s.imported + s.skipped + s.review + s.errors;
  const body = failed ? (phase.failed === 'RAW_COPY_MISSING' || phase.failed === 'FILE_CHANGED' ? c.rawMissing : c.failedBody) : stopped ? fill(c.stoppedBody, { done, total: s.rowCount }) : null;
  const canCarryOn = (stopped || (failed && phase.failed !== 'RAW_COPY_MISSING' && phase.failed !== 'FILE_CHANGED')) && s.batchId !== '';
  const saveRows = async () => {
    if (!draft || !phase.plan) return;
    const ok = await api.saveRows(unreadableRowsCsv(draft, phase.plan)).catch(() => false);
    toast.show({ message: ok ? c.rowsSaved : c.saveRowsFailed });
  };
  return (
    <View testID="import-summary" style={styles.block}>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[textStyle('title'), ink]}>
        {title}
      </Text>
      {body ? <Text style={[textStyle('body'), quiet]}>{body}</Text> : null}
      {!failed ? (
        <View style={styles.list}>
          <Text style={[textStyle('body-medium'), ink]}>{fill(c.summaryAdded, { n: s.imported + s.review })}</Text>
          {s.skipped > 0 ? <Text style={[textStyle('body'), quiet]}>{fill(c.summaryLeftOut, { n: s.skipped })}</Text> : null}
          {s.review > 0 ? <Text style={[textStyle('body'), quiet]}>{fill(c.summaryToCheck, { n: s.review })}</Text> : null}
          {s.errors > 0 ? <Text style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{fill(c.summaryUnreadable, { n: s.errors })}</Text> : null}
        </View>
      ) : null}
      <View style={styles.chips}>
        {canCarryOn ? <Button label={c.resume} testID="import-resume" onPress={() => carryOn(s.batchId, phase.plan)} /> : null}
        {!failed && !stopped && s.review > 0 && onReview ? <Button label={fill(c.reviewThem, { n: s.review })} testID="import-review" onPress={onReview} /> : null}
        {s.errors > 0 && phase.plan ? <Button label={c.saveRows} variant="secondary" testID="import-save-rows" onPress={() => void saveRows()} /> : null}
        <Button label={c.done} variant={canCarryOn || s.review > 0 ? 'secondary' : 'primary'} testID="import-done" onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  list: { gap: 8 },
  listRow: { gap: 6, paddingTop: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1, gap: 2 },
});
