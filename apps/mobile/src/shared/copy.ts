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
    balanceNotSet: 'Balance not set',
  },
  accounts: {
    title: 'Accounts',
    question: "Where's most of your money?",
    roughIsFine: 'Rough is fine',
    nameLabel: 'Account name',
    balanceLabel: 'Balance today',
    balanceLabelCard: 'Amount owed today',
    nameRequired: 'Error: name required',
    balanceInvalid: 'Enter a number, like 3200 or 3200.50.',
    balanceExcess: 'That has more decimals than this currency uses.',
    balanceTooLarge: 'That number is too large.',
    add: 'Add account',
    save: 'Save account',
    skip: 'Skip for now',
    rename: 'Rename',
    renameSave: 'Save name',
    moveUp: 'Move up',
    moveDown: 'Move down',
    archive: 'Archive',
    archived: 'Archived',
    restoreFailed: 'Could not restore the account.',
    empty: 'No accounts yet. Add the one where most of your money is.',
    cardOwed: 'Owed',
    typeCash: 'Cash',
    typeBank: 'Bank account',
    typeWallet: 'Payment wallet',
    typeSavings: 'Savings pot',
    typeCard: 'Credit card',
    saveError: 'Could not save the account.',
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
    accountHint: 'Add an account or skip this step to continue.',
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
