const config = require('./environment');

// Monzo-specific configuration following data connector template
const monzoConfig = {
  // Provider identification
  provider: {
    name: "monzo",
    version: "1.0.0",
    namespace: "monzo_banking"
  },

  // Authentication configuration
  auth: {
    type: "oauth2",
    config: {
      clientId: config.monzo.clientId,
      clientSecret: config.monzo.clientSecret,
      tokenUrl: config.monzo.tokenUrl,
      redirectUrl: config.monzo.redirectUrl,
      grantType: config.monzo.grantType,
      scope: "read" // Monzo read permissions
    }
  },

  // API endpoint configuration
  endpoints: {
    base: config.monzo.baseUrl,
    accounts: "/accounts",
    transactions: "/transactions",
    balance: "/balance",
    version: config.monzo.apiVersion
  },

  // Search configuration (for account lookup)
  search: {
    method: "GET",
    parameterName: "email", // Not directly supported by Monzo, will need account mapping
    fields: ["id", "description", "currency", "owners", "legal_entity", "owner_type"]
  },

  // Rate limiting
  rateLimit: {
    requestsPerSecond: config.monzo.rateLimitPerSecond,
    requestsPerMinute: config.monzo.rateLimitPerSecond * 60,
    burstLimit: 20
  },

  // Request configuration
  request: {
    timeout: config.monzo.timeout,
    retries: config.retry.maxAttempts,
    retryDelay: config.retry.baseDelay,
    userAgent: `MonzoDataConnector/${config.server.version || '1.0.0'}`
  },

  // Custom headers
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },

  // Data field mappings (Monzo → Wallet format)
  fieldMappings: {
    // Account mappings
    account: {
      "id": "monzo_account_id",
      "description": "account_name",
      "owners[0].preferred_name": "account_holder",
      "currency": "currency",
      "legal_entity": "legal_entity", 
      "owner_type": "owner_type",
      "created": "account_created",
      "closed": "account_closed"
    },
    // Transaction mappings
    transaction: {
      "id": "monzo_transaction_id",
      "amount": "amount",
      "currency": "currency",
      "description": "description", 
      "created": "transaction_date",
      "merchant.name": "merchant_name",
      "merchant.category": "category",
      "merchant.address.formatted": "merchant_address",
      "notes": "notes",
      "local_amount": "local_amount",
      "local_currency": "local_currency",
      "account_balance": "balance_after"
    },
    // Balance mappings
    balance: {
      "balance": "current_balance",
      "total_balance": "total_balance",
      "currency": "currency",
      "spend_today": "spend_today"
    }
  },

  // Custom transformers for complex data types
  customTransformers: {
    amount: (value) => value / 100, // Monzo amounts are in pence
    transaction_date: (value) => new Date(value).toISOString(),
    account_created: (value) => new Date(value).toISOString(),
    merchant_address: (address) => address ? address.formatted : null,
    category: (value) => value || 'uncategorized'
  },

  // Required fields that must be present
  requiredFields: {
    account: ["id", "description", "currency"],
    transaction: ["id", "amount", "currency", "created"],
    balance: ["balance", "currency"]
  },

  // Fields to exclude from properties
  excludedFields: ["access_token", "refresh_token", "client_secret", "internal_id"]
};

module.exports = monzoConfig;