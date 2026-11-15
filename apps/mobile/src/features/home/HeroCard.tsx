import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Eye, EyeSlash, Warning } from 'phosphor-react-native';
import { notSetNote, type CurrencyCode, type HomeSummary } from '@wmbugo/core';
import { controlA11y, spokenAmount } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { Glass } from '../../shared/theme/Glass';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { moneyText } from '../../shared/ui/moneyText';
import { HeroBar, TRACK_ALPHA, withAlpha } from './HeroBar';
import { heroLabel } from './heroLabels';
import type { HeroView } from './heroPresenter';

export interface HeroCardProps {
  view: HeroView;
  summary: HomeSummary;
  currency: CurrencyCode;
  locale?: string;
  /** Amounts masked (Story 5.3 owns where this comes from). */
  hidden?: boolean;
  onToggleHidden?: () => void;
  /** Slow recompute: the caption says `Updating…` and the old values stay. */
  updating?: boolean;
  onOpen: () => void;
  onSetLimit: () => void;
  onSortIt: () => void;
  onAddAccount: () => void;
}

const dailyLine = (view: HeroView, currency: CurrencyCode, locale: string | undefined, hidden: boolean): string | null => {
  if (view.state === 'spent_only' || !view.daysText) return null;
  if (view.perDayMinor === null) return view.daysText;
  return copy.home.hero.perDay.replace('{amount}', `~${moneyText(view.perDayMinor, currency, locale, hidden)}`).replace('{days}', view.daysText);
};

/**
 * The "Am I okay?" hero (UX-DR22/23): a glass card with the label, the headline amount, the hero bar, the caption, the daily
 * line and, below a divider, In accounts and Card dues side by side (stacked at large text), never summed. The merged
 * TalkBack node is built from the view model; the eye, `Set a limit`, `Sort it` and `Add an account` are separate nodes.
 */
export function HeroCard({ view, summary, currency, locale, hidden = false, onToggleHidden, updating = false, onOpen, onSetLimit, onSortIt, onAddAccount }: HeroCardProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const stack = fontScale >= 1.3;
  const ink = theme.color('on-glass-primary');
  const soft = theme.color('on-glass-secondary');
  const a = summary.accounts;
  const daily = dailyLine(view, currency, locale, hidden);
  const hasBar = view.usedMinor !== null && view.targetMinor !== null;
  const caption = updating
    ? copy.home.updating
    : hasBar
      ? copy.budgets.ofTarget.replace('{used}', moneyText(view.usedMinor!, currency, locale, hidden)).replace('{target}', moneyText(view.targetMinor!, currency, locale, hidden))
      : null;
  const divider = { backgroundColor: withAlpha(ink, TRACK_ALPHA) };
  const loc = locale ? { locale } : {};

  const accountsLine = a.hasAccounts ? (
    <View testID="hero-accounts" style={[styles.accounts, stack ? styles.column : styles.row]}>
      <View style={styles.cell}>
        <Text style={[textStyle('caption'), { color: soft }]}>{copy.home.inAccounts}</Text>
        {a.inAccountsMinor === null ? (
          <Text style={[textStyle('body-medium'), { color: ink }]}>{copy.money.notSet}</Text>
        ) : (
          <Amount amountMinor={a.inAccountsMinor} currency={currency} direction="neutral" role="body-medium" color="on-glass-primary" hidden={hidden} {...loc} />
        )}
        {notSetNote(a.notSetCount, 'account') ? (
          <Text testID="not-set-note" style={[textStyle('caption'), { color: soft }]}>
            {notSetNote(a.notSetCount, 'account')}
          </Text>
        ) : null}
      </View>
      {a.cardDuesMinor !== null || a.notSetCards > 0 ? (
        <View style={styles.cell}>
          <Text style={[textStyle('caption'), { color: soft }]}>{copy.home.cardDues}</Text>
          {a.cardDuesMinor === null ? (
            <Text style={[textStyle('body-medium'), { color: ink }]}>{copy.money.notSet}</Text>
          ) : (
            <Amount amountMinor={a.cardDuesMinor} currency={currency} direction="neutral" role="body-medium" color="on-glass-primary" hidden={hidden} {...loc} />
          )}
          {notSetNote(a.notSetCards, 'card') ? (
            <Text testID="not-set-cards-note" style={[textStyle('caption'), { color: soft }]}>
              {notSetNote(a.notSetCards, 'card')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  ) : (
    <Text testID="hero-set-up-account" style={[textStyle('body'), { color: ink }]}>
      {copy.home.setUpAccount}
    </Text>
  );

  return (
    <Glass testID="hero-card" style={styles.card}>
      <Pressable testID="hero-main" accessible accessibilityRole="button" accessibilityLabel={heroLabel(view, summary, currency, locale, hidden)} onPress={onOpen} style={styles.main}>
        <View style={[styles.labelRow, { paddingRight: 56 }]}>
          {view.state === 'over' ? <Icon icon={Warning} size={20} tint={theme.color('on-glass-warning')} /> : null}
          <Text testID="hero-label" style={[textStyle('label'), { color: soft }]}>
            {view.label}
          </Text>
        </View>
        <View style={styles.amount}>
          <Amount amountMinor={view.amountMinor ?? 0} currency={currency} direction="neutral" role="display-amount" color="on-glass-primary" hidden={hidden} testID="hero-amount" {...loc} />
        </View>
        {hasBar ? (
          <View style={styles.bar}>
            <HeroBar usedMinor={view.usedMinor!} targetMinor={view.targetMinor!} hidden={hidden} />
          </View>
        ) : null}
        {caption ? (
          <Text testID="hero-caption" style={[textStyle('caption'), { color: soft }]}>
            {caption}
          </Text>
        ) : null}
        {daily ? (
          <Text testID="hero-daily" style={[textStyle('caption'), styles.daily, { color: soft }]}>
            {daily}
          </Text>
        ) : null}
        {a.hasAccounts ? (
          <>
            <View style={[styles.divider, divider]} />
            {accountsLine}
          </>
        ) : null}
      </Pressable>

      {onToggleHidden ? (
        <Pressable testID="hero-eye" onPress={onToggleHidden} {...controlA11y({ label: copy.home.hero.hideAmounts, role: 'togglebutton', checked: hidden })} style={styles.eye}>
          <Icon icon={hidden ? EyeSlash : Eye} size={24} tint={ink} />
        </Pressable>
      ) : null}

      {!a.hasAccounts ? (
        <View style={styles.setup}>
          <View style={[styles.divider, divider]} />
          {accountsLine}
          <Button label={copy.home.addAccount} variant="text" onGlass onPress={onAddAccount} testID="home-add-account" />
        </View>
      ) : null}

      {view.notClassified && summary.sortIt ? (
        <View testID="hero-not-classified" style={styles.row48}>
          <Text style={[textStyle('caption'), { color: soft }]}>{copy.home.hero.includesNotClassified.replace('{amount}', moneyText(summary.notClassifiedMinor, currency, locale, hidden))}</Text>
          <Pressable
            testID="hero-sort-it"
            {...controlA11y({ label: `Sort ${hidden ? 'amount hidden' : spokenAmount(summary.notClassifiedMinor, currency, locale)} of unclassified spending`, role: 'button' })}
            onPress={onSortIt}
            style={styles.link}>
            <Text style={[textStyle('label'), styles.underline, { color: ink }]}>{copy.home.hero.sortIt}</Text>
          </Pressable>
        </View>
      ) : null}
      {view.state === 'spent_only' ? (
        <Pressable testID="hero-set-limit" {...controlA11y({ label: copy.home.hero.setLimit, role: 'button' })} onPress={onSetLimit} style={styles.link}>
          <Text style={[textStyle('label'), styles.underline, { color: ink }]}>{copy.home.hero.setLimit}</Text>
        </Pressable>
      ) : null}
    </Glass>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  main: { gap: 0 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  amount: { marginTop: 4, marginBottom: 12 },
  bar: { marginBottom: 8 },
  daily: { marginTop: 4 },
  divider: { height: 1, marginVertical: 12 },
  accounts: { gap: 16 },
  row: { flexDirection: 'row' },
  column: { flexDirection: 'column', gap: 12 },
  cell: { flex: 1, gap: 2 },
  eye: { position: 'absolute', top: 4, right: 4, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  setup: { gap: 4 },
  row48: { minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  link: { minHeight: 48, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
});
