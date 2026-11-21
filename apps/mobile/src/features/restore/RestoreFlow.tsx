import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'phosphor-react-native';
import { backupCountsLine, madeAtLabel, type BackupManifest } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { requireReauth } from '../../shared/reauth';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { PassphraseField } from '../../shared/ui/PassphraseField';
import { BackupScreen } from '../backup/BackupScreen';
import { realRestoreApi, type PickedBackup, type RestoreApi, type ThisPhone } from './restoreApi';

type Step =
  | { kind: 'picking' }
  | { kind: 'refused'; message: string }
  | { kind: 'passphrase' }
  | { kind: 'checking' }
  | { kind: 'confirm'; manifest: BackupManifest; phone: ThisPhone | null; lowSpace: boolean; timezoneId: string }
  | { kind: 'backup-first'; manifest: BackupManifest; phone: ThisPhone | null; lowSpace: boolean; timezoneId: string }
  | { kind: 'restoring' }
  | { kind: 'failed'; message: string };

/**
 * Restore from a backup (Story 8.9, FLOW-10): pick a file, open it with its passphrase, see what is in it next to what is on this
 * phone, tick the checkbox, restore. Nothing is replaced before the last tap, and every refusal says `Nothing on this phone changed.`
 * The same flow serves Settings › Data and the Welcome screen.
 */
export function RestoreFlow({ api = realRestoreApi, onExit, onBusyChange }: { api?: RestoreApi; onExit: () => void; onBusyChange?: (busy: boolean) => void }) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>({ kind: 'picking' });
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [withoutCopy, setWithoutCopy] = useState(false);
  const picked = useRef<PickedBackup | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const started = useRef(false);

  const release = () => {
    const p = picked.current;
    picked.current = null;
    if (p) void p.close().catch(() => undefined);
  };
  useEffect(() => release, []);

  // Opening the flow opens the system file picker at once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const file = await api.pick();
        if (file === null) return onExit();
        picked.current = file;
        const head = await api.inspect(file.source);
        if (!head.ok) {
          release();
          return setStep({ kind: 'refused', message: head.code === 'FILE_TOO_LARGE' ? copy.restore.tooLarge : copy.restore.notBackup });
        }
        setStep({ kind: 'passphrase' });
      } catch {
        setStep({ kind: 'refused', message: copy.restore.notBackup });
      }
    })();
  }, [api, onExit]);

  const open = async () => {
    const file = picked.current;
    if (!file || pass.length === 0) return;
    setWrong(false);
    setStep({ kind: 'checking' });
    try {
      const r = await api.openManifest(file.source, pass);
      if (!r.ok) {
        if (r.code === 'WRONG_PASSPHRASE') {
          // The field keeps its content and takes focus again.
          setWrong(true);
          setStep({ kind: 'passphrase' });
          setFocusTick((n) => n + 1);
          return;
        }
        release();
        return setStep({ kind: 'refused', message: r.code === 'BACKUP_TOO_NEW' ? copy.restore.tooNew : r.code === 'NOT_A_WMBUGO_BACKUP' ? copy.restore.notBackup : copy.restore.damaged });
      }
      const [phone, lowSpace, timezoneId] = await Promise.all([api.thisPhone(), api.lowSpace(), api.timezoneId()]);
      setUnderstood(false);
      setWithoutCopy(false);
      setStep({ kind: 'confirm', manifest: r.value, phone, lowSpace, timezoneId });
    } catch {
      release();
      setStep({ kind: 'refused', message: copy.restore.damaged });
    }
  };

  const restore = async (c: Extract<Step, { kind: 'confirm' }>) => {
    const file = picked.current;
    if (!file) return;
    // With app lock on, the shared guard asks `Confirm it's you`; cancelling keeps the confirmation as it was.
    if (!(await requireReauth())) return;
    onBusyChange?.(true);
    setStep({ kind: 'restoring' });
    try {
      const r = await api.restore(file.source, pass, { withoutSafetyCopy: c.lowSpace && withoutCopy });
      if (r.ok) {
        await api.finish(r.value.manifest);
        return;
      }
      onBusyChange?.(false);
      if (r.code === 'LOW_SPACE_NEEDS_CONFIRMATION') return setStep({ ...c, lowSpace: true });
      release();
      setStep({ kind: 'failed', message: r.code === 'BACKUP_TOO_NEW' ? copy.restore.tooNew : r.code === 'RESTORE_FAILED' ? copy.restore.failed : copy.restore.damaged });
    } catch {
      onBusyChange?.(false);
      release();
      setStep({ kind: 'failed', message: copy.restore.failed });
    }
  };

  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };

  if (step.kind === 'picking') return <View testID="restore-picking" />;

  if (step.kind === 'refused' || step.kind === 'failed') {
    return (
      <View style={styles.gap} testID="restore-refused">
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), ink]} testID="restore-message">
          {step.message}
        </Text>
        <Button label={copy.restore.close} testID="restore-close" onPress={onExit} />
      </View>
    );
  }

  if (step.kind === 'checking' || step.kind === 'restoring') {
    return (
      <View style={styles.gap} testID={step.kind === 'checking' ? 'restore-checking' : 'restore-running'}>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[textStyle('title'), ink]}>
          {step.kind === 'checking' ? copy.restore.checking : copy.restore.restoring}
        </Text>
      </View>
    );
  }

  if (step.kind === 'passphrase') {
    return (
      <View style={styles.gap} testID="restore-passphrase">
        <PassphraseField
          label={copy.restore.passphrase}
          value={pass}
          onChangeText={(t) => {
            setPass(t);
            setWrong(false);
          }}
          show={show}
          onToggleShow={() => setShow((s) => !s)}
          autoComplete="password"
          invalid={wrong}
          focusSignal={focusTick}
          testID="restore-pass"
        />
        {wrong ? (
          <Text testID="restore-wrong" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
            {copy.restore.wrongPassphrase}
          </Text>
        ) : null}
        <Button label={copy.restore.open} {...(pass.length === 0 ? { disabledReason: copy.restore.passphrase } : {})} testID="restore-open" onPress={() => void open()} />
      </View>
    );
  }

  if (step.kind === 'backup-first') {
    const back = step;
    return (
      <View style={styles.gap} testID="restore-backup-first">
        <BackupScreen onDone={() => setStep({ ...back, kind: 'confirm' })} />
        <Button label={copy.restore.back} variant="text" testID="restore-backup-back" onPress={() => setStep({ ...back, kind: 'confirm' })} />
      </View>
    );
  }

  const c = step;
  const ready = understood && (!c.lowSpace || withoutCopy);
  return (
    <View style={styles.gap} testID="restore-confirm">
      <View style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]} testID="restore-preview">
        <View accessible style={styles.col} testID="restore-preview-backup">
          <Text style={[textStyle('label'), muted]}>{copy.restore.backupHeading}</Text>
          <Text style={[textStyle('body-medium'), ink]}>{copy.restore.made.replace('{when}', madeAtLabel(c.manifest.createdAt.utcMs, c.timezoneId))}</Text>
          <Text style={[textStyle('body'), ink]}>{backupCountsLine(c.manifest.counts)}</Text>
        </View>
        <View accessible style={styles.col} testID="restore-preview-phone">
          <Text style={[textStyle('label'), muted]}>{copy.restore.phoneHeading}</Text>
          <Text style={[textStyle('body'), ink]}>{c.phone ? backupCountsLine(c.phone) : copy.restore.nothingYet}</Text>
        </View>
      </View>
      <Text style={[textStyle('body'), ink]}>{copy.restore.safe}</Text>
      {c.phone ? <Button label={copy.restore.backupFirst} variant="text" testID="restore-backup-first-link" onPress={() => setStep({ ...c, kind: 'backup-first' })} /> : null}
      <CheckRow testID="restore-understand" label={copy.restore.understand} checked={understood} onToggle={() => setUnderstood((v) => !v)} />
      {c.lowSpace ? (
        <View style={styles.gap}>
          <Text testID="restore-no-room" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
            {copy.restore.noRoom}
          </Text>
          <CheckRow testID="restore-without-copy" label={copy.restore.withoutCopy} checked={withoutCopy} onToggle={() => setWithoutCopy((v) => !v)} />
        </View>
      ) : null}
      <Button label={copy.restore.restore} {...(ready ? {} : { disabledReason: c.lowSpace ? copy.restore.disabledReasonBoth : copy.restore.disabledReason })} testID="restore-go" onPress={() => void restore(c)} />
      <Button label={copy.restore.close} variant="text" testID="restore-cancel" onPress={onExit} />
    </View>
  );
}

function CheckRow({ label, checked, onToggle, testID }: { label: string; checked: boolean; onToggle: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={[styles.check, { borderColor: theme.color('border-control'), backgroundColor: theme.color('bg-surface') }]}>
      <View style={[styles.box, { borderColor: theme.color(checked ? 'accent-primary' : 'border-control'), backgroundColor: checked ? theme.color('accent-primary') : 'transparent' }]}>
        {checked ? <Icon icon={Check} size={16} color="bg-surface" /> : null}
      </View>
      <Text style={[textStyle('body'), { color: theme.color('text-primary'), flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 16 },
  col: { gap: 2 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radii.md, padding: 12, minHeight: layout.touchMin },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
