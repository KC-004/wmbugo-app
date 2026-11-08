// SafeAreaProvider renders nothing until native insets arrive; use the library's mock everywhere.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// The real startApp reaches Keystore, SQLCipher and the file system. Tests inject their own services.
jest.mock('./src/adapters/startApp', () => ({
  getServices: jest.fn(),
  startApp: jest.fn(),
  setUpProfile: jest.fn(),
  systemClock: { timezoneId: () => 'Asia/Singapore', nowMs: () => 0 },
}));
