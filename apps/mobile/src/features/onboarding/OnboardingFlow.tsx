import { useMemo, useReducer, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  canContinue,
  continueHint,
  getCurrency,
  initialOnboarding,
  isComplete,
  onboardingReducer,
  parseRoughIncome,
  searchRegions,
  type PaydayChoice,
  type Region,
  type SetUpProfileInput,
} from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { CoinMark } from '../../shared/brand/CoinMark';
import { copy } from '../../shared/copy';
import { currencySymbol } from '../../shared/currencySymbol';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';

/** A sample amount, 1,234.50 in the region's currency, shown through the shared <Amount> (never formatted here). */
export function sampleMinor(region: Region): number {
  const cur = getCurrency(region.currency);
  const exponent = cur.ok ? cur.value.exponent : 2;
  return exponent === 0 ? 1234 : Number(`1234${'5'.padEnd(exponent, '0')}`);
}

const PAYDAY_CHIPS: readonly { choice: PaydayChoice; label: string }[] = [
  { choice: 'first', label: copy.onboarding.paydayFirst },
  { choice: 'last_day', label: copy.onboarding.paydayLast },
  { choice: 'last_working_day', label: copy.onboarding.paydayLastWorking },
  { choice: 'other', label: copy.onboarding.paydayOther },
  { choice: 'none', label: copy.onboarding.paydayNone },
];

export interface OnboardingFlowProps {
  /** The device region, if it is a Phase 1 market. It is pre-selected but must still be confirmed. */
  detected: Region | null;
  timezoneId: string;
  /** Writes the profile (SetUpProfile). Resolves true when saved. Called only after the last step. */
  onFinish: (input: SetUpProfileInput) => Promise<boolean>;
}

/**
 * Onboarding: Welcome, region and currency, payday, optional 50/30/20. All answers stay in memory
 * until Finish, so process death restarts at Welcome with nothing written. No permission is requested.
 */
export function OnboardingFlow({ detected, timezoneId, onFinish }: OnboardingFlowProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(onboardingReducer, detected, initialOnboarding);
  const [picking, setPicking] = useState(false);
  const [otherSelected, setOtherSelected] = useState(false);
  const [dayText, setDayText] = useState('');
  const [wantsBudget, setWantsBudget] = useState(false);
  const [incomeText, setIncomeText] = useState('');
  const [failed, setFailed] = useState(false);
  // A ref, not state: two quick taps on Finish must save once (state would still be stale on the second tap).
  const saving = useRef(false);

  const hint = continueHint(state);
  const last = state.step === 'budget-offer';
  const ink = { color: theme.color('text-primary') };
  const secondary = { color: theme.color('text-secondary') };

  const finish = async () => {
    if (!isComplete(state) || saving.current || state.region === null || state.payday === null || state.budgetOffer === null) return;
    saving.current = true;
    setFailed(false);
    const ok = await onFinish({ region: state.region, payday: state.payday, budgetOffer: state.budgetOffer, timezoneId });
    if (!ok) {
      setFailed(true);
      saving.current = false;
    }
  };

  if (picking) {
    return (
      <RegionPicker
        detected={detected}
        onPick={(region) => {
          dispatch({ type: 'choose-region', region });
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color('bg-canvas'), paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {state.step === 'welcome' ? (
          <View style={styles.center}>
            <CoinMark size={96} />
            <Text accessibilityRole="header" style={[textStyle('title'), ink, styles.centerText]}>{copy.onboarding.welcomeTitle}</Text>
            <Text style={[textStyle('body'), secondary, styles.centerText]}>{copy.onboarding.welcomeFacts}</Text>
          </View>
        ) : null}

        {state.step === 'region' ? (
          <View style={styles.gap}>
            <Text accessibilityRole="header" style={[textStyle('title'), ink]}>{copy.onboarding.regionTitle}</Text>
            {state.region ? (
              <View style={styles.gap}>
                <Text testID="region-summary" style={[textStyle('title-sm'), ink]}>
                  {`${state.region.name} · ${currencySymbol(state.region.currency, state.region.locale)} ${state.region.currency}`}
                </Text>
                <View testID="region-preview" style={styles.preview}>
                  <Text style={[textStyle('body'), secondary]}>{copy.onboarding.regionPreview}</Text>
                  <Amount amountMinor={sampleMinor(state.region)} currency={state.region.currency} direction="neutral" role="body" locale={state.region.locale} color="text-secondary" />
                </View>
              </View>
            ) : null}
            <Button label={copy.onboarding.regionChange} variant="secondary" onPress={() => setPicking(true)} testID="region-change" />
            <Text style={[textStyle('caption'), secondary]}>{copy.onboarding.regionNote}</Text>
          </View>
        ) : null}

        {state.step === 'payday' ? (
          <View style={styles.gap}>
            <Text accessibilityRole="header" style={[textStyle('title'), ink]}>{copy.onboarding.paydayTitle}</Text>
            <View style={styles.chips}>
              {PAYDAY_CHIPS.map(({ choice, label }) => (
                <Chip
                  key={choice}
                  label={label}
                  variant="period"
                  testID={`payday-${choice}`}
                  selected={choice === 'other' ? otherSelected : !otherSelected && state.payday?.kind === choice}
                  onPress={() => {
                    setOtherSelected(choice === 'other');
                    if (choice === 'other') dispatch({ type: 'choose-payday', choice, day: Number(dayText) });
                    else dispatch({ type: 'choose-payday', choice });
                  }}
                />
              ))}
            </View>
            {otherSelected ? (
              <TextInput
                testID="payday-day"
                accessibilityLabel={copy.onboarding.paydayDay}
                placeholder={copy.onboarding.paydayDay}
                keyboardType="number-pad"
                value={dayText}
                maxLength={2}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, '');
                  setDayText(clean);
                  dispatch({ type: 'choose-payday', choice: 'other', day: Number(clean) });
                }}
                style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('border-control') }]}
                placeholderTextColor={theme.color('text-secondary')}
              />
            ) : null}
          </View>
        ) : null}

        {state.step === 'budget-offer' ? (
          <View style={styles.gap}>
            <Text accessibilityRole="header" style={[textStyle('title'), ink]}>{copy.onboarding.budgetTitle}</Text>
            <Text style={[textStyle('body'), secondary]}>{copy.onboarding.budgetBody}</Text>
            <View style={styles.chips}>
              <Chip
                label={copy.onboarding.budgetYes}
                testID="budget-yes"
                selected={wantsBudget}
                onPress={() => {
                  setWantsBudget(true);
                  const parsed = state.region ? parseRoughIncome(incomeText, state.region) : { ok: false as const };
                  dispatch(parsed.ok ? { type: 'answer-budget', offer: { answer: 'yes', roughMonthlyIncomeMinor: parsed.minor } } : { type: 'clear-budget' });
                }}
              />
              <Chip
                label={copy.onboarding.budgetNotNow}
                testID="budget-not-now"
                selected={!wantsBudget && state.budgetOffer?.answer === 'not-now'}
                onPress={() => {
                  setWantsBudget(false);
                  dispatch({ type: 'answer-budget', offer: { answer: 'not-now' } });
                }}
              />
              <Chip
                label={copy.onboarding.budgetSkip}
                testID="budget-skip"
                selected={!wantsBudget && state.budgetOffer?.answer === 'skipped'}
                onPress={() => {
                  setWantsBudget(false);
                  dispatch({ type: 'answer-budget', offer: { answer: 'skipped' } });
                }}
              />
            </View>
            {wantsBudget ? (
              <TextInput
                testID="budget-income"
                accessibilityLabel={copy.onboarding.budgetIncome}
                placeholder={copy.onboarding.budgetIncome}
                keyboardType="decimal-pad"
                value={incomeText}
                onChangeText={(t) => {
                  setIncomeText(t);
                  const parsed = state.region ? parseRoughIncome(t, state.region) : { ok: false as const };
                  dispatch(parsed.ok ? { type: 'answer-budget', offer: { answer: 'yes', roughMonthlyIncomeMinor: parsed.minor } } : { type: 'clear-budget' });
                }}
                style={[styles.input, textStyle('body'), ink, { borderColor: theme.color('border-control') }]}
                placeholderTextColor={theme.color('text-secondary')}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {failed ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>
            {`${copy.onboarding.saveError} ${copy.errors.nothingSaved}`}
          </Text>
        ) : null}
        {hint ? (
          <Text style={[textStyle('caption'), secondary]}>
            {hint === 'choose-region' ? copy.onboarding.regionHint : hint === 'choose-payday' ? copy.onboarding.paydayHint : copy.onboarding.budgetHint}
          </Text>
        ) : null}
        <View style={styles.row}>
          {state.step !== 'welcome' ? <Button label={copy.onboarding.back} variant="text" onPress={() => dispatch({ type: 'back' })} testID="onboarding-back" /> : <View />}
          <Button
            label={last ? copy.onboarding.finish : copy.onboarding.continue}
            testID="onboarding-continue"
            onPress={last ? () => void finish() : () => dispatch({ type: 'continue' })}
            disabledReason={canContinue(state) ? undefined : (hint === 'choose-region' ? copy.onboarding.regionHint : hint === 'choose-payday' ? copy.onboarding.paydayHint : copy.onboarding.budgetHint)}
          />
        </View>
      </View>
    </View>
  );
}

function RegionPicker({ detected, onPick, onClose }: { detected: Region | null; onPick: (r: Region) => void; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchRegions(query, detected), [query, detected]);
  return (
    <View style={[styles.fill, { backgroundColor: theme.color('bg-canvas'), paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.gap}>
        <TextInput
          testID="region-search"
          accessibilityLabel={copy.onboarding.regionSearch}
          placeholder={copy.onboarding.regionSearch}
          value={query}
          onChangeText={setQuery}
          autoFocus
          style={[styles.input, textStyle('body'), { color: theme.color('text-primary'), borderColor: theme.color('border-control'), margin: 16 }]}
          placeholderTextColor={theme.color('text-secondary')}
        />
      </View>
      {results.length === 0 ? (
        <Text style={[textStyle('body'), { color: theme.color('text-secondary'), padding: 16 }]}>{copy.onboarding.regionNoMatch}</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              testID={`region-${item.code}`}
              {...controlA11y({ label: `${item.name}, ${item.currency}`, role: 'button' })}
              onPress={() => onPick(item)}
              style={[styles.option, { borderBottomColor: theme.color('border-hairline') }]}>
              <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{`${item.name} · ${currencySymbol(item.currency, item.locale)} ${item.currency}`}</Text>
            </Pressable>
          )}
        />
      )}
      <View style={styles.footer}>
        <Button label={copy.common.cancel} variant="text" onPress={onClose} testID="region-cancel" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flexGrow: 1, padding: 16, justifyContent: 'center' },
  center: { alignItems: 'center', gap: 16 },
  centerText: { textAlign: 'center' },
  gap: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preview: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 },
  footer: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: layout.touchMin },
  option: { minHeight: layout.touchMin, paddingHorizontal: 16, justifyContent: 'center', borderBottomWidth: 1 },
});
