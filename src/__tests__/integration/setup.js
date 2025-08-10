// Integration test setup
require('dotenv').config();

// Ensure we're in test environment
process.env.NODE_ENV = 'test';

// Set test-specific configurations
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Global test timeout
jest.setTimeout(30000);

console.log('🧪 Integration Test Setup Complete');
console.log('Environment:', {
  hasMonzoToken: !!process.env.MONZO_ACCESS_TOKEN,
  hasWalletCreds: !!(process.env.DATASWIFT_USERNAME && process.env.DATASWIFT_PASSWORD),
  applicationId: process.env.DS_APPLICATION_ID || 'oi-s-monzodataconnector'
});