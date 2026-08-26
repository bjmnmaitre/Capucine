/**
 * Jest for the PURE display helpers only.
 *
 * Rendering React Native components under test needs jest-expo plus a native
 * mock layer — disproportionate for this app's size. What actually protects
 * the user here is narrower: the functions that turn backend values into the
 * strings on screen. They are plain TypeScript with no React Native import,
 * so a plain ts-jest transform is enough, and `testMatch` keeps the suite
 * confined to them rather than pretending to cover the screens.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  // Jest's globals are declared in a test-only tsconfig so the app's own
  // tsconfig (and therefore the Expo build) stays untouched.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
