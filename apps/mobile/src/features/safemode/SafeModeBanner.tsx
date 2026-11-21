import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { copy } from '../../shared/copy';
import { useSafeModeStore } from '../../shared/state/safeModeStore';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { BackupScreen } from '../backup/BackupScreen';
import { DiagnosticsExportScreen, DiagnosticsScreen } from '../diagnostics/DiagnosticsScreen';
import { RestoreFlow } from '../restore/RestoreFlow';

type Panel = null | 'restore' | 'backup' | 'diagnostics' | 'export';

/**
 * The persistent banner of safe mode with a readable database (Story 8.12): `wmbugo can't safely change your data right now. Your
 * entries are untouched.` The tabs stay browsable; the banner offers Restore from backup, Back up what can be read and Diagnostics.
 * It renders nothing in normal operation.
 */
export function SafeModeBanner() {
  const theme = useTheme();
  const reason = useSafeModeStore((s) => s.reason);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  if (reason === null) return null;

  if (panel !== null) {
    return (
      <View testID="safe-mode-panel" style={[styles.panel, { backgroundColor: theme.color('bg-canvas') }]}>
        <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('text-primary') }]}>
          {panel === 'restore' ? copy.safeMode.restore : panel === 'backup' ? copy.safeMode.backUp : copy.safeMode.diagnostics}
        </Text>
        {panel === 'restore' ? <RestoreFlow onBusyChange={setBusy} onExit={() => setPanel(null)} /> : null}
        {panel === 'backup' ? <BackupScreen onBusyChange={setBusy} onDone={() => setPanel(null)} /> : null}
        {panel === 'diagnostics' ? <DiagnosticsScreen onExport={() => setPanel('export')} /> : null}
        {panel === 'export' ? <DiagnosticsExportScreen /> : null}
        {!busy ? <Button label={copy.safeMode.back} variant="text" testID="safe-mode-panel-back" onPress={() => setPanel(panel === 'export' ? 'diagnostics' : null)} /> : null}
      </View>
    );
  }

  return (
    <View testID="safe-mode-banner" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: theme.color('bg-muted'), borderColor: theme.color('semantic-warning') }]}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.safeMode.banner}</Text>
      <View style={styles.actions}>
        <Button label={copy.safeMode.restore} variant="secondary" testID="safe-banner-restore" onPress={() => setPanel('restore')} />
        <Button label={copy.safeMode.backUp} variant="secondary" testID="safe-banner-backup" onPress={() => setPanel('backup')} />
        <Button label={copy.safeMode.diagnostics} variant="text" testID="safe-banner-diagnostics" onPress={() => setPanel('diagnostics')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderBottomWidth: 2, padding: 12, gap: 8 },
  actions: { gap: 8 },
  panel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: 24, paddingTop: 48, gap: 12 },
});
