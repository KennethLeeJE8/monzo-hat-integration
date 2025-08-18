# Monzo Data Connector

A data connector that integrates Monzo banking data with Dataswyft wallets via the CheckD platform. Features OAuth 2.0 authentication, data extraction, and wallet storage with webhook integration.

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
- **🔒 Data Integrity**: SHA-256 checksum validation with metadata structure
- **🔄 Async Processing**: Background processing with callback support
- **🛡️ Error Handling**: Comprehensive error handling and retry logic
- **📈 Monitoring**: Health checks and structured logging
- **🧪 Testing**: Unit tests and end-to-end integration tests

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

## 📊 Data Structure

### Wallet Payload Format
Data is stored in the Dataswyft wallet with the following structure:

```json
{
  "metadata": {
    "inbox_message_id": "unique_message_id_or_null",
    "create_at": "2025-08-18T20:09:25.490Z",
    "checksum": "1468bddc2e73d22bf3f4e3b6520c1a7f004a90030af6102cd97cef59ef4cab7a"
  },
  "data": {
    "accounts": [/* Your Monzo account data */],
    "balances": [/* Your current balance data */],
    "transactions": [/* Your transaction history */],
    "connectionTest": { "success": true },
    "extractionMeta": {
      "accountCount": 2,
      "balanceCount": 1, 
      "transactionCount": 0,
      "extractedAt": "2025-08-18T20:09:25.490Z",
      "connector": "monzo-data-connector"
    }
  }
}
```

- **Checksum**: SHA-256 hash computed on the `data` portion for integrity validation
- **Namespace**: Stored in `monzo/accounts` path in your Dataswyft wallet
- **Security**: All data encrypted and stored securely in your personal data wallet

## 🔧 Available Endpoints

- `GET /health` - Service health check
- `POST /webhook/connect` - Main CheckD webhook endpoint  
- `GET /test/monzo-auth` - OAuth authentication flow
- `GET /test/monzo-data` - Data extraction test
- `POST /test/store-monzo-with-checksum` - Store Monzo data with checksum validation
- `GET /test/wallet-connection` - Wallet connection test

## 🧪 Testing

### 📱 **Unique 2-Part OAuth Testing** (Mobile Approval Required)

Due to Monzo's security requirements, OAuth testing must be split into two parts:

#### **Part 1: OAuth Authentication**
```bash
npm run test:oauth-part1
```
This will:
1. Open your browser for Monzo login
2. Request email verification 
3. Generate access token
4. **⚠️ IMPORTANT**: You must then approve data access in your **Monzo mobile app**

#### **Part 2: Complete Data Flow** 
```bash
npm run test:oauth-part2  
```
Run this **AFTER** approving in mobile app. This will:
1. Use the approved token
2. Extract real banking data from your Monzo account (accounts, balances)
3. Apply checksum validation with SHA-256 hash
4. Store data in `monzo` namespace with integrity metadata
5. Test callback webhook functionality
6. Complete end-to-end flow testing

#### **Combined Flow** (with manual approval step)
```bash
npm run test:oauth-both
```
Runs Part 1, waits for your mobile approval, then runs Part 2.

### 📋 **Standard Testing**

```bash
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only  
npm run test:all        # All tests
```

### 🔧 **Manual Testing Scripts**

```bash
npm run test:wallet      # Direct wallet API test
npm run test:wallet-monzo # Monzo + wallet integration
```

## 📁 Project Structure

```
src/
├── auth/           # Monzo OAuth authentication
├── connectors/     # Monzo API integration  
├── gateway/        # CheckD webhook handling
├── storage/        # Dataswyft wallet client
├── utils/          # Logging, error handling
├── config/         # Environment configuration
└── __tests__/      # Integration tests
```

## 🚀 Production Usage

The connector is designed to work with the CheckD platform via webhook integration:

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

## 📋 License

Private - Internal use only