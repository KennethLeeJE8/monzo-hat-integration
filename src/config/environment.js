require('dotenv').config();

const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT) || 8080,
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  },

  // Monzo API configuration
  monzo: {
    clientId: process.env.MONZO_CLIENT_ID,
    clientSecret: process.env.MONZO_CLIENT_SECRET,
    redirectUrl: process.env.MONZO_REDIRECT_URI,
    grantType: 'authorization_code',
    baseUrl: process.env.MONZO_BASE_URL || 'https://api.monzo.com',
    tokenUrl: 'https://api.monzo.com/oauth2/token',
    apiVersion: process.env.MONZO_API_VERSION || 'v1',
    rateLimitPerSecond: parseInt(process.env.MONZO_RATE_LIMIT_PER_SECOND) || 10,
    timeout: parseInt(process.env.MONZO_TIMEOUT) || 30000
  },

  // Dataswyft Wallet configuration
  wallet: {
    apiUrl: process.env.DATASWIFT_API_URL || 'https://postman.hubat.net',
    username: process.env.DATASWIFT_USERNAME,
    password: process.env.DATASWIFT_PASSWORD,
    timeout: parseInt(process.env.WALLET_TIMEOUT) || 30000,
    namespace: process.env.MONZO_NAMESPACE || 'monzo_banking'
  },

  // Gateway configuration
  gateway: {
    applicationId: process.env.DS_APPLICATION_ID,
    jwtSecret: process.env.JWT_SECRET,
    tokenExpiry: process.env.JWT_EXPIRY || '1h'
  },

  // Retry configuration
  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS) || 3,
    baseDelay: parseInt(process.env.RETRY_BASE_DELAY) || 1000,
    maxDelay: parseInt(process.env.RETRY_MAX_DELAY) || 30000,
    backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER) || 2
  }
};

// Validation
const requiredEnvVars = [
  'MONZO_CLIENT_ID',
  'MONZO_CLIENT_SECRET',
  'JWT_SECRET'
];

// Optional variables (not required for Phase 2 testing)
const optionalEnvVars = [
  'DATASWIFT_USERNAME', 
  'DATASWIFT_PASSWORD'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Log warnings for missing optional variables
const missingOptionalVars = optionalEnvVars.filter(varName => !process.env[varName]);
if (missingOptionalVars.length > 0) {
  console.warn(`Warning: Missing optional environment variables: ${missingOptionalVars.join(', ')} (required for Phase 4)`);
}

module.exports = config;