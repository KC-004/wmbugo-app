import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { CheckCircle, DotsThree, Warning } from 'phosphor-react-native';
import type { BillRowModel, CurrencyCode } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { categoryIcon } from '../add/categoryIcons';
import { captionText, cadenceText, statusText } from './billText';

/**
 * One bill, in the Activity row pattern (UX-DR28): a 40dp category icon chip, the name, `Monthly · HDFC · Rent`, the expected
 * amount right-aligned and one status line. A due-soon bill shows a warning icon with its text; a bill not seen yet offers
 * `Mark as paid`. The row is one TalkBack node; at large font sizes the amount wraps below the name.
 */
export function BillRow({ row, currency, locale, onPress, onMarkPaid }: { row: BillRowModel; currency: CurrencyCode; locale: string; onPress: () => void; onMarkPaid?: () => void }) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: this component builds amount labels
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const s = statusText(row.status);
  const stack = fontScale >= 1.3;
  const tone: ColorName = s.tone === 'warning' ? 'semantic-warning' : s.tone === 'muted' ? 'text-secondary' : 'text-primary';
  const spoken = [row.title, amountLabel({ amountMinor: row.expectedAmountMinor, currency, locale, inline: true }), `${cadenceText(row).toLowerCase()}${row.accountName ? ` from ${row.accountName}` : ''}`, s.text].filter(Boolean).join(', ');
  return (
    <View style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Pressable testID={`bill-row-${row.id}`} accessible accessibilityRole="button" accessibilityLabel={spoken} onPress={onPress} style={styles.row}>
        <View style={[styles.chip, { backgroundColor: theme.color('bg-muted') }]}>
          <Icon icon={row.categoryIcon ? categoryIcon(row.categoryIcon) : DotsThree} size={22} color={(row.categoryColor as ColorName | null) ?? 'text-secondary'} />
        </View>
        <View style={[styles.body, stack ? styles.column : styles.between]}>
          <View style={styles.text}>
            <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{row.title}</Text>
            <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{captionText(row)}</Text>
            <View style={styles.status}>
              {s.tone === 'warning' ? <Icon icon={Warning} size={16} color="semantic-warning" /> : s.tone === 'paid' ? <Icon icon={CheckCircle} size={16} color="semantic-income" /> : null}
              <Text testID={`bill-status-${row.id}`} style={[textStyle('caption'), { color: theme.color(tone) }]}>{s.text}</Text>
            </View>
          </View>
          <Amount amountMinor={row.expectedAmountMinor} currency={currency} locale={locale} direction="neutral" role="amount" />
        </View>
      </Pressable>
      {row.status.kind === 'not_seen_yet' && onMarkPaid ? <Button label={copy.bills.markAsPaid} variant="text" testID={`bill-mark-${row.id}`} onPress={onMarkPaid} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, minHeight: 64 },
  chip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  column: { flexDirection: 'column' },
  text: { flexShrink: 1, gap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
