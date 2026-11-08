import { findRegion, type Region } from './regions';
import { paydayFromChoice, type PaydayChoice, type PaydayRule } from './payday';
import { parseAmountInput } from '../shared/money';
import { getCurrency } from '../shared/currency';

export type OnboardingStep = 'welcome' | 'region' | 'payday' | 'budget-offer';
export const STEPS: readonly OnboardingStep[] = ['welcome', 'region', 'payday', 'budget-offer'];

export type BudgetOffer = { readonly answer: 'yes'; readonly roughMonthlyIncomeMinor: number } | { readonly answer: 'not-now' } | { readonly answer: 'skipped' };

export interface OnboardingState {
  readonly step: OnboardingStep;
  /** Chosen region, or null when nothing is chosen yet (an unsupported device region pre-selects nothing). */
  readonly region: Region | null;
  readonly payday: PaydayRule | null;
  readonly budgetOffer: BudgetOffer | null;
}

export type OnboardingAction =
  | { type: 'continue' }
  | { type: 'back' }
  | { type: 'choose-region'; region: Region }
  | { type: 'choose-payday'; choice: PaydayChoice; day?: number }
  | { type: 'answer-budget'; offer: BudgetOffer }
  | { type: 'clear-budget' };

/** Starts at Welcome with the device region pre-selected only when it is a Phase 1 market. */
export function initialOnboarding(detected: Region | null): OnboardingState {
  return { step: 'welcome', region: detected, payday: null, budgetOffer: null };
}

/** Whether Continue is enabled on the current step. */
export function canContinue(state: OnboardingState): boolean {
  switch (state.step) {
    case 'welcome':
      return true;
    case 'region':
      return state.region !== null;
    case 'payday':
      return state.payday !== null;
    case 'budget-offer':
      return state.budgetOffer !== null;
  }
}

/** Why Continue is disabled, for the hint under the button. */
export function continueHint(state: OnboardingState): 'choose-region' | 'choose-payday' | 'answer-budget' | null {
  if (canContinue(state)) return null;
  return state.step === 'region' ? 'choose-region' : state.step === 'payday' ? 'choose-payday' : 'answer-budget';
}

/** Pure reducer: Back never discards earlier answers; nothing here touches storage. */
export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'continue': {
      if (!canContinue(state)) return state;
      const i = STEPS.indexOf(state.step);
      return i < STEPS.length - 1 ? { ...state, step: STEPS[i + 1]! } : state;
    }
    case 'back': {
      const i = STEPS.indexOf(state.step);
      return i > 0 ? { ...state, step: STEPS[i - 1]! } : state;
    }
    case 'choose-region':
      return findRegion(action.region.code) ? { ...state, region: action.region } : state;
    case 'choose-payday': {
      const rule = paydayFromChoice(action.choice, action.day);
      return rule.ok ? { ...state, payday: rule.value } : { ...state, payday: null };
    }
    case 'answer-budget':
      return { ...state, budgetOffer: action.offer };
    case 'clear-budget':
      return { ...state, budgetOffer: null };
  }
}

/** The last step is answered (even by skipping), so the profile can be written. */
export function isComplete(state: OnboardingState): boolean {
  return state.region !== null && state.payday !== null && state.budgetOffer !== null;
}

/** Parses the rough monthly income typed on the 50/30/20 step in the profile currency. */
export function parseRoughIncome(text: string, region: Region): { ok: true; minor: number } | { ok: false } {
  const cur = getCurrency(region.currency);
  if (!cur.ok) return { ok: false };
  const r = parseAmountInput(text, cur.value.exponent);
  return r.ok && r.value > 0 ? { ok: true, minor: r.value } : { ok: false };
}
