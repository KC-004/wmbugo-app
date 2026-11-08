// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const BOUNDARY_MESSAGE =
  'Boundary: packages/core is pure TypeScript and must not depend on react-native, drizzle-orm or op-sqlite. Put this in apps/mobile (adapters) behind a core port.';

const forbiddenInCore = ['react-native', 'drizzle-orm', '@op-engineering/op-sqlite'];


// Shared by the app-wide design guards and the stricter feature-code block below.
const designImportPaths = [
    { name: 'react-native', importNames: ['ActivityIndicator'], message: 'Spinners are banned. Use a skeleton or inline state.' },
    ...['react-native-vector-icons', '@expo/vector-icons', 'lucide-react-native', '@tabler/icons-react-native', 'react-native-elements', 'react-native-paper', 'react-native-ui-lib', 'native-base'].map((name) => ({
      name,
      message: 'Phosphor (via shared/theme Icon) is the only icon set, and there is no UI kit.',
    })),
];
const designSyntax = [
  { selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: 'Colour literal: use a theme token (shared/theme). Hex values live only in the token module.' },
  { selector: 'Literal[value=/\\p{Extended_Pictographic}/u]', message: 'No emoji in UI strings; use a Phosphor icon.' },
  { selector: 'TemplateElement[value.raw=/\\p{Extended_Pictographic}/u]', message: 'No emoji in UI strings; use a Phosphor icon.' },
  { selector: 'JSXText[value=/\\p{Extended_Pictographic}/u]', message: 'No emoji in UI strings; use a Phosphor icon.' },
  { selector: 'Literal[value=/\\binbox\\b/i]', message: 'The word "Inbox" is banned in UI copy.' },
  { selector: 'JSXText[value=/\\binbox\\b/i]', message: 'The word "Inbox" is banned in UI copy.' },
  { selector: 'Literal[value=/coming soon/i]', message: '"Coming soon" is banned: unavailable features are not shown at all.' },
  { selector: 'JSXText[value=/coming soon/i]', message: '"Coming soon" is banned: unavailable features are not shown at all.' },
  { selector: 'JSXIdentifier[name=/^ActivityIndicator$/]', message: 'Spinners are banned. Use a skeleton or inline state.' },
  { selector: 'JSXAttribute[name.name=/^(badge|badgeCount|badgeNumber)$/]', message: 'Numeric badges are banned.' },
  { selector: 'Property[key.name=/^(shadow(Color|Offset|Opacity|Radius)|elevation|textShadow(Color|Offset|Radius))$/]', message: 'Shadows are banned except the ＋ button token (shared/theme elevation).' },
];

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
    // Design-system guards for shipped app code (Story 1.8). Tests may assert colours and strings.
    files: ['apps/mobile/src/**/*.{ts,tsx}', 'apps/mobile/App.tsx'],
    ignores: ['**/*.test.{ts,tsx}', 'apps/mobile/src/shared/theme/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...designImportPaths,
          ],
          patterns: [{ group: ['react-native-vector-icons/*', '@expo/vector-icons/*'], message: 'Phosphor is the only icon set.' }],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...designSyntax,
      ],
    },
  },
  {
    // Feature code never formats money itself: <Amount> is the only way to render it (Story 1.9).
    files: ['apps/mobile/src/features/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: designImportPaths,
          patterns: [
            { group: ['react-native-vector-icons/*', '@expo/vector-icons/*'], message: 'Phosphor is the only icon set.' },
            { group: ['**/formatAmount', '**/shared/formatAmount', '**/shared/formatAmount.ts'], message: 'Render money with <Amount> (shared/ui). Feature code never calls the formatter.' },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Intl', property: 'NumberFormat', message: 'Render money with <Amount>; feature code does not format numbers.' },
        { property: 'toLocaleString', message: 'Render money with <Amount>; feature code does not format numbers.' },
        { property: 'toFixed', message: 'Render money with <Amount>; no float formatting of money.' },
      ],
      'no-restricted-syntax': ['error', ...designSyntax],
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
