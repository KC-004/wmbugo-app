import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ImportSummary } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { ImportRun } from './ImportRun';
import { ImportWizard } from './ImportWizard';
import { realImportApi, type ImportApi } from './importApi';
import type { ImportDraft } from './importModel';

/**
 * The whole import (FLOW-11): the wizard's three steps, then Check matches, the run and the summary. An import the app was closed in
 * the middle of is offered first, so it can be carried on from the row after its last committed batch.
 */
export function ImportFlow({ api = realImportApi, locale = 'en', onExit, onReview, onBusyChange }: { api?: ImportApi; locale?: string; onExit: () => void; onReview?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [interrupted, setInterrupted] = useState<ImportSummary | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .paused()
      .then((p) => live && setInterrupted(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  if (resuming) return <ImportRun draft={null} api={api} locale={locale} resumeBatchId={resuming} onDone={onExit} {...(onReview ? { onReview } : {})} {...(onBusyChange ? { onBusyChange } : {})} />;
  if (draft) return <ImportRun draft={draft} api={api} locale={locale} onDone={onExit} {...(onReview ? { onReview } : {})} {...(onBusyChange ? { onBusyChange } : {})} />;

  return (
    <View style={styles.block}>
      {interrupted ? (
        <View testID="import-interrupted" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          <Text accessibilityRole="header" style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>
            {copy.csvImport.interruptedTitle}
          </Text>
          <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>
            {copy.csvImport.interruptedBody.replace('{done}', String(interrupted.imported + interrupted.skipped + interrupted.review + interrupted.errors)).replace('{total}', String(interrupted.rowCount))}
          </Text>
          <View style={styles.actions}>
            <Button label={copy.csvImport.resume} testID="import-interrupted-resume" onPress={() => setResuming(interrupted.batchId)} />
            <Button label={copy.csvImport.notNow} variant="text" testID="import-interrupted-dismiss" onPress={() => setInterrupted(null)} />
          </View>
        </View>
      ) : null}
      <ImportWizard api={api} onContinue={setDraft} {...(onBusyChange ? { onBusyChange } : {})} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 16 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
