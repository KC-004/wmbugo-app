import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ERASE_SCOPE_LINES } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { requireReauth } from '../../shared/reauth';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { CheckRow } from '../../shared/ui/CheckRow';
import { BackupScreen } from '../backup/BackupScreen';
import { realEraseApi, type EraseApi } from './eraseApi';

type Step = 'scope' | 'backup-first' | 'confirm' | 'erasing' | 'failed' | 'reopen';

/**
 * Settings › Data › Erase all data (Story 8.11, SEC-008): a scope screen that says what goes and what stays, a confirmation with a
 * checkbox and a destructive button, and the re-authentication guard when app lock is on. `Cancel` or Back at either step changes
 * nothing. On success the app restarts on Welcome with no data and no key.
 */
export function EraseFlow({
  api = realEraseApi,
  onExit,
  onBusyChange,
  backupAvailable = true,
}: {
  api?: EraseApi;
  onExit: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** False when nothing can be read to back up (the key is lost), so the offer is not made. */
  backupAvailable?: boolean;
}) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>('scope');
  const [understood, setUnderstood] = useState(false);
  const ink = { color: theme.color('text-primary') };

  const erase = async () => {
    if (!understood) return;
    // With app lock on, the shared guard asks `Confirm it's you`; cancelling keeps the confirmation as it was.
    if (!(await requireReauth())) return;
    onBusyChange?.(true);
    setStep('erasing');
    try {
      const r = await api.erase();
      if (r === 'ok') return; // the app restarts on Welcome
      if (r === 'reopen') {
        // Everything is gone and the connection is closed: Back stays blocked and the person is told to reopen the app.
        setStep('reopen');
        return;
      }
    } catch {
      /* falls through to the failure message */
    }
    onBusyChange?.(false);
    setStep('failed');
  };

  if (step === 'backup-first') {
    return (
      <View style={styles.gap} testID="erase-backup-first">
        <BackupScreen onBusyChange={onBusyChange} onDone={() => setStep('scope')} />
        <Button label={copy.restore.back} variant="text" testID="erase-backup-back" onPress={() => setStep('scope')} />
      </View>
    );
  }

  if (step === 'erasing') {
    return (
      <View style={styles.gap} testID="erase-running">
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[textStyle('title'), ink]}>
          {copy.erase.erasing}
        </Text>
      </View>
    );
  }

  if (step === 'reopen') {
    return (
      <View style={styles.gap} testID="erase-reopen">
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), ink]}>
          {copy.erase.reopen}
        </Text>
      </View>
    );
  }

  if (step === 'failed') {
    return (
      <View style={styles.gap} testID="erase-failed">
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), ink]}>
          {copy.erase.failed}
        </Text>
        <Button label={copy.restore.close} testID="erase-close" onPress={onExit} />
      </View>
    );
  }

  if (step === 'confirm') {
    return (
      <View style={styles.gap} testID="erase-confirm">
        <Text accessibilityRole="header" style={[textStyle('title'), ink]}>
          {copy.erase.confirmTitle}
        </Text>
        <CheckRow testID="erase-understand" label={copy.erase.understand} checked={understood} onToggle={() => setUnderstood((v) => !v)} />
        <Button label={copy.erase.erase} variant="destructive" {...(understood ? {} : { disabledReason: copy.erase.disabledReason })} testID="erase-go" onPress={() => void erase()} />
        <Button label={copy.erase.cancel} variant="text" testID="erase-cancel" onPress={onExit} />
      </View>
    );
  }

  return (
    <View style={styles.gap} testID="erase-scope">
      {ERASE_SCOPE_LINES.map((line) => (
        <Text key={line} style={[textStyle('body'), ink]}>
          {line}
        </Text>
      ))}
      {backupAvailable ? <Button label={copy.erase.backupFirst} variant="text" testID="erase-backup-link" onPress={() => setStep('backup-first')} /> : null}
      <Button
        label={copy.erase.cont}
        testID="erase-continue"
        onPress={() => {
          setUnderstood(false);
          setStep('confirm');
        }}
      />
      <Button label={copy.erase.cancel} variant="text" testID="erase-scope-cancel" onPress={onExit} />
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
