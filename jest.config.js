module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/__tests__/**',
    '!src/index.js',
    '!src/reportWebVitals.js',
    '!src/setupTests.js'
  ],
  moduleNameMapper: {
    // Handle CSS imports (if any)
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    // Mock axios for integration tests
    '^axios$': require.resolve('axios')
  },
  transformIgnorePatterns: [
    'node_modules/(?!(axios|supertest)/)'
  ],
  setupFilesAfterEnv: [],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 30000
};