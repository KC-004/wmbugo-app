import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CategoryRow } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';

export interface BulkPreviewData {
  readonly movable: number;
  readonly wontChange: number;
  /** The one category the movable entries come from, or null when mixed. */
  readonly fromCategoryId: string | null;
}

/** Move N to…: pick a category, read the preview, Confirm. Nothing is written until Confirm. */
export function BulkMoveSheet({
  categories,
  preview,
  onConfirm,
  close,
}: {
  categories: readonly CategoryRow[];
  preview: (categoryId: string) => Promise<BulkPreviewData>;
  onConfirm: (categoryId: string, toName: string) => Promise<boolean>;
  close: () => void;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<CategoryRow | null>(null);
  const [data, setData] = useState<BulkPreviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef(0);
  const ink = { color: theme.color('on-glass-primary') };

  const pick = (c: CategoryRow) => {
    setPicked(c);
    setData(null);
    setError(false);
    const mine = ++latest.current;
    void preview(c.id)
      .then((d) => mine === latest.current && setData(d))
      .catch(() => mine === latest.current && setError(true));
  };

  const fromName = data?.fromCategoryId ? categories.find((c) => c.id === data.fromCategoryId)?.name : undefined;
  const line =
    picked && data && data.movable > 0
      ? (fromName ? copy.bulk.previewFrom.replace('{from}', fromName) : copy.bulk.previewMixed).replace('{n}', String(data.movable)).replace('{entries}', data.movable === 1 ? 'entry' : 'entries').replace('{to}', picked.name)
      : null;
  const wont = data && data.wontChange > 0 ? (data.wontChange === 1 ? copy.bulk.wontChangeOne : copy.bulk.wontChangeMany.replace('{n}', String(data.wontChange))) : null;

  return (
    <View testID="bulk-sheet" style={styles.root}>
      <Text style={[textStyle('label'), ink]}>{copy.bulk.chooseCategory}</Text>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
        {categories.map((c) => (
          <Chip onGlass key={c.id} label={c.name} testID={`bulk-cat-${c.id}`} selected={picked?.id === c.id} onPress={() => pick(c)} />
        ))}
      </ScrollView>
      {picked ? (
        <View testID="bulk-preview" accessibilityLiveRegion="polite" style={styles.preview}>
          {line ? <Text style={[textStyle('body-medium'), ink]}>{line}</Text> : null}
          {data && data.movable === 0 ? <Text style={[textStyle('body-medium'), ink]}>{copy.bulk.nothingToMove}</Text> : null}
          {wont ? <Text testID="bulk-wont-change" style={[textStyle('body'), ink]}>{wont}</Text> : null}
          {error ? <Text style={[textStyle('body'), ink]}>{copy.bulk.failed}</Text> : null}
          <Button
            label={copy.bulk.confirm}
            testID="bulk-confirm"
            disabledReason={!data ? copy.bulk.preparing : data.movable === 0 ? copy.bulk.nothingToMove : busy ? copy.bulk.preparing : undefined}
            onPress={() => {
              setBusy(true);
              void onConfirm(picked.id, picked.name).then((done) => {
                setBusy(false);
                if (done) close();
                else setError(true);
              });
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  list: { maxHeight: 220 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preview: { gap: 8 },
});
