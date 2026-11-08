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
  },
  money: {
    amountHidden: 'Amount hidden',
    notSet: 'Not set',
  },
  startup: {
    storageError: "wmbugo couldn't open its secure storage. Nothing was changed.",
  },
  onboarding: {
    placeholder: 'Welcome to wmbugo',
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
