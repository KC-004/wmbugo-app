// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const BOUNDARY_MESSAGE =
  'Boundary: packages/core is pure TypeScript and must not depend on react-native, drizzle-orm or op-sqlite. Put this in apps/mobile (adapters) behind a core port.';

const forbiddenInCore = ['react-native', 'drizzle-orm', '@op-engineering/op-sqlite'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/coverage/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'apps/mobile/vendor/**',
      '_bmad/**',
      '_bmad-output/**',
      '.agents/**',
      '.claude/**',
      'input/**',
      'scripts/__fixtures__/**',
      'packages/core/__forbidden__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-side config and tooling files.
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.es2022 } },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx,js}'],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    // No console.log in shipped source: logging goes through the Logger port.
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}', 'apps/mobile/App.tsx', 'apps/mobile/index.js'],
    rules: { 'no-console': 'error' },
  },
  {
    // Core takes all time from the Clock port: no ambient clock reads.
    files: ['packages/core/src/**/*.{ts,tsx}'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use the Clock port, not Date.now().' },
        { object: 'performance', property: 'now', message: 'Use the Clock port.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'NewExpression[callee.name="Date"][arguments.length=0]', message: 'new Date() reads the ambient clock. Use the Clock port.' },
        { selector: 'CallExpression[callee.name="Date"]', message: 'Date() reads the ambient clock. Use the Clock port.' },
      ],
    },
  },
  {
    files: ['packages/core/**/*.{ts,tsx,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: forbiddenInCore.map((name) => ({ name, message: BOUNDARY_MESSAGE })),
          patterns: [
            ...forbiddenInCore.map((name) => ({ group: [`${name}/*`], message: BOUNDARY_MESSAGE })),
            { group: ['react-native-*', '@react-native/*'], message: BOUNDARY_MESSAGE },
          ],
        },
      ],
    },
  },
);
