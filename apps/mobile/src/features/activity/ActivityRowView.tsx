import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ArrowsLeftRight, ArrowUUpLeft, Check, DotsThree, Scales, Warning } from 'phosphor-react-native';
import { longDate, rowState, shortDate, type ActivityRow, type CurrencyCode } from '@wmbugo/core';
import { amountLabel, type AmountKind } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { minorToInput } from '../../shared/minorInput';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { categoryIcon } from '../add/categoryIcons';

const KIND: Readonly<Record<ActivityRow['kind'], AmountKind>> = { expense: 'spent', income: 'income', refund: 'refund', transfer: 'transfer', adjustment: 'plain', reversal: 'plain' };

/** Status tags under the subtitle (UX-DR30): small pills, not buttons, never separately focusable. */
function tagsOf(row: ActivityRow): { text: string; spoken: string; tone?: 'warning' }[] {
  const out: { text: string; spoken: string; tone?: 'warning' }[] = [];
  const state = rowState(row);
  if (state === 'guessed') out.push({ text: copy.activity.tagGuessed.toLowerCase(), spoken: copy.activity.tagGuessed.toLowerCase() });
  if (row.needsCategory && state !== 'reversed') out.push({ text: copy.activity.tagAddCategory.toLowerCase(), spoken: copy.activity.tagAddCategory.toLowerCase() });
  if (state === 'waiting') out.push({ text: copy.activity.tagWaiting.toLowerCase(), spoken: copy.activity.tagWaiting.toLowerCase() });
  if (state === 'currency') out.push({ text: copy.activity.tagCurrency.toLowerCase(), spoken: copy.activity.waitingForCurrency.toLowerCase() });
  if (state === 'check') out.push({ text: copy.activity.tagCheck, spoken: copy.activity.checkSpoken.toLowerCase(), tone: 'warning' });
  if (state === 'reversed') out.push({ text: copy.activity.tagReversed.toLowerCase(), spoken: copy.activity.tagReversed.toLowerCase() });
  if (state === 'rejected') out.push({ text: copy.activity.tagRejected.toLowerCase(), spoken: copy.activity.tagRejected.toLowerCase() });
  if (row.beforeTracking) out.push({ text: copy.activity.tagBeforeTracking.toLowerCase(), spoken: copy.activity.beforeTracking.toLowerCase() });
  return out;
}

/**
 * One entry row, shared by Activity and an account's timeline, in every state (UX-DR29): confirmed expense, income,
 * refund (return icon), transfer, guessed, needs a category, waiting and waiting for currency (dashed outline), a
 * possible duplicate (warning icon and Check), reversed (struck through) and before tracking started. A row never shows
 * a minus sign.
 */
export function ActivityRowView({
  row,
  date,
  currency,
  locale,
  title: titleOverride,
  showAccount = true,
  showDate = false,
  footer,
  onPress,
  onLongPress,
  selection,
  actions,
  onAction,
}: {
  row: ActivityRow;
  date: string;
  currency: CurrencyCode;
  locale: string;
  /** A transfer on an account's own timeline reads "To Cash" or "From HDFC". */
  title?: string;
  /** False on an account's timeline, where the account is the page itself. */
  showAccount?: boolean;
  /** In a flat list (sorted by amount or merchant) there are no day headers, so the date goes in the subtitle. */
  showDate?: boolean;
  /** Under the row's text: the Keep both / Merge buttons of a possible duplicate. */
  footer?: ReactNode;
  /** Opens the entry. */
  onPress?: () => void;
  /** Starts selecting (Story 3.9). */
  onLongPress?: () => void;
  /** Selection mode: the category chip becomes a checkbox and the row reads as one. */
  selection?: { selected: boolean };
  /** TalkBack custom actions (Recategorise, Delete). */
  actions?: readonly { name: string; label: string }[];
  onAction?: (name: string) => void;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const state = rowState(row);
  const adjustment = row.kind === 'adjustment';
  const up = (row.signedMinor ?? 0) >= 0;
  const title = adjustment ? copy.activity.balanceAdjustment : row.kind === 'reversal' ? (row.merchant ? copy.activity.reversalOf.replace('{merchant}', row.merchant) : copy.activity.reversalPlain) : (titleOverride ?? row.merchant ?? row.categoryName ?? copy.activity.transfer);
  const account = showAccount ? row.accountName : null;
  const kindWord = adjustment ? (up ? copy.activity.adjustedUp : copy.activity.adjustedDown) : row.kind === 'transfer' ? copy.activity.transfer : row.categoryName;
  const category = kindWord && row.splitCount && row.kind !== 'transfer' && !adjustment ? `${kindWord} + ${row.splitCount - 1} more` : kindWord;
  const sub = [category, account, showDate ? shortDate(row.localDate) : null].filter(Boolean).join(' · ');
  const tags = tagsOf(row);
  const foreignCurrency = row.foreign?.currency as CurrencyCode | undefined;
  const amountSpoken =
    state === 'currency' && row.foreign
      ? `${row.foreign.currency} ${minorToInput(row.foreign.amountMinor, 2)}, ${copy.activity.waitingForCurrency.toLowerCase()}`
      : adjustment
        ? `${(up ? copy.activity.up : copy.activity.down).toLowerCase()} ${amountLabel({ amountMinor: row.amountMinor, currency, locale, inline: true })}`
        : row.kind === 'refund'
          ? amountLabel({ amountMinor: row.amountMinor, currency, locale, kind: 'refund', inline: true })
          : amountLabel({ amountMinor: row.amountMinor, currency, locale, kind: KIND[row.kind], inline: true });
  const spoken = [
    title,
    amountSpoken,
    row.kind === 'transfer' || adjustment ? null : row.categoryName,
    account,
    ...tags.filter((t) => state !== 'currency' || t.text !== copy.activity.tagCurrency.toLowerCase()).map((t) => t.spoken),
    longDate(date),
  ]
    .filter(Boolean)
    .join(', ');

  const glyph = adjustment ? Scales : row.kind === 'transfer' ? ArrowsLeftRight : row.categoryIcon ? categoryIcon(row.categoryIcon) : DotsThree;
  const direction = row.kind === 'income' || row.kind === 'refund' ? 'income' : row.kind === 'expense' ? 'expense' : 'neutral';
  const reversed = state === 'reversed' || state === 'rejected';
  const waiting = state === 'waiting' || state === 'currency';
  const amountColor: ColorName = reversed ? 'text-secondary' : direction === 'income' ? 'semantic-income' : 'text-primary';
  const strike = reversed ? styles.strike : undefined;
  const stack = fontScale >= 1.3;
  const onAccentColor = theme.scheme === 'dark' ? theme.color('bg-canvas') : theme.color('bg-surface');
  const showForeign = state === 'currency' && foreignCurrency && row.foreign;
  return (
    <Pressable
      testID={`activity-row-${row.id}`}
      accessible
      accessibilityRole={selection ? 'checkbox' : onPress ? 'button' : undefined}
      accessibilityState={selection ? { checked: selection.selected } : undefined}
      accessibilityLabel={selection ? `${spoken}, ${selection.selected ? copy.bulk.rowSelected.toLowerCase() : copy.bulk.rowNotSelected.toLowerCase()}` : spoken}
      accessibilityHint={state === 'check' ? copy.activity.checkHint : undefined}
      accessibilityActions={actions ? [...actions] : undefined}
      onAccessibilityAction={onAction ? (e) => onAction(e.nativeEvent.actionName) : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.row,
        { backgroundColor: theme.color(selection?.selected ? 'bg-muted' : 'bg-surface'), borderColor: theme.color(waiting ? 'border-control' : 'border-hairline') },
        waiting ? styles.dashed : null,
      ]}>
      {selection ? (
        <View testID={`checkbox-${row.id}`} style={styles.checkTarget}>
          <View style={[styles.checkbox, { borderColor: theme.color(selection.selected ? 'accent-primary' : 'border-control'), backgroundColor: selection.selected ? theme.color('accent-primary') : 'transparent' }]}>
            {selection.selected ? <Icon icon={Check} size={16} tint={onAccentColor} /> : null}
          </View>
        </View>
      ) : (
        <View style={[styles.chip, { backgroundColor: theme.color('bg-muted') }]}>
          <Icon icon={glyph} size={22} color={(row.categoryColor as ColorName | null) ?? 'text-secondary'} />
        </View>
      )}
      <View style={[styles.rowBody, stack ? styles.column : styles.between]}>
        <View style={styles.rowText}>
          <Text style={[textStyle('body-medium'), { color: theme.color(reversed ? 'text-secondary' : 'text-primary') }, strike]}>{title}</Text>
          <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{sub}</Text>
          {tags.length > 0 ? (
            <View testID={`tags-${row.id}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.tags}>
              {state === 'check' ? <Icon icon={Warning} size={16} color="semantic-warning" /> : null}
              {tags.map((t) => (
                <View key={t.text} style={[styles.tag, { backgroundColor: theme.color('bg-canvas'), borderColor: theme.color('border-hairline') }]}>
                  <Text style={[textStyle('tag'), { color: theme.color(t.tone === 'warning' ? 'semantic-warning' : 'text-secondary') }]}>{t.text}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {footer}
        </View>
        <View style={[styles.amountCol, stack ? styles.stackedAmount : null]}>
          {row.kind === 'refund' ? <View importantForAccessibility="no" accessibilityElementsHidden style={styles.returnIcon}><Icon icon={ArrowUUpLeft} size={16} color="semantic-income" /></View> : null}
          {showForeign ? (
            <Amount amountMinor={row.foreign!.amountMinor} currency={foreignCurrency!} direction="neutral" locale={locale} />
          ) : (
            <Amount amountMinor={row.amountMinor} currency={currency} direction={direction} locale={locale} style={strike} color={amountColor} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  column: { flexDirection: 'column', alignItems: 'flex-start' },
  stackedAmount: { alignSelf: 'flex-end' },
  amountCol: { flexDirection: 'row', alignItems: 'center' },
  returnIcon: { marginRight: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radii.md, padding: 12 },
  // Waiting entries: a dashed outline inset 4dp with 4dp corners.
  dashed: { borderStyle: 'dashed', borderRadius: 4, margin: 4 },
  checkTarget: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chip: { width: 40, height: 40, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 4 },
  rowText: { flexShrink: 1 },
  strike: { textDecorationLine: 'line-through' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4, paddingTop: 4 },
  tag: { borderWidth: 1, borderRadius: radii.full, paddingVertical: 2, paddingHorizontal: 8 },
});
