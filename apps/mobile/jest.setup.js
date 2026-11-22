// SafeAreaProvider renders nothing until native insets arrive; use the library's mock everywhere.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// The real startApp reaches Keystore, SQLCipher and the file system. Tests inject their own services.
jest.mock('./src/adapters/startApp', () => ({
  getServices: jest.fn(),
  startApp: jest.fn(),
  setUpProfile: jest.fn(),
  takeRestoreOutcome: () => 'none',
  systemClock: { timezoneId: () => 'Asia/Singapore', nowMs: () => 0 },
}));

// The libsodium binding is native (JSI) and ships untranspiled ESM; tests that need real crypto mock it with libsodium-wrappers-sumo
// (see adapters/backup/rnCrypto.test.ts). Everywhere else it only has to import.
jest.mock('react-native-libsodium', () => ({ __esModule: true, default: {} }));

// Reads and writes a file in the private directory; the notice host is tested with an injected reader.
jest.mock('./src/adapters/backup/restoreNotice', () => ({ takeRestoreNotice: async () => null, rememberRestoreNotice: async () => undefined }));

// The file system binding pulls in ESM-only packages; everywhere that does not test file behaviour gets the in-memory stand-in.
jest.mock('@dr.pogodin/react-native-fs', () => require('./src/testing/memoryRnfs').rnfsModule);

// The keychain binding is native and throws on import; tests that need keys mock `keychainKeyStore` itself.
jest.mock('react-native-keychain', () => ({ __esModule: true }));
