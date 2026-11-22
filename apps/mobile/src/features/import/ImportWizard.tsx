import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { headerSignature, withRole, refreshFormats, type CsvAccountChoice, type CsvMapping, type CsvReadResult, type CsvRole, type DateFormat, type SavedCsvFormat, type CurrencyCode } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { LongTaskLoader } from '../../shared/brand/LongTaskLoader';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { CheckRow } from '../../shared/ui/CheckRow';
import { Chip } from '../../shared/ui/Chip';
import { StepperHeader } from '../../shared/ui/StepperHeader';
import { realImportApi, type ImportApi, type ImportContext } from './importApi';
import { check, columnNames, guess, needsReread, overridesOf, READ_ERROR_COPY, readWith, sampleOf, type ImportDraft, type ReadOverrides } from './importModel';

type Phase = 'choose' | 'reading' | 'columns' | 'preview';

interface Loaded {
  readonly bytes: Uint8Array;
  readonly read: CsvReadResult;
  readonly overrides: ReadOverrides;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));
const DELIMITERS: readonly { v: string; label: string }[] = [
  { v: ',', label: copy.csvImport.delimiterComma },
  { v: ';', label: copy.csvImport.delimiterSemicolon },
  { v: '\t', label: copy.csvImport.delimiterTab },
];
const ENCODINGS = ['UTF-8', 'Windows-1252', 'ISO-8859-1', 'UTF-16LE', 'UTF-16BE'] as const;
const DATE_ORDER: readonly { v: DateFormat; label: string }[] = [
  { v: 'DD/MM/YYYY', label: copy.csvImport.dayFirst },
  { v: 'MM/DD/YYYY', label: copy.csvImport.monthFirst },
];
const delimiterWord = (d: string) => (DELIMITERS.find((x) => x.v === d)?.label ?? d).toLowerCase();

/** A pressable line with a label and a value under it: the Columns step's rows. */
function PickRow({ label, value, onPress, testID }: { label: string; value: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const a11y = controlA11y({ label: `${label}, ${value}`, role: 'button' });
  return (
    <Pressable testID={testID} {...a11y} onPress={onPress} style={[styles.pick, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{label}</Text>
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{value}</Text>
    </Pressable>
  );
}

/** The File settings sheet: the encoding, the separator and whether the first row is headings. Applies when Done is pressed. */
function FileSettingsBody({ read, overrides, onApply }: { read: CsvReadResult; overrides: ReadOverrides; onApply: (o: ReadOverrides) => void }) {
  const theme = useTheme();
  const [encoding, setEncoding] = useState<string>(overrides.encoding ?? read.encoding.value);
  const [delimiter, setDelimiter] = useState<string>(overrides.delimiter ?? read.delimiter.value);
  const [headings, setHeadings] = useState<boolean>(overrides.noHeader === true ? false : read.headerRow.value !== null);
  const label = (t: string) => <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{t}</Text>;
  return (
    <View style={styles.sheet}>
      {label(copy.csvImport.encodingLabel)}
      <View style={styles.chips}>
        {ENCODINGS.map((e) => (
          <Chip key={e} role="radio" label={e} selected={encoding === e} onPress={() => setEncoding(e)} testID={'import-encoding-' + e} />
        ))}
      </View>
      {label(copy.csvImport.delimiterLabel)}
      <View style={styles.chips}>
        {DELIMITERS.map((d) => (
          <Chip key={d.v} role="radio" label={d.label} selected={delimiter === d.v} onPress={() => setDelimiter(d.v)} testID={'import-delimiter-' + d.label} />
        ))}
      </View>
      {label(copy.csvImport.headingsLabel)}
      <View style={styles.chips}>
        <Chip role="radio" label={copy.csvImport.headingsYes} selected={headings} onPress={() => setHeadings(true)} testID="import-headings-yes" />
        <Chip role="radio" label={copy.csvImport.headingsNo} selected={!headings} onPress={() => setHeadings(false)} testID="import-headings-no" />
      </View>
      <Button
        label={copy.csvImport.done}
        testID="import-settings-done"
        onPress={() => onApply({ encoding, delimiter, ...(headings ? (read.headerRow.value !== null ? { headerRow: read.headerRow.value } : { headerRow: 0 }) : { noHeader: true }) })}
      />
    </View>
  );
}

/** Which of the user's accounts each name in the file's account column means, or `Don't import these rows`. */
function AccountMapper({ values, accounts, choice, onChange }: { values: readonly string[]; accounts: ImportContext['accounts']; choice: CsvAccountChoice | null; onChange: (c: CsvAccountChoice) => void }) {
  const theme = useTheme();
  const map = choice?.kind === 'column' ? choice.map : {};
  const set = (value: string, id: string | null) => onChange({ kind: 'column', map: { ...map, [value]: id } });
  return (
    <View style={styles.block}>
      <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.csvImport.accountColumnExplain}</Text>
      {values.slice(0, 20).map((v) => (
        <View key={v} style={styles.block}>
          <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{v === '' ? copy.csvImport.accountValueEmpty : v}</Text>
          <View style={styles.chips}>
            {accounts.map((a) => (
              <Chip key={a.id} role="radio" label={a.name} selected={map[v] === a.id} onPress={() => set(v, a.id)} testID={`import-map-${v}-${a.id}`} />
            ))}
            <Chip role="radio" label={copy.csvImport.dontImport} selected={map[v] === null} onPress={() => set(v, null)} testID={`import-map-${v}-none`} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The import wizard's first three steps (Story 9.6, FLOW-11): choose a file, check the columns, preview. A file whose headings match a
 * saved layout skips the middle step. Nothing is written until the person goes on: `onContinue` hands the draft to the next screens.
 */
export function ImportWizard({ api = realImportApi, onContinue, onBusyChange }: { api?: ImportApi; onContinue: (draft: ImportDraft) => void; onBusyChange?: (busy: boolean) => void }) {
  const theme = useTheme();
  const sheet = useSheet();
  const { fontScale } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>('choose');
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ImportContext | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [choice, setChoice] = useState<CsvAccountChoice | null>(null);
  const [saved, setSaved] = useState<SavedCsvFormat | null>(null);
  const [remember, setRemember] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const profile = useMemo(() => (ctx ? { currency: ctx.currency, timezoneId: ctx.timezoneId } : null), [ctx]);
  const checked = useMemo(() => (loaded && mapping && profile ? check(loaded.read, mapping, profile, choice) : null), [loaded, mapping, profile, choice]);

  const total = saved ? 2 : 3;
  const step = phase === 'choose' || phase === 'reading' ? 1 : phase === 'columns' ? 2 : total;
  const title = phase === 'preview' ? copy.csvImport.stepPreview : phase === 'columns' ? copy.csvImport.stepColumns : copy.csvImport.stepChoose;

  const fail = (message: string) => {
    setError(message);
    setPhase('choose');
    onBusyChange?.(false);
  };

  const choose = async () => {
    setError(null);
    let picked;
    try {
      picked = await api.pick();
    } catch {
      return fail(copy.csvImport.readFailed);
    }
    if (picked === null || !mounted.current) return;
    setPhase('reading');
    onBusyChange?.(true);
    await nextFrame();
    try {
      const c = await api.context();
      if (!c) return fail(copy.csvImport.noProfile);
      if (c.accounts.length === 0) return fail(copy.csvImport.noAccounts);
      if (picked.bytes.length === 0 && picked.size > 0) return fail(copy.csvImport.tooLarge);
      let read = readWith(picked.bytes, {});
      if (!read.ok) return fail(READ_ERROR_COPY[read.code]);
      let overrides: ReadOverrides = {};
      let match = await api.savedFormat(read.value).catch(() => null);
      if (match && needsReread(read.value, match)) {
        const again = readWith(picked.bytes, match.overrides);
        if (again.ok) {
          read = again;
          overrides = match.overrides;
        } else match = null;
      }
      if (!mounted.current) return;
      setCtx(c);
      setLoaded({ bytes: picked.bytes, read: read.value, overrides });
      setSaved(match);
      setRemember(false);
      setShowBlock(false);
      setMapping(match ? match.mapping : guess(read.value));
      setChoice(match?.account ?? (c.accounts.length === 1 ? { kind: 'single', accountId: c.accounts[0]!.id } : null));
      setPhase(match ? 'preview' : 'columns');
      onBusyChange?.(false);
    } catch {
      fail(copy.csvImport.readFailed);
    }
  };

  const reread = (overrides: ReadOverrides) => {
    if (!loaded) return;
    const r = readWith(loaded.bytes, overrides);
    if (!r.ok) {
      setError(READ_ERROR_COPY[r.code]);
      return;
    }
    setError(null);
    setLoaded({ ...loaded, read: r.value, overrides });
    setMapping(guess(r.value));
    setSaved(null);
  };

  const setRole = (role: CsvRole, column: number | null) => {
    if (!mapping || !loaded) return;
    setMapping(refreshFormats(withRole(mapping, role, column), loaded.read.sample));
    setShowBlock(false);
  };

  const openColumnPicker = (role: CsvRole, roleLabel: string) => {
    if (!loaded || !mapping) return;
    const names = columnNames(loaded.read);
    sheet.open({
      id: 'import-column-' + role,
      title: copy.csvImport.pickColumn.replace('{role}', roleLabel.toLowerCase()),
      body: (close) => (
        <View style={styles.sheet}>
          <View style={styles.chips}>
            {names.map((n, i) => (
              <Chip
                key={i}
                role="radio"
                label={sampleOf(loaded.read, i) ? `${n} (${sampleOf(loaded.read, i)})` : n}
                selected={mapping.columns[role] === i}
                onPress={() => {
                  setRole(role, i);
                  close();
                }}
                testID={`import-col-${role}-${i}`}
              />
            ))}
            <Chip
              role="radio"
              label={copy.csvImport.notInFile}
              selected={mapping.columns[role] === undefined}
              onPress={() => {
                setRole(role, null);
                close();
              }}
              testID={`import-col-${role}-none`}
            />
          </View>
        </View>
      ),
    });
  };

  const openSettings = () => {
    if (!loaded) return;
    sheet.open({
      id: 'import-file-settings',
      title: copy.csvImport.fileSettings,
      body: (close) => (
        <FileSettingsBody
          read={loaded.read}
          overrides={loaded.overrides}
          onApply={(o) => {
            close();
            reread(o);
          }}
        />
      ),
    });
  };

  const goNext = () => {
    if (!checked || checked.block) {
      setShowBlock(true);
      return;
    }
    setShowBlock(false);
    setPhase('preview');
  };

  const goOn = async () => {
    if (!loaded || !mapping || !checked || !ctx || !choice) return;
    if (checked.validation.okCount === 0) return;
    const finalChoice = checked.block === null && (mapping.columns.account !== undefined ? choice.kind === 'column' : choice.kind === 'single') ? choice : null;
    if (!finalChoice) return;
    if (remember) {
      const accountName = finalChoice.kind === 'single' ? ctx.accounts.find((a) => a.id === finalChoice.accountId)?.name : undefined;
      // Remembering the layout is a convenience: if it fails the import still goes on, and the Columns step runs again next time.
      await api
        .saveFormat({ name: accountName ?? copy.csvImport.title, headerSignature: signatureOf(loaded.read), mapping, overrides: overridesOf(loaded.read), account: finalChoice })
        .catch(() => undefined);
    }
    onContinue({ bytes: loaded.bytes, read: loaded.read, mapping, choice: finalChoice, overrides: overridesOf(loaded.read), validation: checked.validation });
  };

  const back = () => {
    setError(null);
    const toColumns = phase === 'preview' && !saved;
    if (!toColumns) setSaved(null);
    setPhase(toColumns ? 'columns' : 'choose');
  };

  const ink = { color: theme.color('text-primary') };
  const quiet = { color: theme.color('text-secondary') };

  if (phase === 'reading') {
    return (
      <View testID="import-reading">
        <StepperHeader step={1} total={total} title={copy.csvImport.stepChoose} />
        <LongTaskLoader message={copy.csvImport.reading} detail={copy.csvImport.readingDetail} />
      </View>
    );
  }

  return (
    <View testID="import-wizard" style={styles.block}>
      <StepperHeader step={step} total={total} title={title} />

      {phase === 'choose' ? (
        <View style={styles.block}>
          <Text style={[textStyle('body'), quiet]}>{copy.csvImport.chooseExplain}</Text>
          {error ? (
            <Text accessibilityRole="alert" testID="import-error" style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>
              {error}
            </Text>
          ) : null}
          <Button label={copy.csvImport.chooseButton} onPress={() => void choose()} testID="import-choose" />
        </View>
      ) : null}

      {phase === 'columns' && loaded && mapping && ctx && checked ? (
        <View style={styles.block}>
          <Text style={[textStyle('body'), quiet]}>{copy.csvImport.columnsExplain}</Text>
          <PickRow
            testID="import-file-settings"
            label={copy.csvImport.fileSettings}
            value={copy.csvImport.fileSettingsSummary.replace('{encoding}', loaded.read.encoding.value).replace('{delimiter}', delimiterWord(loaded.read.delimiter.value))}
            onPress={openSettings}
          />
          {error ? (
            <Text accessibilityRole="alert" testID="import-error" style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>
              {error}
            </Text>
          ) : null}
          {(
            [
              ['date', copy.csvImport.roleDate],
              ['description', copy.csvImport.roleDescription],
              ['amount', copy.csvImport.roleAmount],
              ['debit', copy.csvImport.roleDebit],
              ['credit', copy.csvImport.roleCredit],
              ['category', copy.csvImport.roleCategory],
              ['reference', copy.csvImport.roleReference],
              ['currency', copy.csvImport.roleCurrency],
              ['balance', copy.csvImport.roleBalance],
              ['account', copy.csvImport.roleAccount],
            ] as const
          ).map(([role, label]) => {
            const i = mapping.columns[role];
            return <PickRow key={role} testID={'import-role-' + role} label={label} value={i === undefined ? copy.csvImport.notInFile : columnNames(loaded.read)[i] ?? copy.csvImport.notInFile} onPress={() => openColumnPicker(role, label)} />;
          })}

          {mapping.columns.date !== undefined && mapping.dateCandidates.length > 1 ? (
            <View style={styles.block} testID="import-date-order">
              <Text style={[textStyle('label'), quiet]}>{copy.csvImport.dateOrder}</Text>
              <View style={[styles.chips, fontScale >= 1.3 && styles.stack]}>
                {DATE_ORDER.filter((o) => mapping.dateCandidates.includes(o.v)).map((o) => (
                  <Chip key={o.v} role="radio" label={o.label} selected={mapping.dateFormat === o.v} onPress={() => setMapping({ ...mapping, dateFormat: o.v })} testID={'import-date-' + o.v} />
                ))}
              </View>
            </View>
          ) : null}

          {mapping.columns.account !== undefined ? (
            <AccountMapper values={checked.validation.accountValues} accounts={ctx.accounts} choice={choice} onChange={setChoice} />
          ) : (
            <View style={styles.block} testID="import-account">
              <Text style={[textStyle('label'), quiet]}>{copy.csvImport.whichAccount}</Text>
              <View style={styles.chips}>
                {ctx.accounts.map((a) => (
                  <Chip key={a.id} role="radio" label={a.name} selected={choice?.kind === 'single' && choice.accountId === a.id} onPress={() => setChoice({ kind: 'single', accountId: a.id })} testID={'import-account-' + a.id} />
                ))}
              </View>
            </View>
          )}

          {showBlock && checked.block ? (
            <Text accessibilityRole="alert" testID="import-block" style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>
              {checked.block.message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button label={copy.csvImport.back} variant="text" onPress={back} testID="import-back" />
            <Button label={copy.csvImport.next} onPress={goNext} testID="import-next" />
          </View>
        </View>
      ) : null}

      {phase === 'preview' && loaded && mapping && ctx && checked ? (
        <View style={styles.block}>
          {saved ? <Text testID="import-saved" style={[textStyle('body'), quiet]}>{copy.csvImport.savedLayout}</Text> : null}
          <Text style={[textStyle('body'), quiet]}>{copy.csvImport.previewExplain}</Text>
          <View testID="import-counts" style={styles.block}>
            <Text style={[textStyle('body-medium'), ink]}>{checked.validation.okCount === 1 ? copy.csvImport.readyOne : copy.csvImport.ready.replace('{n}', String(checked.validation.okCount))}</Text>
            {checked.validation.errorCount > 0 ? (
              <Text style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
                {checked.validation.errorCount === 1 ? copy.csvImport.cantReadOne : copy.csvImport.cantRead.replace('{n}', String(checked.validation.errorCount))}
              </Text>
            ) : null}
            {checked.validation.skippedCount > 0 ? (
              <Text style={[textStyle('body'), quiet]}>
                {checked.validation.skippedCount === 1 ? copy.csvImport.skippedRowOne : copy.csvImport.skippedRows.replace('{n}', String(checked.validation.skippedCount))}
              </Text>
            ) : null}
          </View>

          {checked.validation.warning === 'SIGN_LOOKS_REVERSED' ? (
            <View testID="import-reversed" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
              <Text style={[textStyle('body-medium'), ink]}>{copy.csvImport.reversed}</Text>
              <Button label={copy.csvImport.flipSign} variant="secondary" onPress={() => setMapping({ ...mapping, flipSign: !mapping.flipSign })} testID="import-flip" />
            </View>
          ) : null}
          {checked.validation.warning === 'SIGN_CONFIRMED' ? <Text testID="import-sign-ok" style={[textStyle('caption'), quiet]}>{copy.csvImport.signConfirmed}</Text> : null}
          {mapping.flipSign && checked.validation.warning !== 'SIGN_LOOKS_REVERSED' ? (
            <Button label={copy.csvImport.flipBack} variant="text" onPress={() => setMapping({ ...mapping, flipSign: false })} testID="import-flip-back" />
          ) : null}

          <View testID="import-preview" style={styles.block}>
            {checked.validation.rows
              .filter((r) => r.candidate !== null && !r.skipped)
              .slice(0, 5)
              .map((r) => (
                <View key={r.row} style={[styles.previewRow, { borderColor: theme.color('border-hairline') }]}>
                  <View style={styles.rowText}>
                    <Text style={[textStyle('body-medium'), ink]}>{r.candidate!.merchant || r.candidate!.description}</Text>
                    <Text style={[textStyle('caption'), quiet]}>{r.candidate!.localDate}</Text>
                  </View>
                  <Amount amountMinor={r.candidate!.amountMinor} currency={r.candidate!.currency as CurrencyCode} direction={r.candidate!.direction === 'out' ? 'expense' : 'income'} locale={ctx.locale} testID={'import-amount-' + r.row} />
                </View>
              ))}
          </View>

          <CheckRow label={copy.csvImport.saveLayout} checked={remember} onToggle={() => setRemember((v) => !v)} testID="import-remember" />
          {checked.validation.okCount === 0 ? <Text testID="import-nothing" style={[textStyle('body-medium'), { color: theme.color('semantic-warning') }]}>{copy.csvImport.nothingToImport}</Text> : null}
          <View style={styles.actions}>
            <Button label={copy.csvImport.back} variant="text" onPress={back} testID="import-back" />
            <Button
              label={copy.csvImport.checkMatches}
              onPress={() => void goOn()}
              testID="import-check-matches"
              {...(checked.validation.okCount === 0 ? { disabledReason: copy.csvImport.nothingToImport } : {})}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const signatureOf = (read: CsvReadResult) => headerSignature(read.header, read.delimiter.value);

const styles = StyleSheet.create({
  block: { gap: 12 },
  sheet: { gap: 12, padding: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stack: { flexDirection: 'column' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  pick: { borderWidth: 1, borderRadius: radii.md, padding: 12, minHeight: 56, gap: 2, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  rowText: { flex: 1, gap: 2 },
});
