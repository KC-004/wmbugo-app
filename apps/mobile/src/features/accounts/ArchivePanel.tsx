import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { accountLine, type AccountRow, type CurrencyCode } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';

/** Splits a copy template on {name} and {amount} and renders each piece (the amount through <Amount>). */
function fill(tpl: string, name: string, amount: ReactNode, style: object): ReactNode {
  return tpl.split(/(\{name\}|\{amount\})/).map((part, i) =>
    part === '{name}' ? <Text key={i} style={style}>{name}</Text> : part === '{amount}' ? <View key={i}>{amount}</View> : part ? <Text key={i} style={style}>{part}</Text> : null,
  );
}

/**
 * The confirmation before an account is archived. It says what is still in it (or what is still owed) and what
 * archiving does, mentions entries waiting for review, and offers to adjust the balance first. An account at zero gets
 * a plain "Archive SBI?".
 */
export function ArchivePanel({
  account,
  currency,
  locale,
  reviewCount,
  onAdjust,
  onConfirm,
  onCancel,
}: {
  account: AccountRow;
  currency: CurrencyCode;
  locale: string;
  reviewCount: number;
  onAdjust: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const ink = { color: theme.color('text-primary') };
  const line = accountLine(account);
  // Money sits here when there is a balance that is not zero (a not-set balance and a savings pot's moved-in are not).
  const held = line.kind === 'have' || line.kind === 'below-zero' || line.kind === 'owe' || line.kind === 'in-credit' ? line : null;
  const money = held && held.minor !== 0 ? held : null;
  const tpl = !money
    ? copy.archive.plain
    : money.kind === 'owe'
      ? copy.archive.owes
      : money.kind === 'below-zero'
        ? copy.archive.belowZero
        : money.kind === 'in-credit'
          ? copy.archive.credit
          : copy.archive.has;
  const amount = money ? <Amount amountMinor={money.minor} currency={currency} direction="neutral" locale={locale} /> : null;
  const review = reviewCount === 1 ? copy.archive.reviewOne : reviewCount > 1 ? copy.archive.reviewMany.replace('{n}', String(reviewCount)) : null;

  return (
    <View testID="archive-panel" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View testID="archive-message" accessible style={styles.inline}>
        {fill(tpl, account.name, amount, textStyle('body-medium') as object)}
      </View>
      {review ? <Text testID="archive-review" style={[textStyle('body'), ink]}>{review}</Text> : null}
      <View style={styles.inline}>
        {money ? <Button label={copy.archive.adjustFirst} variant="secondary" onPress={onAdjust} testID="archive-adjust" /> : null}
        <Button label={money ? copy.archive.anyway : copy.archive.confirm} onPress={onConfirm} testID="archive-confirm" />
        <Button label={copy.common.cancel} variant="text" onPress={onCancel} testID="archive-cancel" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 12 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 4, rowGap: 8 },
});
