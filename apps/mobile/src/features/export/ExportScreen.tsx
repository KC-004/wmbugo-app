import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { defaultPeriodChoice, isLocalDate, type ExportKind, type ExportPeriodChoice } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { LongTaskLoader } from '../../shared/brand/LongTaskLoader';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { groupDigits } from '../../shared/groupDigits';
import { requireReauth } from '../../shared/reauth';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { CheckRow } from '../../shared/ui/CheckRow';
import { Chip } from '../../shared/ui/Chip';
import { realExportApi, type ExportApi, type ExportContext, type ExportOutcome } from './exportApi';

const e = copy.exportCsv;
const PERIODS: readonly { v: ExportPeriodChoice; label: string }[] = [
  { v: 'this_period', label: e.pThis },
  { v: 'last_period', label: e.pLast },
  { v: 'this_year', label: e.pYear },
  { v: 'all_time', label: e.pAll },
  { v: 'custom', label: e.pCustom },
];

/** The toast after a saved export. */
export function exportedText(kind: ExportKind, count: number): string {
  if (kind === 'transactions') return count === 1 ? e.exportedEntry : e.exportedEntries.replace('{n}', groupDigits(count));
  return count === 1 ? e.exportedAccount : e.exportedAccounts.replace('{n}', groupDigits(count));
}

/**
 * Export CSV (Story 9.9, EXP-001): choose what, which period and which accounts, confirm that the file will not be encrypted (with
 * app lock on, `Confirm it's you` first), pick where to save it, and watch it write. Cancelling at any step writes nothing, and a
 * Cancel while writing deletes the partial file.
 */
export function ExportScreen({ api = realExportApi, initialKind = 'transactions', initialChoice, onBusyChange }: { api?: ExportApi; initialKind?: ExportKind; initialChoice?: ExportPeriodChoice; onBusyChange?: (busy: boolean) => void }) {
  const theme = useTheme();
  const toast = useToast();
  const sheet = useSheet();
  const { fontScale } = useWindowDimensions();
  const [ctx, setCtx] = useState<ExportContext | null>(null);
  const [kind, setKind] = useState<ExportKind>(initialKind);
  const [choice, setChoice] = useState<ExportPeriodChoice>(initialChoice ?? defaultPeriodChoice(initialKind));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [numbers, setNumbers] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const cancelled = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    void api
      .context()
      .then((c) => live && setCtx(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  const chooseKind = (k: ExportKind) => {
    setKind(k);
    setChoice(defaultPeriodChoice(k));
    setProblem(null);
  };

  const start = async () => {
    setFailed(false);
    const start0 = from.trim();
    const end0 = to.trim();
    if (choice === 'custom' && (!isLocalDate(start0) || !isLocalDate(end0) || start0 > end0)) return setProblem(e.rangeInvalid);
    if (!all && picked.length === 0) return setProblem(e.noAccountsChosen);
    setProblem(null);
    sheet.open({
      id: 'export-confirm',
      title: e.confirmTitle,
      body: (close) => (
        <View style={styles.sheet}>
          <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{kind === 'transactions' ? e.confirmBody : e.confirmBodyAccounts}</Text>
          <Button
            label={e.confirmExport}
            testID="export-confirm"
            onPress={() => {
              close();
              void go();
            }}
          />
          <Button label={e.confirmCancel} variant="text" onPress={close} testID="export-confirm-cancel" />
        </View>
      ),
    });
  };

  const go = async () => {
    // One export at a time: a second tap while `Confirm it's you` is open must not start another (Epic 9 review).
    if (busy.current) return;
    busy.current = true;
    // Decrypted data leaves wmbugo's control: with app lock on the person proves it is them first. If they left the screen meanwhile,
    // nothing is written.
    const proven = await requireReauth().catch(() => false);
    if (!proven || !mounted.current) {
      busy.current = false;
      return;
    }
    cancelled.current = false;
    setRun({ done: 0, total: 0 });
    onBusyChange?.(true);
    let outcome: ExportOutcome;
    try {
      outcome = await api.run(
        { kind, choice, ...(choice === 'custom' ? { custom: { start: from.trim(), end: to.trim() } } : {}), accountIds: all ? null : picked, includeNumbers: numbers },
        {
          onProgress: (done, total) => mounted.current && setRun({ done, total }),
          isCancelled: () => cancelled.current,
        },
      );
    } catch {
      outcome = { kind: 'failed' };
    }
    busy.current = false;
    onBusyChange?.(false);
    if (!mounted.current) return;
    setRun(null);
    if (outcome.kind === 'saved') toast.show({ message: exportedText(outcome.export, outcome.count) });
    else if (outcome.kind === 'cancelled') toast.show({ message: e.cancelled });
    else if (outcome.kind === 'invalid_period') setProblem(outcome.code === 'NO_PERIOD' ? e.noPrevious : e.rangeInvalid);
    else if (outcome.kind === 'failed') setFailed(true);
  };

  if (run) {
    return (
      <LongTaskLoader message={e.exporting} detail={run.total > 0 && kind === 'transactions' ? e.exportingCount.replace('{done}', groupDigits(run.done)).replace('{total}', groupDigits(run.total)) : undefined}>
        <Button label={e.cancel} variant="secondary" testID="export-cancel" onPress={() => (cancelled.current = true)} />
      </LongTaskLoader>
    );
  }
  if (!ctx) return <View testID="export-loading" />;

  const quiet = { color: theme.color('text-secondary') };
  const label = (t: string) => (
    <Text accessibilityRole="header" style={[textStyle('label'), quiet]}>
      {t}
    </Text>
  );
  const input = (value: string, onChange: (v: string) => void, testID: string, name: string) => (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChange}
      placeholder={e.dateHint}
      placeholderTextColor={theme.color('text-secondary')}
      keyboardType="numbers-and-punctuation"
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={name}
      style={[textStyle('body'), styles.input, { color: theme.color('text-primary'), borderColor: theme.color('border-hairline'), backgroundColor: theme.color('bg-surface') }]}
    />
  );
  const switchA11y = controlA11y({ label: e.includeNumbers, role: 'switch', checked: numbers });

  return (
    <View testID="export-screen" style={styles.block}>
      {label(e.whatLabel)}
      <View style={styles.chips}>
        <Chip role="radio" variant="period" label={e.optTransactions} selected={kind === 'transactions'} onPress={() => chooseKind('transactions')} testID="export-kind-transactions" />
        <Chip role="radio" variant="period" label={e.optAccounts} selected={kind === 'accounts'} onPress={() => chooseKind('accounts')} testID="export-kind-accounts" />
      </View>

      {label(e.periodLabel)}
      <View style={styles.chips}>
        {PERIODS.map((p) => (
          <Chip key={p.v} role="radio" variant="period" label={p.label} selected={choice === p.v} onPress={() => setChoice(p.v)} testID={'export-period-' + p.v} />
        ))}
      </View>
      {choice === 'custom' ? (
        <View style={[styles.dates, fontScale >= 1.3 && styles.stack]}>
          {input(from, setFrom, 'export-from', e.fromLabel)}
          {input(to, setTo, 'export-to', e.toLabel)}
        </View>
      ) : null}

      {label(e.accountsLabel)}
      <CheckRow label={e.allAccounts} checked={all} onToggle={() => setAll((v) => !v)} testID="export-all-accounts" />
      {!all
        ? ctx.accounts.map((a) => (
            <CheckRow
              key={a.id}
              label={a.archived ? `${a.name} · ${e.archived}` : a.name}
              checked={picked.includes(a.id)}
              onToggle={() => setPicked((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]))}
              testID={'export-account-' + a.id}
            />
          ))
        : null}

      <View style={styles.switchRow}>
        <Text style={[textStyle('body'), styles.switchText, { color: theme.color('text-primary') }]}>{e.includeNumbers}</Text>
        <Switch testID="export-numbers" value={numbers} onValueChange={setNumbers} {...switchA11y} />
      </View>

      {problem ? (
        <Text accessibilityRole="alert" testID="export-problem" style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>
          {problem}
        </Text>
      ) : null}
      {failed ? (
        <View style={styles.block} testID="export-failed">
          <Text accessibilityRole="alert" style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>
            {e.saveFailed}
          </Text>
          <Button label={e.tryAgain} variant="secondary" testID="export-retry" onPress={() => void start()} />
        </View>
      ) : null}
      <Button label={e.exportButton} testID="export-button" onPress={() => void start()} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  sheet: { gap: 12, padding: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  dates: { flexDirection: 'row', gap: 12 },
  stack: { flexDirection: 'column' },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  switchText: { flex: 1 },
});
