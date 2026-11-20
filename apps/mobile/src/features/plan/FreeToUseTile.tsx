import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';
import type { CurrencyCode, FreeToUse } from '@wmbugo/core';
import { amountLabel, controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { Skeleton } from '../../shared/feedback/Feedback';
import { Button } from '../../shared/ui/Button';
import { useSheet } from '../../shared/feedback/SheetHost';
import { isAmountsHidden, useAmountsHidden } from '../../shared/state/amountsHidden';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { moneyText } from '../../shared/ui/moneyText';
import { PLAN_FREE_KEY, realPlanApi, type PlanApi } from './planApi';

const p = copy.plan;

export interface FreeToUseNav {
  /** `Set a limit`: the budget editor with Overall chosen. */
  onSetLimit: () => void;
  /** `Add an account`, or the accounts list when accounts exist but none counts or has a balance. */
  onOpenAccounts: () => void;
  onOpenBudget: (budgetId: string) => void;
  onOpenBudgets: () => void;
  onOpenBills: () => void;
  onOpenGoals: () => void;
}

/** One line of `How we worked this out`: tapping it opens where the figure comes from. */
function Line({ text, sub, highlight, note, onPress, testID }: { text: string; sub?: string; highlight?: boolean; note?: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      {...controlA11y({ label: [text, sub, highlight ? p.howSmaller : null].filter(Boolean).join(', '), role: 'button' })}
      onPress={onPress}
      style={[styles.line, { borderColor: highlight ? theme.color('accent-primary') : theme.color('on-glass-secondary'), borderWidth: highlight ? 2 : 1 }]}>
      <View style={styles.lineText}>
        <Text style={[textStyle('body-medium'), { color: theme.color('on-glass-primary') }]}>{text}</Text>
        {sub ? <Text style={[textStyle('caption'), { color: theme.color('on-glass-secondary') }]}>{sub}</Text> : null}
        {note ? <Text testID={`${testID}-smaller`} style={[textStyle('caption'), { color: theme.color('on-glass-primary') }]}>{note}</Text> : null}
      </View>
      <Icon icon={CaretRight} size={18} color="on-glass-secondary" />
    </Pressable>
  );
}

function HowSheet({ free, currency, locale, payCycle, nav, close }: { free: Extract<FreeToUse, { gate: 'ok' }>; currency: CurrencyCode; locale: string; payCycle: boolean; nav: FreeToUseNav; close: () => void }) {
  const theme = useTheme();
  const money = (n: number) => moneyText(n, currency, locale);
  const go = (fn: () => void) => () => {
    close();
    fn();
  };
  const leaves = free.leavesMinor < 0 ? p.shortBy.replace('{amount}', money(-free.leavesMinor)) : p.howLeaves.replace('{amount}', money(free.leavesMinor));
  const finalLine = free.valueMinor < 0 ? p.shortBy.replace('{amount}', money(-free.valueMinor)) : p.howLeaves.replace('{amount}', money(free.valueMinor));
  return (
    <View testID="free-how" style={styles.sheet}>
      <Line
        testID="free-how-left"
        text={p.howLeft.replace('{amount}', money(Math.abs(free.leftMinor)))}
        {...(free.notClassifiedMinor > 0 ? { sub: p.howLeftNc.replace('{amount}', money(free.notClassifiedMinor)) } : {})}
        highlight={free.smaller === 'left'}
        {...(free.smaller === 'left' ? { note: p.howSmaller } : {})}
        onPress={go(() => (free.leftBudgetId ? nav.onOpenBudget(free.leftBudgetId) : nav.onOpenBudgets()))}
      />
      <Line
        testID="free-how-accounts"
        text={p.howAccounts.replace('{amount}', money(free.assetsMinor))}
        sub={[p.howAccountsCaption, free.notSetAccounts === 1 ? p.howNotSetOne : free.notSetAccounts > 1 ? p.howNotSetMany.replace('{n}', String(free.notSetAccounts)) : null].filter(Boolean).join(' · ')}
        highlight={free.smaller === 'accounts'}
        {...(free.smaller === 'accounts' ? { note: p.howSmaller } : {})}
        onPress={go(nav.onOpenAccounts)}
      />
      <Line
        testID="free-how-bills"
        text={p.howBills.replace('{when}', payCycle ? 'payday' : 'month-end').replace('{amount}', money(free.billsReservedMinor)).replace('{count}', free.billsCount === 1 ? p.howBillsOne : p.howBillsMany.replace('{n}', String(free.billsCount)))}
        onPress={go(nav.onOpenBills)}
      />
      <Line testID="free-how-aside" text={p.howSetAside.replace('{amount}', money(free.setAsideMinor))} onPress={go(nav.onOpenGoals)} />
      <Text testID="free-how-leaves" style={[textStyle('title'), { color: theme.color('on-glass-primary') }]}>{free.smaller === 'accounts' ? leaves : finalLine}</Text>
      <Text style={[textStyle('caption'), { color: theme.color('on-glass-secondary') }]}>{p.howFooter}</Text>
    </View>
  );
}

/**
 * Free to use at the top of Plan (Story 6.9, UX-DR27, UX-DR108): the estimate with `Estimate from what you've entered`, or, when
 * a required input is missing, one 48dp row naming the one next step and never a number or a checklist. Negative reads
 * `Short by ₹5,000` in neutral text, never red and never with a sign. Tapping the figure opens how it was worked out.
 */
export function FreeToUseTile({ plan = realPlanApi, nav }: { plan?: PlanApi; nav: FreeToUseNav }) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: this component builds amount text and labels
  const theme = useTheme();
  const sheet = useSheet();
  const q = useQuery({ queryKey: PLAN_FREE_KEY, queryFn: () => plan.loadFreeToUse() });
  const d = q.data;
  if (q.isError) {
    return (
      <View testID="plan-free-error" accessibilityRole="alert" style={{ gap: 4 }}>
        <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.plan.sectionError}</Text>
        <Button label={copy.plan.retry} variant="text" testID="plan-free-error-retry" onPress={() => void q.refetch()} />
      </View>
    );
  }
  if (d === null) return null;
  if (!d) return <Skeleton height={72} />;
  const f = d.free;
  const need = (step: string, onPress: () => void, testID: string) => (
    <Pressable testID={testID} {...controlA11y({ label: `${p.notEnough}. ${step}`, role: 'button' })} onPress={onPress} style={[styles.need, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body'), { color: theme.color('text-primary'), flexShrink: 1 }]}>{`${p.notEnough} · ${step} →`}</Text>
    </Pressable>
  );
  if (f.gate === 'needs_limit') return need(p.setLimit, nav.onSetLimit, 'free-need-limit');
  if (f.gate === 'needs_account') return need(p.addAccount, nav.onOpenAccounts, 'free-need-account');

  const hidden = isAmountsHidden();
  const money = (n: number) => moneyText(n, d.currency, d.locale);
  const figure = f.valueMinor < 0 ? p.shortBy.replace('{amount}', money(-f.valueMinor)) : money(f.valueMinor);
  const spoken = hidden
    ? p.freeSpokenHidden
    : (f.valueMinor < 0 ? p.freeSpokenShort : p.freeSpoken).replace('{amount}', amountLabel({ amountMinor: Math.abs(f.valueMinor), currency: d.currency, locale: d.locale, inline: true }));
  return (
    <Pressable
      testID="free-tile"
      accessible
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onPress={() => sheet.open({ id: 'free-how', title: p.howTitle, body: (close) => <HowSheet free={f} currency={d.currency} locale={d.locale} payCycle={d.payCycle} nav={nav} close={close} /> })}
      style={[styles.tile, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{p.freeLabel}</Text>
      <Text testID="free-figure" style={[textStyle('headline'), { color: theme.color('text-primary') }]}>{figure}</Text>
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{p.freeCaption}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 4 },
  need: { minHeight: layout.touchMin, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderRadius: radii.md },
  sheet: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radii.md, minHeight: layout.touchMin },
  lineText: { flex: 1, gap: 2 },
});
