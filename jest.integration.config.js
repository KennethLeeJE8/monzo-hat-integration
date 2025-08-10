module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/src/__tests__/integration/api.test.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup.js'],
  testTimeout: 30000,
  verbose: true,
  collectCoverage: false,
  // Don't transform node_modules
  transformIgnorePatterns: [
    'node_modules/'
  ]
};