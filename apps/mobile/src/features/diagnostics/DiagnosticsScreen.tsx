import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { statusLines, type DiagnosticsStatus } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { listDiagnosticsSections, listParsers, type ParserEntry } from '../../shared/diagnosticsRegistry';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { CheckRow } from '../../shared/ui/CheckRow';
import { realDiagnosticsApi, type DiagnosticsApi } from './diagnosticsApi';

const UNREADABLE: DiagnosticsStatus = {
  app: null,
  schemaVersion: null,
  storage: { dbBytes: null, photoBytes: null, logBytes: null, freeBytes: null },
  notifications: null,
  biometrics: null,
  appLock: null,
  lastBackup: null,
  crashes: null,
  safeMode: null,
};

/**
 * Settings › Help › Diagnostics (SCR-22, Story 8.10): the technical status, readable without the database. Nothing leaves the phone
 * from here: `Export diagnostics` opens a preview of exactly what would be saved.
 */
export function DiagnosticsScreen({ api = realDiagnosticsApi, onExport }: { api?: DiagnosticsApi; onExport: () => void }) {
  const theme = useTheme();
  const [status, setStatus] = useState<DiagnosticsStatus | null>(null);
  useEffect(() => {
    let live = true;
    // If even the status cannot be collected, every value reads Not available rather than the screen failing.
    void api.status().then(
      (s) => live && setStatus(s),
      () => live && setStatus(UNREADABLE),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  const parsers = listParsers();
  const sections = listDiagnosticsSections();

  return (
    <View style={styles.gap} testID="diagnostics">
      {status === null ? (
        <Text style={[textStyle('body'), muted]}>{copy.diagnostics.loading}</Text>
      ) : (
        <View style={styles.gap} testID="diagnostics-status">
          {statusLines(status).map((line) => {
            const at = line.indexOf(': ');
            const label = line.slice(0, at);
            const value = line.slice(at + 2);
            return (
              <View key={label} accessible accessibilityLabel={`${label}: ${value}`} testID={`diag-${label}`} style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
                <Text style={[textStyle('label'), muted]}>{label}</Text>
                <Text style={[textStyle('body'), ink]}>{value}</Text>
              </View>
            );
          })}
        </View>
      )}
      {sections.map((s) => (
        <View key={s.id} style={styles.gap} testID={`diag-section-${s.id}`}>
          <Text accessibilityRole="header" style={[textStyle('label'), muted]}>
            {s.title}
          </Text>
          {s.render()}
        </View>
      ))}
      {parsers.length > 0 ? (
        <View style={styles.gap} testID="diag-parsers">
          <Text accessibilityRole="header" style={[textStyle('label'), muted]}>
            {copy.diagnostics.parserTitle}
          </Text>
          {parsers.map((p) => (
            <ParserCheck key={p.id} parser={p} />
          ))}
        </View>
      ) : null}
      <Button label={copy.diagnostics.export} testID="diagnostics-export" onPress={onExport} />
    </View>
  );
}

/** Runs a parser on sample text typed here. The sample lives in this component's state only: it is never stored or logged. */
function ParserCheck({ parser }: { parser: ParserEntry }) {
  const theme = useTheme();
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<string | null>(null);
  return (
    <View style={styles.gap}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{parser.label}</Text>
      <TextInput
        testID={`parser-sample-${parser.id}`}
        accessibilityLabel={copy.diagnostics.parserSample}
        value={sample}
        onChangeText={setSample}
        multiline
        style={[styles.input, textStyle('body'), { color: theme.color('text-primary'), borderColor: theme.color('border-control') }]}
      />
      <Button label={copy.diagnostics.parserRun} variant="secondary" testID={`parser-run-${parser.id}`} onPress={() => setResult(parser.run(sample))} />
      {result !== null ? (
        <Text testID={`parser-result-${parser.id}`} accessibilityLabel={`${copy.diagnostics.parserResult}: ${result}`} style={[textStyle('body'), { color: theme.color('text-primary') }]}>
          {result}
        </Text>
      ) : null}
    </View>
  );
}

/** The preview (Story 8.10): the full text that would be exported, a consent checkbox, and Save file only after the tick. */
export function DiagnosticsExportScreen({ api = realDiagnosticsApi }: { api?: DiagnosticsApi }) {
  const theme = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [result, setResult] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    void api.report().then(
      (t) => live && setText(t),
      () => live && setText(statusLines(UNREADABLE).join('\n')),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const save = async () => {
    if (!ok || text === null || saving) return; // export cannot proceed without the tick
    setSaving(true);
    try {
      const r = await api.save(text);
      setResult(r === 'saved' ? 'saved' : r === 'failed' ? 'failed' : 'idle'); // cancelling writes nothing and changes nothing
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.gap} testID="diagnostics-preview">
      <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.diagnostics.previewLead}</Text>
      <ScrollView testID="diagnostics-preview-text" style={[styles.preview, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]} nestedScrollEnabled>
        <Text selectable style={[styles.mono, { color: theme.color('text-primary') }]}>
          {text ?? copy.diagnostics.loading}
        </Text>
      </ScrollView>
      <CheckRow testID="diagnostics-consent" label={copy.diagnostics.consent} checked={ok} onToggle={() => setOk((v) => !v)} />
      {result === 'failed' ? (
        <Text testID="diagnostics-failed" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
          {copy.diagnostics.saveFailed}
        </Text>
      ) : null}
      {result === 'saved' ? (
        <Text testID="diagnostics-saved" accessibilityLiveRegion="polite" style={[textStyle('body'), { color: theme.color('text-primary') }]}>
          {copy.diagnostics.saved}
        </Text>
      ) : null}
      <Button label={copy.diagnostics.save} {...(ok && text !== null ? {} : { disabledReason: copy.diagnostics.disabledReason })} testID="diagnostics-save" onPress={() => void save()} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  row: { borderWidth: 1, borderRadius: radii.md, padding: 12, minHeight: layout.touchMin, gap: 2 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: layout.touchMin * 2 },
  preview: { borderWidth: 1, borderRadius: radii.md, padding: 12, maxHeight: 360 },
  mono: { fontFamily: 'monospace', fontSize: 12, lineHeight: 17 },
});
