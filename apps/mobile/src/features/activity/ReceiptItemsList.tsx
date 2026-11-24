import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CurrencyCode, ReceiptItemView } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { moneyText } from '../../shared/ui/moneyText';
import { CategoryChip } from '../categories/CategoryChip';

/** The lines read from a saved receipt (Story 10.5): `Items (N)` collapsed, one row each when opened, read-only. */
export function ReceiptItemsList({ items, currency, locale }: { items: readonly ReceiptItemView[]; currency: CurrencyCode; locale: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View testID="detail-items" style={styles.block}>
      <Pressable
        testID="detail-items-toggle"
        {...controlA11y({ label: copy.receiptReview.items.replace('{n}', String(items.length)), role: 'button', expanded: open })}
        onPress={() => setOpen((v) => !v)}
        style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.receiptReview.items.replace('{n}', String(items.length))}</Text>
      </Pressable>
      {open
        ? items.map((it, i) => (
            <View key={it.lineIndex} testID={`detail-item-${i}`} accessible accessibilityLabel={`${it.name}, ${moneyText(it.allocatedMinor, currency, locale)}, ${it.categoryName}`} style={styles.item}>
              <CategoryChip categoryId={it.categoryId} icon={it.categoryIcon ?? 'Tag'} colour={it.categoryColor ?? 'cat-sky'} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{it.name}</Text>
                <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>
                  {it.discountMinor > 0 ? `${it.categoryName} · ${copy.receiptReview.itemDiscount.replace('{amount}', moneyText(it.discountMinor, currency, locale))}` : it.categoryName}
                </Text>
              </View>
              <Amount amountMinor={it.allocatedMinor} currency={currency} direction="expense" locale={locale} />
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 4 },
  row: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 48 },
});
