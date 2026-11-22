import { StyleSheet, Text, View } from 'react-native';
import { sourceWords, type ReviewSide } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import type { ReviewData } from './reviewApi';

export const SOURCE_COPY = { addedByYou: copy.review.addedByYou, bankSms: copy.review.bankSms, receipt: copy.review.receipt, csvImport: copy.review.csvImport, other: copy.review.otherSource } as const;

/** "7 Nov, 9:12 pm" (UTC clock of the device; the queue shows when the money moved, close enough for side-by-side). */
export function whenText(ms: number): string {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toLowerCase();
  return day + ', ' + time;
}

/** "3 Nov": the day alone, for a sentence that names the day. */
export function shortDate(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(ms));
}

/** One side of a side-by-side card: amount, when, merchant, account, category and where it came from. */
export function SideColumn({ title, side, data }: { title: string; side: ReviewSide; data: ReviewData }) {
  const theme = useTheme();
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  return (
    <View testID={'review-side-' + title} style={styles.side}>
      <Text style={[textStyle('label'), muted]}>{title}</Text>
      <Amount amountMinor={side.amountMinor} currency={data.currency} direction="neutral" locale={data.locale} />
      <Text style={[textStyle('body'), ink]}>{whenText(side.occurredAtMs)}</Text>
      {side.merchant ? <Text style={[textStyle('body-medium'), ink]}>{side.merchant}</Text> : null}
      {side.account ? <Text style={[textStyle('body'), muted]}>{side.account}</Text> : null}
      {side.category ? <Text style={[textStyle('body'), muted]}>{side.category}</Text> : null}
      <Text style={[textStyle('caption'), muted]}>{SOURCE_COPY[sourceWords(side.sourceKind)]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ side: { flex: 1, gap: 2 } });
