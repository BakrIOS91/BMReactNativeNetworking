module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  globals: { __DEV__: false },
  moduleNameMapper: { '^react-native$': '<rootDir>/__tests__/mocks/react-native.tsx' },
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  coverageThreshold: { global: { statements: 100, branches: 100, functions: 100, lines: 100 } },
};
