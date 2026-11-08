import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Warning } from 'phosphor-react-native';
import { statementStatus, type CardDetailsRead, type CurrencyCode } from '@wmbugo/core';
import { amountLabel } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';

/** "Sun 1 Nov" without the weekday: "1 Nov". */
export const dayMonth = (shortDate: string): string => shortDate.split(' ').slice(1).join(' ');

/**
 * The statement and limit lines under a card's balance. The statement is what the user copied from their bill; it is
 * never what is owed. Overdue uses text-primary with a warning icon, never red text alone.
 */
export function CardLines({ card, today, currency, locale, formatDate }: { card: CardDetailsRead; today: string; currency: CurrencyCode; locale: string; formatDate: (d: string) => string }) {
  const theme = useTheme();
  const status = statementStatus(card, today);
  const ink = { color: theme.color('text-primary') };

  /** Fills a copy template: {amount} becomes the real Amount, {date} the formatted day. */
  const fill = (tpl: string, minor: number | null, date: string | null): ReactNode => {
    const [a, b] = tpl.split('{amount}');
    const withDate = (s: string) => s.replace('{date}', date ? formatDate(date) : '');
    return (
      <>
        {a ? <Text style={[textStyle('body'), ink]}>{withDate(a)}</Text> : null}
        {minor !== null && b !== undefined ? <Amount amountMinor={minor} currency={currency} direction="neutral" locale={locale} /> : null}
        {b ? <Text style={[textStyle('body'), ink]}>{withDate(b)}</Text> : null}
      </>
    );
  };
  const spoken = (tpl: string, minor: number | null, date: string | null) =>
    tpl.replace('{amount}', minor === null ? '' : amountLabel({ amountMinor: minor, currency, locale })).replace('{date}', date ? formatDate(date) : '').replace(/\s+/g, ' ').trim();

  let line: { tpl: string; minor: number | null; date: string | null; warn: boolean } | null = null;
  if (status.kind === 'paid') line = { tpl: copy.cardDetails.paid, minor: status.amountMinor, date: null, warn: false };
  else if (status.kind === 'overdue') line = { tpl: status.amountMinor === null ? copy.cardDetails.wasDueNoAmount : copy.cardDetails.wasDue, minor: status.amountMinor, date: status.dueDate, warn: true };
  else if (status.kind === 'due') line = { tpl: status.amountMinor === null ? copy.cardDetails.dueNoAmount : copy.cardDetails.dueBy, minor: status.amountMinor, date: status.dueDate, warn: false };

  if (!line && card.limitMinor === null) return null;
  return (
    <View testID="card-lines" style={styles.block}>
      {line ? (
        <View testID="statement-line" accessible accessibilityLabel={spoken(line.tpl, line.minor, line.date)} style={styles.inline}>
          {line.warn ? <Icon icon={Warning} size={18} color="text-primary" /> : null}
          {fill(line.tpl, line.minor, line.date)}
        </View>
      ) : null}
      {card.limitMinor !== null ? (
        <View testID="limit-line" accessible accessibilityLabel={spoken(copy.cardDetails.limit, card.limitMinor, null)} style={styles.inline}>
          {fill(copy.cardDetails.limit, card.limitMinor, null)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 4 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 },
});
