module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The suite is large and its screen tests render whole trees: under a full parallel run a slow worker must not fail a test on the default 5 s.
  testTimeout: 20000,
  // ESM-only navigation packages must be transformed by Babel.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|phosphor-react-native|react-native-svg|lottie-react-native)/)',
  ],
};
