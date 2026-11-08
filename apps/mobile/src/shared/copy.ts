/**
 * The single copy catalogue (calm voice, sentence case, no guilt copy, "Rough is
 * fine"). Every named error code maps to one entry here; screens and tests read
 * keys from this object and never write their own strings. Voice rules:
 * EXPERIENCE.md > Voice and Tone and PRD section 6.7.
 */
export const copy = {
  app: { name: 'wmbugo' },
  common: {
    undo: 'Undo',
    tryAgain: 'Try again',
    cancel: 'Cancel',
    save: 'Save',
    saved: 'Saved',
    gotIt: 'Got it',
    close: 'Close',
  },
  errors: {
    nothingSaved: 'Nothing was saved',
  },
  nav: {
    home: 'Home',
    activity: 'Activity',
    insights: 'Insights',
    plan: 'Plan',
    addEntry: 'Add entry',
    accounts: 'Accounts',
    settings: 'Settings',
    profile: 'Profile and settings',
  },
  sheet: {
    addTitle: 'Add entry',
  },
  money: {
    amountHidden: 'Amount hidden',
    notSet: 'Not set',
  },
  startup: {
    storageError: "wmbugo couldn't open its secure storage. Nothing was changed.",
  },
  onboarding: {
    welcomeTitle: 'Welcome to wmbugo',
    welcomeFacts: 'No sign-up · No internet · No bank login',
    continue: 'Continue',
    finish: 'Finish',
    back: 'Back',
    regionTitle: 'Where are you?',
    regionChange: 'Change',
    regionPreview: 'Amounts look like',
    regionNote: 'You can change the currency until you add your first entry.',
    regionHint: 'Choose your region to continue.',
    regionSearch: 'Search country or currency',
    regionNoMatch: 'No match. Try a country name or a currency code.',
    paydayTitle: 'When are you paid?',
    paydayFirst: '1st',
    paydayLast: 'Last day',
    paydayLastWorking: 'Last working day',
    paydayOther: 'Other',
    paydayNone: 'Not salaried',
    paydayDay: 'Day of the month (1 to 31)',
    paydayHint: 'Pick when you are paid to continue.',
    budgetTitle: 'Try 50/30/20?',
    budgetBody: 'A simple way to split your income. Rough is fine.',
    budgetYes: 'Yes, try it',
    budgetNotNow: 'Not now',
    budgetSkip: 'Skip',
    budgetIncome: 'Rough monthly income',
    budgetHint: 'Answer, or skip, to finish.',
    saveError: 'Something went wrong while setting up.',
  },
} as const;

type Leaf = string;
type Tree = { readonly [k: string]: Tree | Leaf };

/** Flattens the catalogue to dotted keys, for tests and for key-based lookups. */
export function copyEntries(tree: Tree = copy, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : copyEntries(v, `${prefix}${k}.`),
  );
}
