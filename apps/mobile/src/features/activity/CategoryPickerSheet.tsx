import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Chip } from '../../shared/ui/Chip';

/**
 * Pick the category for one entry (Story 4.4). Choosing saves at once and closes; the current category is marked. The
 * caller lists only categories that fit the entry's kind.
 */
export function CategoryPickerSheet({
  categories,
  currentId,
  onPick,
  close,
}: {
  categories: readonly { id: string; name: string }[];
  currentId: string | null;
  onPick: (categoryId: string) => void | Promise<void>;
  close: () => void;
}) {
  const theme = useTheme();
  return (
    <View testID="category-picker" style={styles.root}>
      <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('on-glass-primary') }]}>{copy.detail.chooseCategory}</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {categories.map((c) => (
          <Chip
            key={c.id}
            onGlass
            role="radio"
            label={c.name}
            testID={`pick-category-${c.id}`}
            selected={c.id === currentId}
            onPress={() => {
              close();
              if (c.id !== currentId) void onPick(c.id);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  scroll: { maxHeight: 360 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
});
