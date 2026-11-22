import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ImportListItem, ImportRetention } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { groupDigits } from '../../shared/groupDigits';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { shortDate } from '../activity/reviewParts';
import { realImportedFilesApi, type ImportedFilesApi, type ImportedFilesData } from './importedFilesApi';

const OPTIONS: readonly { v: ImportRetention; label: string }[] = [
  { v: 'delete_after', label: copy.csvImport.optionDelete },
  { v: 'days_30', label: copy.csvImport.optionDays },
  { v: 'keep', label: copy.csvImport.optionKeep },
];

/** The summary shown on the Data page row and above the choices. */
export function retentionSummary(choice: ImportRetention): string {
  return choice === 'delete_after' ? copy.csvImport.deletedAfter : choice === 'days_30' ? copy.csvImport.keptDays : copy.csvImport.keptUntilDeleted;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** `statement-nov.csv · 3 Nov · 1,170 imported · file kept until 3 Dec`, or `file deleted`. The last parts read as a line, so they start in lower case. */
export function importLine(item: ImportListItem): string {
  const parts = [item.fileName ?? copy.csvImport.fileUnnamed, shortDate(item.completedAt ?? item.createdAt)];
  if (item.status === 'completed' || item.status === 'abandoned') parts.push(copy.csvImport.importedCount.replace('{n}', groupDigits(item.entries)));
  else parts.push(lower(copy.csvImport.notFinished));
  parts.push(lower(!item.hasFile ? copy.csvImport.fileDeleted : item.keptUntil === null ? copy.csvImport.fileKeptForever : copy.csvImport.fileKeptUntil.replace('{date}', shortDate(item.keptUntil))));
  return parts.join(' · ');
}

/**
 * Imported files (Story 9.8, IMP-006): how long the encrypted copy of an imported bank file stays on this phone, and the list of
 * imports with `Delete file now`. Deleting a copy never touches the entries imported from it.
 */
export function ImportedFilesScreen({ api = realImportedFilesApi, onChanged }: { api?: ImportedFilesApi; onChanged?: () => void }) {
  const theme = useTheme();
  const toast = useToast();
  const sheet = useSheet();
  const [data, setData] = useState<ImportedFilesData | null>(null);

  const load = useCallback(async () => {
    const d = await api.load().catch(() => null);
    setData(d);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (choice: ImportRetention) => {
    const ok = await api.setRetention(choice).catch(() => false);
    if (!ok) return toast.show({ message: copy.csvImport.choiceFailed });
    await load();
    onChanged?.();
  };

  const confirmDelete = (item: ImportListItem) =>
    sheet.open({
      id: 'import-delete-file',
      title: copy.csvImport.deleteConfirmTitle,
      body: (close) => (
        <View style={styles.sheet}>
          <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.csvImport.deleteConfirmBody}</Text>
          <Button
            label={copy.csvImport.deleteConfirm}
            testID="import-delete-confirm"
            onPress={() => {
              close();
              void api
                .deleteFile(item.batchId)
                .catch(() => false)
                .then(async (ok) => {
                  if (!ok) return toast.show({ message: copy.csvImport.deleteFailed });
                  await load();
                  toast.show({ message: copy.csvImport.fileRemoved });
                });
            }}
          />
          <Button label={copy.csvImport.deleteCancel} variant="text" onPress={close} testID="import-delete-cancel" />
        </View>
      ),
    });

  const discard = async (item: ImportListItem) => {
    const ok = await api.discard(item.batchId).catch(() => false);
    if (!ok) return toast.show({ message: copy.csvImport.discardFailed });
    await load();
  };

  if (!data) return <View testID="imported-files-loading" />;
  const ink = { color: theme.color('text-primary') };
  const quiet = { color: theme.color('text-secondary') };
  return (
    <View testID="imported-files" style={styles.block}>
      <Text testID="imported-summary" style={[textStyle('body-medium'), ink]}>
        {retentionSummary(data.retention)}
      </Text>
      <View style={styles.chips}>
        {OPTIONS.map((o) => (
          <Chip key={o.v} role="radio" variant="period" label={o.label} testID={'import-retention-' + o.v} selected={data.retention === o.v} onPress={() => void choose(o.v)} />
        ))}
      </View>
      <Text style={[textStyle('caption'), quiet]}>{copy.csvImport.filesLine}</Text>

      <Text accessibilityRole="header" style={[textStyle('label'), quiet]}>
        {copy.csvImport.filesHeading}
      </Text>
      {data.items.length === 0 ? <Text testID="imports-empty" style={[textStyle('body'), quiet]}>{copy.csvImport.filesEmpty}</Text> : null}
      {data.items.map((item) => (
        <View key={item.batchId} testID={'import-item-' + item.batchId} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          <Text style={[textStyle('body'), ink]}>{importLine(item)}</Text>
          <View style={styles.chips}>
            {item.hasFile && (item.status === 'completed' || item.status === 'abandoned') ? (
              <Button label={copy.csvImport.deleteNow} variant="secondary" testID={'import-delete-' + item.batchId} onPress={() => confirmDelete(item)} />
            ) : null}
            {item.status === 'paused' || item.status === 'planned' || item.status === 'importing' ? (
              <Button label={copy.csvImport.discard} variant="secondary" testID={'import-discard-' + item.batchId} onPress={() => void discard(item)} />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 8 },
  sheet: { gap: 12, padding: 4 },
});
