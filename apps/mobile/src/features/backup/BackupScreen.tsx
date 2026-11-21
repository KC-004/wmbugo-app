import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CheckCircle, Info, Warning } from 'phosphor-react-native';
import { backupCountsLine, checkPassphrase, type BackupDone } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { PassphraseField } from '../../shared/ui/PassphraseField';
import { realBackupApi, type BackupApi } from './backupApi';

type Phase = { kind: 'form' } | { kind: 'running'; fraction: number } | { kind: 'done'; done: BackupDone } | { kind: 'failed' };

/**
 * Settings › Data › Back up (SCR-20, Story 8.7). The passphrase is chosen here and typed twice; Save backup opens Android's own
 * save dialog (no permission), then a determinate progress view with Cancel. The passphrase fields keep their content after a
 * failure, and the screen never claims more than it did: `Couldn't save the backup. Nothing on this phone changed.`
 */
export function BackupScreen({ api = realBackupApi, onBusyChange, onDone }: { api?: BackupApi; onBusyChange?: (busy: boolean) => void; onDone?: () => void }) {
  const theme = useTheme();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const cancelled = useRef(false);
  const running = useRef(false);
  const check = checkPassphrase(pass, confirm);

  const save = async () => {
    if (running.current || !check.canSave) return;
    running.current = true;
    cancelled.current = false;
    onBusyChange?.(true);
    // The system dialog comes first: while it is open the form stays as it is; a chosen place starts the progress view at once, so
    // Cancel is there during the export and the photo pass too.
    try {
      const r = await api.run(pass, {
        onProgress: (fraction) => setPhase({ kind: 'running', fraction }),
        isCancelled: () => cancelled.current,
      });
      if (r.ok) setPhase({ kind: 'done', done: r.value });
      else if (r.code === 'DOCUMENT_CANCELLED' || r.code === 'CANCELLED') setPhase({ kind: 'form' }); // nothing was written
      else setPhase({ kind: 'failed' });
    } catch {
      setPhase({ kind: 'failed' });
    } finally {
      running.current = false;
      onBusyChange?.(false);
    }
  };

  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };

  if (phase.kind === 'running') {
    const pct = Math.round(phase.fraction * 100);
    return (
      <View style={styles.gap} testID="backup-progress">
        <Text accessibilityRole="header" style={[textStyle('title'), ink]}>
          {copy.backup.making}
        </Text>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={copy.backup.making}
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          style={[styles.track, { backgroundColor: theme.color('border-hairline') }]}>
          <View testID="backup-progress-bar" style={[styles.fill, { width: `${pct}%`, backgroundColor: theme.color('accent-primary') }]} />
        </View>
        <Text style={[textStyle('caption'), muted]}>{`${pct}%`}</Text>
        <Button label={copy.common.cancel} variant="secondary" testID="backup-cancel" onPress={() => (cancelled.current = true)} />
      </View>
    );
  }

  if (phase.kind === 'done') {
    return (
      <View style={styles.gap} testID="backup-done">
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[textStyle('title'), ink]}>
          {copy.backup.saved}
        </Text>
        <Text testID="backup-counts" style={[textStyle('body'), ink]}>
          {backupCountsLine(phase.done.counts)}
        </Text>
        {phase.done.photosSkipped > 0 ? (
          <Text testID="backup-skipped" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
            {phase.done.photosSkipped === 1 ? copy.backup.skippedOne : copy.backup.skippedMany.replace('{n}', String(phase.done.photosSkipped))}
          </Text>
        ) : null}
        {phase.done.recorded ? null : (
          <Text testID="backup-not-noted" style={[textStyle('body'), muted]}>
            {copy.backup.notNoted}
          </Text>
        )}
        <Text style={[textStyle('body'), muted]}>{copy.backup.keepSafe}</Text>
        <Button label={copy.backup.done} testID="backup-finish" onPress={() => onDone?.()} />
      </View>
    );
  }

  return (
    <View style={styles.gap} testID="backup-form">
      <Text style={[textStyle('body'), ink]}>{copy.backup.explain}</Text>
      <PassphraseField
        label={copy.backup.passphrase}
        value={pass}
        onChangeText={setPass}
        show={show}
        onToggleShow={() => setShow((s) => !s)}
        autoComplete="password-new"
        testID="backup-pass"
      />
      <PassphraseField
        label={copy.backup.confirmPassphrase}
        value={confirm}
        onChangeText={setConfirm}
        show={show}
        onToggleShow={() => setShow((s) => !s)}
        autoComplete="password-new"
        invalid={check.mismatch}
        testID="backup-confirm"
      />
      <View accessibilityLiveRegion="polite" style={styles.hints}>
        <View style={styles.hintRow}>
          <Icon icon={check.hint === 'strong-enough' ? CheckCircle : Info} size={16} color={check.hint === 'strong-enough' ? 'semantic-income' : 'text-secondary'} />
          <Text testID="backup-hint" style={[textStyle('caption'), { color: theme.color(check.hint === 'strong-enough' ? 'semantic-income' : 'text-secondary') }]}>
            {check.hint === 'strong-enough' ? copy.backup.strongEnough : check.hint === 'low-variety' ? copy.backup.moreVariety : copy.backup.useAtLeast}
          </Text>
        </View>
        {check.mismatch ? (
          <View style={styles.hintRow}>
            <Icon icon={Warning} size={16} color="semantic-expense" />
            <Text testID="backup-mismatch" style={[textStyle('caption'), { color: theme.color('semantic-expense') }]}>
              {copy.backup.mismatch}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[textStyle('caption'), muted]}>{copy.backup.noRecovery}</Text>
      <Text style={[textStyle('caption'), muted]}>{copy.backup.youChoose}</Text>
      {phase.kind === 'failed' ? (
        <View style={styles.gap}>
          <Text testID="backup-failed" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
            {copy.backup.failed}
          </Text>
        </View>
      ) : null}
      <Button
        label={phase.kind === 'failed' ? copy.backup.tryAgain : copy.backup.save}
        {...(check.canSave ? {} : { disabledReason: copy.backup.disabledReason })}
        testID="backup-save"
        onPress={() => void save()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  hints: { gap: 4 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
