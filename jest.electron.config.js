/**
 * Standalone Jest config for the Electron main-process helpers in electron/lib/.
 *
 * Create React App's test runner only looks inside src/, so the electron/ code
 * (which is plain CommonJS, no JSX/Babel) gets its own project here. Run with:
 *   npm run test:electron
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/electron'],
  testMatch: ['**/*.test.js'],
  // Helpers are plain CJS — skip Babel entirely so no CRA/preset setup is needed.
  transform: {},
};
