# Monzo Data Connector

A production-ready data connector that integrates Monzo banking data with Dataswyft wallets via the CheckD platform. This connector implements secure OAuth 2.0 authentication, comprehensive data extraction, and wallet storage following data connector best practices.

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  CheckD Gateway │────│ Monzo Connector  │────│ Monzo API       │
│                 │    │ Service          │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │ Dataswyft Wallet │
                       │ Storage          │
                       └──────────────────┘
```

## 📋 Features

- **🔐 Secure Authentication**: OAuth 2.0 flow with mobile app approval
- **📊 Complete Data Extraction**: Accounts, balances, transactions
- **🌐 Webhook Integration**: CheckD platform webhook handling with JWT validation
- **💾 Wallet Storage**: Proper application token authentication for Dataswyft wallets
- **🔄 Async Processing**: Background processing with callback support
- **🛡️ Error Handling**: Comprehensive error handling and retry logic
- **📈 Monitoring**: Health checks and structured logging
- **🧪 Testing**: Unit tests and integration tests

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Monzo Developer Account
- Dataswyft Wallet Credentials

### Installation

```bash
git clone <repository>
cd monzo-data-connector
npm install
```

### Environment Setup

Create `.env` file:

```bash
# Monzo Configuration
MONZO_CLIENT_ID=your_monzo_client_id
MONZO_CLIENT_SECRET=your_monzo_client_secret
MONZO_ACCOUNTS_URL=https://auth.monzo.com
MONZO_API_DOMAIN=https://api.monzo.com
MONZO_SCOPE=read
MONZO_REDIRECT_URI=https://tolocalhost.com/

# Data Connector Configuration
DS_APPLICATION_ID=oi-s-monzodataconnector
DS_NAMESPACE=monzo
DS_DATA_PATH=accounts

# Server Configuration
CONNECTOR_PORT=8080
NODE_ENV=development
LOG_LEVEL=info

# Dataswyft Wallet Configuration
DATASWIFT_API_URL=https://your-instance.hubat.net
DATASWIFT_USERNAME=your_username
DATASWIFT_PASSWORD=your_password
```

### Start the Connector

```bash
npm start
# Server runs on http://localhost:8080
```

## 🔧 API Endpoints

### Health & Status
- `GET /health` - Service health check
- `GET /test/wallet-health` - Wallet connectivity test

### Webhook Endpoints (Production)
- `POST /webhook/connect` - Main CheckD webhook endpoint
- `GET /webhook/status/:requestId` - Request status tracking
- `POST /webhook/test-callback` - Callback connectivity test

### Development & Testing
- `GET /test/monzo-auth` - OAuth authentication flow
- `GET /test/monzo-data` - Data extraction test
- `GET /test/wallet-connection` - Wallet connection test
- `GET /test/complete-flow` - End-to-end flow test

## 🧪 Testing

### Unit Tests
```bash
npm run test:unit        # Gateway and wallet unit tests
npm run test:webhook     # Webhook handler tests only  
npm run test:wallet-unit # Wallet client tests only
```

### Integration Tests
```bash
npm run test:integration # Full integration tests
npm run test:all        # All tests (unit + integration)
```

### OAuth Flow Testing (2-Part Process)
```bash
# Part 1: Trigger OAuth (approve in mobile app)
npm run test:oauth-part1

# Part 2: Complete flow with approved token  
npm run test:oauth-part2

# Or run both with manual approval step
npm run test:oauth-both
```

### Manual Testing Scripts
```bash
npm run test:wallet      # Direct wallet API test
npm run test:wallet-monzo # Monzo + wallet integration
```

## 📁 Project Structure

```
src/
├── auth/                    # Authentication layer
│   └── monzo-oauth-handler.js
├── connectors/              # API integration layer  
│   └── monzo-connector.js
├── gateway/                 # CheckD platform integration
│   ├── callback-client.js
│   └── monzo-webhook.js
├── storage/                 # Dataswyft wallet integration
│   └── wallet-client.js
├── utils/                   # Common utilities
│   ├── error-handler.js
│   ├── logger.js
│   └── retry-handler.js
├── config/                  # Configuration
│   ├── environment.js
│   └── monzo-config.js
└── __tests__/               # Integration tests
    └── integration/
```

## 🔐 Authentication Flow

The connector implements a secure 2-token authentication pattern:

1. **Access Token**: Authenticate with Dataswyft wallet API
   ```bash
   POST /users/access_token
   Headers: username, password
   ```

2. **Application Token**: Obtained using access token for data operations
   ```bash  
   GET /api/v2.6/applications/{applicationId}/access-token
   Headers: x-auth-token: {accessToken}
   ```

3. **Data Operations**: Use application token for all wallet storage/retrieval
   ```bash
   POST /api/v2.6/data/{namespace}/{path}
   Headers: x-auth-token: {applicationToken}
   ```

## 🌐 Webhook Integration

### CheckD Gateway Webhook
```bash
POST /webhook/connect
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "data": "user@example.com",
  "async": true,
  "callback_url": "https://your-callback-url.com/callback"
}
```

### Response Formats
```json
// Synchronous (immediate processing)
{
  "status": "success",
  "requestId": "monzo_1234567890_abc123",
  "data": { "accounts": [...], "balances": [...] },
  "wallet": { "stored": true, "namespace": "monzo", "recordId": "..." }
}

// Asynchronous (background processing)
{
  "status": "accepted", 
  "requestId": "monzo_1234567890_abc123",
  "message": "Request accepted for asynchronous processing"
}
```

## 📊 Data Structure

### Monzo Account Data
```json
{
  "accounts": [
    {
      "id": "acc_123",
      "description": "Current Account",
      "currency": "GBP",
      "owner_type": "individual",
      "owners": [{"preferred_name": "John Doe"}]
    }
  ],
  "balances": [
    {
      "accountId": "acc_123", 
      "balance": 12345,
      "currency": "GBP",
      "spend_today": 0
    }
  ]
}
```

### Wallet Storage Format
```json
{
  "source": {
    "name": "monzo-data-connector",
    "version": "1.0.0", 
    "provider": "monzo"
  },
  "metadata": {
    "namespace": "monzo",
    "contentType": "application/json",
    "dataType": "banking-data"
  },
  "data": { /* Raw Monzo API response */ }
}
```

## 🔍 Monitoring & Logging

### Health Check Response
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T12:00:00.000Z", 
  "service": "monzo-data-connector",
  "version": "1.0.0"
}
```

### Structured Logging
- **Service**: `monzo-data-connector`
- **Levels**: ERROR, WARN, INFO, DEBUG
- **Format**: JSON with timestamps and request context

## 🛡️ Security Features

- **JWT Validation**: Multi-source token extraction and validation
- **CSRF Protection**: State parameter validation in OAuth flow
- **Input Validation**: Request data and callback URL validation  
- **Error Sanitization**: Sensitive data excluded from logs
- **Rate Limiting**: Built-in API request throttling
- **Token Security**: Automatic token refresh and expiration handling

## 🚀 Deployment

### Environment Variables Required
```bash
# Production essentials
MONZO_CLIENT_ID, MONZO_CLIENT_SECRET
DATASWIFT_API_URL, DATASWIFT_USERNAME, DATASWIFT_PASSWORD
DS_APPLICATION_ID
CONNECTOR_PORT
```

### Docker Support
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
```

## 📝 Development

### Adding New Data Sources
1. Create connector in `src/connectors/`
2. Implement authentication in `src/auth/`  
3. Add webhook handler in `src/gateway/`
4. Configure field mappings
5. Add comprehensive tests

### Testing Strategy
- **Unit Tests**: Each module (52 webhook tests, 18 wallet tests)
- **Integration Tests**: API connectivity and wallet storage
- **End-to-End Tests**: Complete webhook → data → wallet flow
- **Manual Scripts**: Direct API testing and validation

## 📋 License

Private - Internal use only

## 🤝 Contributing

1. Follow existing code patterns and conventions
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Ensure security best practices are followed