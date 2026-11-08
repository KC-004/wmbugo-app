/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ["<rootDir>/src", "<rootDir>/test"],
  transform: {
    '^.+[.]tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
