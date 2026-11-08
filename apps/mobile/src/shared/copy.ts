/**
 * The single copy catalogue (calm voice, sentence case). Every named error
 * code maps to one entry here; screens never write their own strings.
 */
export const copy = {
  app: { name: 'wmbugo' },
  startup: {
    storageError: "wmbugo couldn't open its secure storage. Nothing was changed.",
  },
  onboarding: {
    placeholder: 'Welcome to wmbugo',
  },
} as const;
