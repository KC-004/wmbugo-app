import { StyleSheet, View } from 'react-native';
import { copy } from '../../shared/copy';
import { Button } from '../../shared/ui/Button';
import type { AddApi } from '../add/addApi';
import { useDuplicateChoices } from '../add/duplicateChoices';

/** The durable path for a possible duplicate: the same Keep both and Merge as the toast, on the flagged entry. */
export function HeldRowActions({ transactionId, api }: { transactionId: string; api: Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'> }) {
  const choices = useDuplicateChoices(api);
  return (
    <View style={styles.row}>
      <Button label={copy.duplicate.keepBoth} variant="secondary" onPress={() => void choices.keepBoth(transactionId)} testID={`keep-both-${transactionId}`} />
      <Button label={copy.duplicate.merge} variant="secondary" onPress={() => void choices.merge(transactionId)} testID={`merge-${transactionId}`} />
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 } });
