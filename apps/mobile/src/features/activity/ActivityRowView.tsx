import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ArrowsLeftRight, DotsThree } from 'phosphor-react-native';
import { longDate, type ActivityRow, type CurrencyCode } from '@wmbugo/core';
import { amountLabel, type AmountKind } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { categoryIcon } from '../add/categoryIcons';

const KIND: Readonly<Record<ActivityRow['kind'], AmountKind>> = { expense: 'spent', income: 'income', refund: 'refund', transfer: 'transfer' };

/**
 * One entry row, shared by Activity and an account's timeline. An entry dated before its account's tracking
 * start says so in its subtitle and to TalkBack (it never changed that balance).
 */
export function ActivityRowView({
  row,
  date,
  currency,
  locale,
  title: titleOverride,
  showAccount = true,
}: {
  row: ActivityRow;
  date: string;
  currency: CurrencyCode;
  locale: string;
  /** A transfer on an account's own timeline reads "To Cash" or "From HDFC". */
  title?: string;
  /** False on an account's timeline, where the account is the page itself. */
  showAccount?: boolean;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const title = titleOverride ?? row.merchant ?? row.categoryName ?? copy.activity.transfer;
  const account = showAccount ? row.accountName : null;
  const sub = [row.kind === 'transfer' ? copy.activity.transfer : row.categoryName, account, row.beforeTracking ? copy.activity.beforeTracking : null].filter(Boolean).join(' · ');
  const spoken = [
    title,
    amountLabel({ amountMinor: row.amountMinor, currency, locale, kind: KIND[row.kind], inline: true }),
    row.kind === 'transfer' ? null : row.categoryName,
    account,
    row.beforeTracking ? copy.activity.beforeTracking.toLowerCase() : null,
    longDate(date),
  ]
    .filter(Boolean)
    .join(', ');
  const glyph = row.kind === 'transfer' ? ArrowsLeftRight : row.categoryIcon ? categoryIcon(row.categoryIcon) : DotsThree;
  const direction = row.kind === 'income' || row.kind === 'refund' ? 'income' : row.kind === 'expense' ? 'expense' : 'neutral';
  const stack = fontScale >= 1.3;
  return (
    <View
      testID={`activity-row-${row.id}`}
      accessible
      accessibilityLabel={spoken}
      style={[styles.row, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={[styles.chip, { backgroundColor: theme.color('bg-muted') }]}>
        <Icon icon={glyph} size={22} color={(row.categoryColor as ColorName | null) ?? 'text-secondary'} />
      </View>
      <View style={[styles.rowBody, stack ? styles.column : styles.between]}>
        <View style={styles.rowText}>
          <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{title}</Text>
          <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{sub}</Text>
        </View>
        <Amount
          amountMinor={row.amountMinor}
          currency={currency}
          direction={direction}
          locale={locale}
          style={stack ? styles.stackedAmount : undefined}
          color={direction === 'income' ? 'semantic-income' : 'text-primary'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  column: { flexDirection: 'column', alignItems: 'flex-start' },
  stackedAmount: { alignSelf: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radii.md, padding: 12 },
  chip: { width: 40, height: 40, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 4 },
  rowText: { flexShrink: 1 },
});
