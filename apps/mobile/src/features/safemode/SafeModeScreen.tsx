import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type SafeModeVariant } from '@wmbugo/core';
import { CoinMark } from '../../shared/brand/CoinMark';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { BackupScreen } from '../backup/BackupScreen';
import { DiagnosticsExportScreen, DiagnosticsScreen } from '../diagnostics/DiagnosticsScreen';
import { EraseFlow } from '../erase/EraseFlow';
import { RestoreFlow } from '../restore/RestoreFlow';

type Page = 'home' | 'restore' | 'diagnostics' | 'export' | 'backup' | 'fresh';

/**
 * The full-screen safe mode (Story 8.12, UX-DR72): the data cannot be opened safely, so nothing is changed and the ways out are
 * shown. Which sentence and which buttons depend on why (`variant`):
 * - `unreadable`: restore and Diagnostics; `Back up what can be read` is shown disabled, with the reason.
 * - `key-lost`: the key is gone; restore, `Start fresh` (the erase flow) and Diagnostics.
 * - `migration`: an update rolled back and nothing was lost; `Try again` runs it again.
 * - `newer`: the data was saved by a newer wmbugo: update the app; Try again opens it again afterwards.
 * - `erase`: an interrupted erase could not be finished; Try again finishes it.
 * Every variant except `key-lost` offers Try again: a transient fault should not need a restore.
 */
export function SafeModeScreen({ variant, onRetry }: { variant: Exclude<SafeModeVariant, 'readable'>; onRetry: () => void }) {
  const theme = useTheme();
  const [page, setPage] = useState<Page>('home');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      if (page === 'home') return false;
      setPage(page === 'export' ? 'diagnostics' : 'home');
      return true;
    });
    return () => sub.remove();
  }, [page, busy]);

  const ink = { color: theme.color('text-primary') };
  const sentence =
    variant === 'key-lost'
      ? copy.safeMode.keyLost
      : variant === 'migration'
        ? copy.safeMode.migration
        : variant === 'newer'
          ? copy.safeMode.newer
          : variant === 'erase'
            ? copy.safeMode.eraseUnfinished
            : copy.safeMode.banner;
  // Opening again can help whenever nothing is known to be damaged: a transient fault, an update just installed, a finished erase.
  const canRetry = variant !== 'key-lost';

  if (page !== 'home') {
    const title = page === 'restore' ? copy.safeMode.restore : page === 'fresh' ? copy.safeMode.startFreshTitle : page === 'backup' ? copy.safeMode.backUp : copy.safeMode.diagnostics;
    return (
      <ScrollView testID="safe-mode-page" contentContainerStyle={[styles.pad, { backgroundColor: theme.color('bg-canvas') }]} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[textStyle('title'), ink]}>
          {title}
        </Text>
        {page === 'restore' ? <RestoreFlow onBusyChange={setBusy} onExit={() => setPage('home')} /> : null}
        {page === 'fresh' ? <EraseFlow backupAvailable={false} onBusyChange={setBusy} onExit={() => setPage('home')} /> : null}
        {page === 'diagnostics' ? <DiagnosticsScreen onExport={() => setPage('export')} /> : null}
        {page === 'export' ? <DiagnosticsExportScreen /> : null}
        {page === 'backup' ? <BackupScreen onBusyChange={setBusy} onDone={() => setPage('home')} /> : null}
        {!busy ? <Button label={copy.safeMode.back} variant="text" testID="safe-mode-back" onPress={() => setPage(page === 'export' ? 'diagnostics' : 'home')} /> : null}
      </ScrollView>
    );
  }

  return (
    <View testID="safe-mode" style={[styles.center, { backgroundColor: theme.color('bg-canvas') }]}>
      <CoinMark size={72} />
      <Text testID="safe-mode-message" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[textStyle('title'), ink, styles.text]}>
        {sentence}
      </Text>
      {canRetry ? <Button label={copy.safeMode.tryAgain} testID="safe-mode-retry" onPress={onRetry} /> : null}
      {variant === 'newer' || variant === 'erase' ? null : (
        <Button label={copy.safeMode.restore} variant={canRetry ? 'secondary' : 'primary'} testID="safe-mode-restore" onPress={() => setPage('restore')} />
      )}
      {variant === 'unreadable' ? <Button label={copy.safeMode.backUp} variant="secondary" disabledReason={copy.safeMode.noBackup} testID="safe-mode-backup" onPress={() => setPage('backup')} /> : null}
      {variant === 'key-lost' ? <Button label={copy.safeMode.startFresh} variant="secondary" testID="safe-mode-fresh" onPress={() => setPage('fresh')} /> : null}
      <Button label={copy.safeMode.diagnostics} variant="text" testID="safe-mode-diagnostics" onPress={() => setPage('diagnostics')} />
      {variant === 'unreadable' ? (
        <Text testID="safe-mode-no-backup" style={[textStyle('caption'), { color: theme.color('text-secondary') }, styles.text]}>
          {copy.safeMode.noBackup}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 12, padding: 24 },
  pad: { padding: 24, paddingTop: 48, gap: 12, flexGrow: 1 },
  text: { textAlign: 'center' },
});
