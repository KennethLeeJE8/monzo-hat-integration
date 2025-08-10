const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Import modules
const logger = require('./src/utils/logger');
const errorHandler = require('./src/utils/error-handler');
const MonzoWebhookHandler = require('./src/gateway/monzo-webhook');
const MonzoConnector = require('./src/connectors/monzo-connector');
const MonzoOAuthHandler = require('./src/auth/monzo-oauth-handler');
const WalletClient = require('./src/storage/wallet-client');
const CallbackClient = require('./src/gateway/callback-client');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize components
const authHandler = new MonzoOAuthHandler();
const connector = new MonzoConnector();
const walletClient = new WalletClient();
const callbackClient = new CallbackClient();
const webhookHandler = new MonzoWebhookHandler(connector, walletClient, callbackClient);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'monzo-data-connector',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Main webhook endpoint for CheckD Gateway
app.post('/webhook/connect', async (req, res) => {
  await webhookHandler.handleConnectRequest(req, res);
});

// Additional webhook management endpoints
app.get('/webhook/status/:requestId', (req, res) => {
  try {
    const { requestId } = req.params;
    const status = webhookHandler.getRequestStatus(requestId);
    
    if (!status) {
      return res.status(404).json({
        status: 'error',
        error: {
          code: 'request_not_found',
          message: 'Request ID not found or expired'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      status: 'success',
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get request status', { requestId: req.params.requestId, error: error.message });
    res.status(500).json({
      status: 'error',
      error: {
        code: 'status_check_failed',
        message: 'Failed to check request status'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Test callback connectivity endpoint
app.post('/webhook/test-callback', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'missing_url',
          message: 'Callback URL is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    const result = await callbackClient.testCallback(url);
    
    res.json({
      status: result.success ? 'success' : 'error',
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Callback test failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      error: {
        code: 'callback_test_failed',
        message: 'Failed to test callback URL'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Direct wallet test using raw API calls (like curl commands)
app.post('/test/wallet-direct', async (req, res) => {
  try {
    const axios = require('axios');
    
    logger.info('Testing direct wallet API calls');
    
    // Step 1: Authenticate
    const authResponse = await axios.get('https://kennethleeje8wka.hubat.net/users/access_token', {
      headers: {
        'Accept': 'application/json',
        'username': 'kennethleeje8wka',
        'password': 'burger-wine-cheese'
      }
    });
    
    const accessToken = authResponse.data.accessToken;
    logger.info('Direct authentication successful', { tokenLength: accessToken.length });
    
    // Step 2: Write test data
    const testData = {
      "something": "Normal JSON",
      "data": {
        "nested": "no problem",
        "value": true,
        "id": Math.floor(Math.random() * 10000),
        "timestamp": new Date().toISOString()
      }
    };
    
    const writeResponse = await axios.post('https://kennethleeje8wka.hubat.net/api/v2.6/data/test/monzo/accounts', testData, {
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': accessToken
      }
    });
    
    res.json({
      status: 'success',
      message: 'Direct wallet test successful',
      auth: {
        tokenLength: accessToken.length,
        tokenPrefix: accessToken.substring(0, 20) + '...'
      },
      write: {
        status: writeResponse.status,
        data: writeResponse.data
      },
      testData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Direct wallet test failed', { error: error.message, status: error.response?.status, data: error.response?.data });
    
    // Handle duplicate data as success
    const isDuplicate = error.response?.data?.cause?.includes('Duplicate data');
    
    res.json({
      status: isDuplicate ? 'success' : 'error',
      message: isDuplicate ? 'Direct wallet test successful (duplicate data)' : 'Direct wallet test failed',
      error: error.message,
      isDuplicate,
      timestamp: new Date().toISOString()
    });
  }
});

// Direct wallet test using same pattern as test-wallet-direct.js  
app.post('/test/wallet-direct-api', async (req, res) => {
  try {
    const axios = require('axios');
    
    logger.info('Testing direct wallet API calls like test-wallet-direct.js');
    
    // Step 1: Authenticate exactly like test-wallet-direct.js
    const authResponse = await axios.get('https://kennethleeje8wka.hubat.net/users/access_token', {
      headers: {
        'Accept': 'application/json',
        'username': 'kennethleeje8wka',
        'password': 'burger-wine-cheese'
      }
    });
    
    const accessToken = authResponse.data.accessToken;
    logger.info('Direct authentication successful', { tokenLength: accessToken.length });
    
    // Step 2: Get Monzo data from current session
    const monzoAccessToken = process.env.MONZO_ACCESS_TOKEN || global.tempAccessToken;
    
    if (!monzoAccessToken) {
      return res.status(400).json({
        status: 'error',
        message: 'No Monzo access token available. Run OAuth first.',
        timestamp: new Date().toISOString()
      });
    }
    
    // Get real Monzo data
    const monzoData = await connector.getCompleteAccountData(monzoAccessToken);
    
    // Step 3: Store Monzo data using direct API call (exactly like test-wallet-direct.js)
    const writeResponse = await axios.post('https://kennethleeje8wka.hubat.net/api/v2.6/data/test/monzo/accounts', monzoData, {
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': accessToken
      }
    });
    
    res.json({
      status: 'success',
      message: 'Direct API wallet storage successful',
      auth: {
        tokenLength: accessToken.length,
        tokenPrefix: accessToken.substring(0, 20) + '...'
      },
      monzo: {
        accountCount: monzoData.accounts?.length || 0,
        balanceCount: monzoData.balances?.length || 0
      },
      wallet: {
        status: writeResponse.status,
        recordId: writeResponse.data.recordId,
        endpoint: writeResponse.data.endpoint
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Direct API wallet test failed', { error: error.message });
    
    // Handle duplicate data as success
    const isDuplicate = error.response?.data?.cause?.includes('Duplicate data');
    
    res.json({
      status: isDuplicate ? 'success' : 'error',
      message: isDuplicate ? 'Direct API successful (duplicate data)' : 'Direct API failed',
      error: error.message,
      isDuplicate,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple wallet test with your exact pattern
app.post('/test/wallet-simple', async (req, res) => {
  try {
    logger.info('Testing simple wallet write with provided pattern');
    
    const testData = {
      "something": "Normal JSON",
      "data": {
        "nested": "no problem",
        "value": true,
        "id": Math.floor(Math.random() * 10000),
        "timestamp": new Date().toISOString()
      }
    };

    const result = await walletClient.storeData('monzo', 'accounts', testData, {
      isTest: true,
      recordName: 'simple-test'
    });
    
    res.json({
      status: result.success ? 'success' : 'error',
      message: result.success ? 'Simple wallet test successful' : 'Simple wallet test failed',
      result,
      testData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Simple wallet test failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Simple wallet test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Wallet test endpoints
app.get('/test/wallet-health', async (req, res) => {
  try {
    logger.info('Testing wallet health');
    const healthCheck = await walletClient.healthCheck();
    
    res.json({
      status: healthCheck.wallet === 'available' ? 'success' : 'error',
      message: 'Wallet health check completed',
      health: healthCheck,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Wallet health check failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Wallet health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/test/wallet-connection', async (req, res) => {
  try {
    logger.info('Testing wallet connection');
    const connectionTest = await walletClient.testConnection();
    
    res.json({
      status: connectionTest.success ? 'success' : 'error',
      message: connectionTest.message,
      details: connectionTest.details,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Wallet connection test failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Wallet connection test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/test/wallet-store', async (req, res) => {
  try {
    const { useTestData = false } = req.body;
    
    let testData;
    
    if (useTestData) {
      // Use mock data for testing
      testData = {
        accounts: [
          {
            id: 'test_acc_123',
            description: 'Test Monzo Account',
            currency: 'GBP',
            owner_type: 'individual',
            owners: [{ preferred_name: 'Test User' }],
            created: new Date().toISOString(),
            closed: false
          }
        ],
        balances: [
          {
            accountId: 'test_acc_123',
            balance: 12345,
            currency: 'GBP',
            spend_today: 0
          }
        ],
        connectionTest: { success: true, message: 'Test connection' }
      };
    } else {
      // Use real Monzo data if available
      const accessToken = process.env.MONZO_ACCESS_TOKEN || global.tempAccessToken;
      
      if (!accessToken) {
        return res.status(400).json({
          status: 'error',
          message: 'No Monzo access token available. Run /test/monzo-auth first or set useTestData=true',
          timestamp: new Date().toISOString()
        });
      }
      
      logger.info('Fetching real Monzo data for wallet storage test');
      testData = await connector.getCompleteAccountData(accessToken);
    }
    
    logger.info('Testing wallet data storage', { 
      useTestData,
      accountCount: testData.accounts?.length || 0
    });
    
    const result = await walletClient.storeCompleteData(testData, {
      isTest: true, // Store in test/monzo namespace
      recordName: 'test-wallet-storage'
    });
    
    res.json({
      status: result.success ? 'success' : 'error',
      message: result.success ? 'Data stored in wallet successfully' : 'Failed to store data in wallet',
      result,
      testDataUsed: useTestData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Wallet storage test failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Wallet storage test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/test/wallet-retrieve/:namespace', async (req, res) => {
  try {
    const { namespace } = req.params;
    const { isTest = 'true' } = req.query;
    
    logger.info('Testing wallet data retrieval', { namespace, isTest });
    
    const result = await walletClient.getData(namespace, {
      isTest: isTest === 'true'
    });
    
    res.json({
      status: result.success ? 'success' : 'error',
      message: result.success ? 'Data retrieved from wallet successfully' : 'Failed to retrieve data from wallet',
      result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Wallet retrieval test failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Wallet retrieval test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Complete OAuth → Monzo → Wallet flow
app.get('/test/complete-oauth-flow', async (req, res) => {
  try {
    const { useTestData = false } = req.query;
    
    logger.info('Testing complete OAuth → Monzo → Wallet flow', { useTestData });
    
    let monzoData;
    let authStatus = 'no_auth';
    
    if (useTestData === 'true') {
      // Use mock data
      authStatus = 'mock_data';
      monzoData = {
        accounts: [
          {
            id: 'oauth_flow_test_acc_123',
            description: 'OAuth Flow Test Monzo Account',
            currency: 'GBP',
            owner_type: 'individual',
            owners: [{ preferred_name: 'OAuth Flow Test User' }],
            created: new Date().toISOString(),
            closed: false
          }
        ],
        balances: [
          {
            accountId: 'oauth_flow_test_acc_123',
            balance: 67890,
            currency: 'GBP',
            spend_today: 2500
          }
        ],
        connectionTest: { success: true, message: 'OAuth flow test with mock data' }
      };
    } else {
      // Check if we have a temporary access token from OAuth flow
      const accessToken = process.env.MONZO_ACCESS_TOKEN || global.tempAccessToken;
      
      if (!accessToken) {
        return res.status(400).json({
          status: 'error',
          message: 'No Monzo access token available. Please run OAuth flow first.',
          instructions: [
            '1. Call /test/monzo-auth to complete OAuth authentication',
            '2. Or use ?useTestData=true to test with mock data',
            '3. Then retry this endpoint'
          ],
          timestamp: new Date().toISOString()
        });
      }
      
      // Test Monzo connection
      const connectionTest = await connector.testConnection(accessToken);
      if (!connectionTest.success) {
        return res.status(503).json({
          status: 'error',
          message: 'Monzo API connection failed. Did you approve access in your Monzo mobile app?',
          connectionTest,
          timestamp: new Date().toISOString()
        });
      }
      
      // Extract Monzo data
      authStatus = 'oauth_success';
      monzoData = await connector.getCompleteAccountData(accessToken);
    }
    
    // Test wallet connection
    const walletHealth = await walletClient.healthCheck();
    if (walletHealth.wallet !== 'available') {
      return res.status(503).json({
        status: 'error',
        message: 'Wallet service not available',
        walletHealth,
        timestamp: new Date().toISOString()
      });
    }
    
    // Store data in wallet (test namespace)
    const walletResult = await walletClient.storeCompleteData(monzoData, {
      isTest: true,
      recordName: `oauth-flow-test-${authStatus}`
    });
    
    res.json({
      status: walletResult.success ? 'success' : 'partial_success',
      message: walletResult.success 
        ? 'Complete OAuth → Monzo → Wallet flow successful!'
        : 'OAuth and Monzo extraction successful, but wallet storage failed',
      flow: {
        authentication: {
          status: authStatus,
          useTestData: useTestData === 'true'
        },
        monzoExtraction: {
          success: true,
          accountCount: monzoData.accounts?.length || 0,
          balanceCount: monzoData.balances?.length || 0
        },
        walletStorage: {
          success: walletResult.success,
          recordId: walletResult.recordId,
          namespace: walletResult.namespace,
          path: walletResult.path,
          error: walletResult.error,
          isDuplicate: walletResult.isDuplicate
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Complete OAuth flow test failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Complete OAuth flow test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Complete end-to-end test: Monzo → Wallet
app.get('/test/complete-flow', async (req, res) => {
  try {
    const { useTestData = false } = req.query;
    
    logger.info('Testing complete Monzo to Wallet flow', { useTestData });
    
    let monzoData;
    
    if (useTestData === 'true') {
      monzoData = {
        accounts: [
          {
            id: 'flow_test_acc_123',
            description: 'Flow Test Monzo Account',
            currency: 'GBP',
            owner_type: 'individual',
            owners: [{ preferred_name: 'Flow Test User' }],
            created: new Date().toISOString(),
            closed: false
          }
        ],
        balances: [
          {
            accountId: 'flow_test_acc_123',
            balance: 54321,
            currency: 'GBP',
            spend_today: 1500
          }
        ],
        connectionTest: { success: true, message: 'Flow test connection' }
      };
    } else {
      // Check for access token
      const accessToken = process.env.MONZO_ACCESS_TOKEN || global.tempAccessToken;
      
      if (!accessToken) {
        return res.status(400).json({
          status: 'error',
          message: 'No Monzo access token available. Run /test/monzo-auth first or use ?useTestData=true',
          timestamp: new Date().toISOString()
        });
      }
      
      // Test Monzo connection
      const connectionTest = await connector.testConnection(accessToken);
      if (!connectionTest.success) {
        return res.status(503).json({
          status: 'error',
          message: 'Monzo API connection failed',
          connectionTest,
          timestamp: new Date().toISOString()
        });
      }
      
      // Extract Monzo data
      monzoData = await connector.getCompleteAccountData(accessToken);
    }
    
    // Test wallet connection
    const walletHealth = await walletClient.healthCheck();
    if (walletHealth.wallet !== 'available') {
      return res.status(503).json({
        status: 'error',
        message: 'Wallet service not available',
        walletHealth,
        timestamp: new Date().toISOString()
      });
    }
    
    // Store data in wallet (test namespace)
    const walletResult = await walletClient.storeCompleteData(monzoData, {
      isTest: true,
      recordName: 'complete-flow-test'
    });
    
    res.json({
      status: walletResult.success ? 'success' : 'partial_success',
      message: walletResult.success 
        ? 'Complete flow test successful: Monzo data extracted and stored in wallet'
        : 'Monzo data extracted but wallet storage failed',
      flow: {
        monzoExtraction: {
          success: true,
          accountCount: monzoData.accounts?.length || 0,
          balanceCount: monzoData.balances?.length || 0,
          useTestData: useTestData === 'true'
        },
        walletStorage: {
          success: walletResult.success,
          recordId: walletResult.recordId,
          namespace: walletResult.namespace,
          error: walletResult.error
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Complete flow test failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Complete flow test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// OAuth callback endpoint to receive authorization code
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      logger.error('OAuth callback error', { error });
      return res.status(400).json({
        status: 'error',
        message: `OAuth error: ${error}`,
        error
      });
    }

    if (!code || !state) {
      logger.error('Missing code or state in callback', { code: !!code, state: !!state });
      return res.status(400).json({
        status: 'error',
        message: 'Missing authorization code or state parameter'
      });
    }

    logger.info('OAuth callback received', { code: code.substring(0, 20) + '...', state });

    // Store the code and state temporarily (in production, use a proper session store)
    global.tempOAuthData = { code, state, timestamp: Date.now() };

    // Return success page with instructions
    res.send(`
      <html>
        <head><title>Monzo OAuth Success</title></head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h2>✅ Monzo OAuth Authorization Successful!</h2>
          <p><strong>Authorization Code:</strong> <code>${code}</code></p>
          <p><strong>State:</strong> <code>${state}</code></p>
          
          <h3>Next Steps:</h3>
          <p>The authorization code has been captured by the server. Now run this command to exchange it for an access token:</p>
          
          <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto;">
curl -X POST http://localhost:8080/auth/exchange \\
  -H "Content-Type: application/json"
          </pre>
          
          <p><em>Note: The authorization code expires quickly, so run the command above soon!</em></p>
          
          <h3>🔐 Important: Mobile App Approval</h3>
          <p><strong>Don't forget to open your Monzo mobile app and approve the data access request!</strong></p>
        </body>
      </html>
    `);

  } catch (error) {
    logger.error('OAuth callback processing failed', { error: error.message });
    res.status(500).json({
      status: 'error', 
      message: 'Failed to process OAuth callback',
      error: error.message
    });
  }
});

// Exchange the captured authorization code for access token
app.post('/auth/exchange', async (req, res) => {
  try {
    if (!global.tempOAuthData) {
      return res.status(400).json({
        status: 'error',
        message: 'No authorization code found. Please complete OAuth flow first by visiting /auth/start'
      });
    }

    const { code, state } = global.tempOAuthData;
    
    // Check if code is too old (5 minutes)
    if (Date.now() - global.tempOAuthData.timestamp > 5 * 60 * 1000) {
      delete global.tempOAuthData;
      return res.status(400).json({
        status: 'error',
        message: 'Authorization code expired. Please restart OAuth flow.'
      });
    }

    logger.info('Exchanging captured authorization code for access token');
    const tokenData = await authHandler.exchangeCodeForToken(code, state, state);
    
    // Store the access token temporarily for testing
    global.tempAccessToken = tokenData.accessToken;
    
    // Clear the temp OAuth data
    delete global.tempOAuthData;
    
    res.json({
      status: 'success',
      message: 'Access token obtained successfully!',
      tokenData: {
        tokenType: tokenData.tokenType,
        expiresIn: tokenData.expiresIn,
        hasRefreshToken: !!tokenData.refreshToken,
        scope: tokenData.scope
      },
      nextSteps: [
        'Access token stored temporarily on server',
        'Use /test/monzo-connection-auto to test API connection',
        'Use /test/monzo-accounts-auto to get your account details',
        'IMPORTANT: Make sure you approved access in your Monzo mobile app!'
      ]
    });

  } catch (error) {
    logger.error('Failed to exchange authorization code', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Failed to exchange authorization code for token',
      error: error.message
    });
  }
});

// Auto-test endpoints that use the stored access token
app.get('/test/monzo-connection-auto', async (req, res) => {
  try {
    if (!global.tempAccessToken) {
      return res.status(400).json({
        status: 'error',
        message: 'No access token available. Please complete OAuth flow first.'
      });
    }

    logger.info('Testing Monzo API connection with stored token');
    const testResult = await connector.testConnection(global.tempAccessToken);
    
    if (testResult.success) {
      res.json({
        status: 'success',
        message: 'Monzo API connection successful! 🎉',
        testResult
      });
    } else {
      res.status(400).json({
        status: 'error',
        message: 'Monzo API connection failed. Did you approve access in your mobile app?',
        testResult
      });
    }
  } catch (error) {
    logger.error('Auto connection test failed', { error: error.message });
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/test/monzo-accounts-auto', async (req, res) => {
  try {
    if (!global.tempAccessToken) {
      return res.status(400).json({
        status: 'error',
        message: 'No access token available. Please complete OAuth flow first.'
      });
    }

    logger.info('Fetching Monzo accounts with stored token');
    const accounts = await connector.getAccounts(global.tempAccessToken);
    
    res.json({
      status: 'success',
      message: `🏦 Retrieved ${accounts.length} Monzo account(s)`,
      accounts: accounts.map(acc => ({
        id: acc.id,
        description: acc.description,
        currency: acc.currency,
        ownerType: acc.owner_type,
        accountHolder: acc.owners?.[0]?.preferred_name,
        created: acc.created,
        closed: acc.closed
      }))
    });
  } catch (error) {
    logger.error('Auto accounts fetch failed', { error: error.message });
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 2-Call Test Flow: Step 1 - Authentication & Token Exchange
app.get('/test/monzo-auth', async (req, res) => {
  try {
    logger.info('Starting Monzo authentication and token exchange');

    // Generate OAuth URL and open browser
    const { authorizationUrl, state } = authHandler.generateAuthorizationUrl();
    
    const { exec } = require('child_process');
    exec(`open "${authorizationUrl}"`, (error) => {
      if (error) {
        logger.error('Failed to open browser', { error: error.message });
      } else {
        logger.info('Opened Monzo authorization URL in default browser');
      }
    });

    // Store state for validation
    global.tempOAuthState = state;

    // Wait for OAuth callback (polling approach)
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes timeout
    
    const pollForCallback = () => {
      return new Promise((resolve, reject) => {
        const checkCallback = () => {
          attempts++;
          
          if (global.tempOAuthData) {
            logger.info('OAuth callback received, exchanging for token');
            resolve(global.tempOAuthData);
          } else if (attempts >= maxAttempts) {
            reject(new Error('OAuth timeout - no callback received within 2 minutes'));
          } else {
            setTimeout(checkCallback, 1000); // Check every second
          }
        };
        checkCallback();
      });
    };

    // Wait for OAuth callback
    const { code, state: returnedState } = await pollForCallback();
    
    // Validate state
    if (returnedState !== global.tempOAuthState) {
      throw new Error('State parameter mismatch - possible security issue');
    }

    // Exchange authorization code for access token
    logger.info('Exchanging authorization code for access token');
    const tokenData = await authHandler.exchangeCodeForToken(code, returnedState, global.tempOAuthState);
    
    // Store access token
    global.tempAccessToken = tokenData.accessToken;
    
    // Clean up OAuth data
    delete global.tempOAuthData;
    delete global.tempOAuthState;

    // Test API connection to verify token works
    const connectionTest = await connector.testConnection(global.tempAccessToken);
    
    if (!connectionTest.success) {
      return res.status(400).json({
        status: 'auth_success_api_failed',
        message: '✅ Token obtained, but API connection failed. Please approve access in your Monzo mobile app, then call /test/monzo-data',
        tokenData: {
          tokenType: tokenData.tokenType,
          expiresIn: tokenData.expiresIn,
          scope: tokenData.scope
        },
        connectionTest,
        nextStep: 'Open Monzo mobile app → approve access → call /test/monzo-data'
      });
    }

    // Success - both auth and API connection work
    res.json({
      status: 'success',
      message: '🎉 Authentication and API connection successful!',
      tokenData: {
        tokenType: tokenData.tokenType,
        expiresIn: tokenData.expiresIn,
        scope: tokenData.scope
      },
      connectionTest,
      nextStep: 'Call /test/monzo-data to retrieve account information'
    });

  } catch (error) {
    logger.error('Authentication flow failed', { error: error.message });
    
    // Clean up any temp data
    delete global.tempOAuthData;
    delete global.tempOAuthState;
    delete global.tempAccessToken;
    
    res.status(500).json({ 
      status: 'error', 
      message: 'Authentication failed',
      error: error.message 
    });
  }
});

// 2-Call Test Flow: Step 2 - Data Retrieval
app.get('/test/monzo-data', async (req, res) => {
  try {
    if (!global.tempAccessToken) {
      return res.status(400).json({
        status: 'error',
        message: 'No access token available. Please call /test/monzo-auth first.'
      });
    }

    logger.info('Fetching complete Monzo account data');

    // Test API connection first
    const connectionTest = await connector.testConnection(global.tempAccessToken);
    
    if (!connectionTest.success) {
      return res.status(400).json({
        status: 'connection_failed',
        message: 'API connection failed. Did you approve access in your Monzo mobile app?',
        connectionTest,
        suggestion: 'Open your Monzo mobile app and approve the data access request, then try again'
      });
    }

    // Fetch all account data
    const accounts = await connector.getAccounts(global.tempAccessToken);

    const completeData = {
      connectionTest,
      accounts: [],
      balances: [],
      summary: {
        accountCount: accounts.length,
        timestamp: new Date().toISOString()
      }
    };

    // Process each account
    for (const account of accounts) {
      // Add account data
      completeData.accounts.push({
        id: account.id,
        description: account.description,
        currency: account.currency,
        ownerType: account.owner_type,
        accountHolder: account.owners?.[0]?.preferred_name,
        created: account.created,
        closed: account.closed
      });

      try {
        // Try to get balance
        const balance = await connector.getAccountBalance(account.id, global.tempAccessToken);
        completeData.balances.push({
          accountId: account.id,
          balance: balance.balance,
          currency: balance.currency,
          spendToday: balance.spend_today
        });
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (balanceError) {
        logger.warn('Could not fetch balance for account', { 
          accountId: account.id, 
          error: balanceError.message 
        });
      }
    }

    // Clean up access token after successful data retrieval
    delete global.tempAccessToken;

    res.json({
      status: 'success',
      message: `🏦 Successfully retrieved data for ${accounts.length} account(s)!`,
      data: completeData
    });

  } catch (error) {
    logger.error('Data retrieval failed', { error: error.message });
    res.status(500).json({ 
      status: 'error', 
      message: 'Data retrieval failed',
      error: error.message 
    });
  }
});

// Monzo Authentication Test Endpoints
app.get('/auth/start', (req, res) => {
  try {
    logger.info('Starting Monzo OAuth flow');
    const { authorizationUrl, state } = authHandler.generateAuthorizationUrl();
    
    // Automatically open the authorization URL in the default browser
    const { exec } = require('child_process');
    exec(`open "${authorizationUrl}"`, (error) => {
      if (error) {
        logger.error('Failed to open browser', { error: error.message });
      } else {
        logger.info('Opened Monzo authorization URL in default browser');
      }
    });
    
    // Return response with instructions
    res.json({
      status: 'success',
      authorizationUrl,
      state,
      message: '🚀 Browser opened automatically! Complete authentication in the browser window.',
      instructions: [
        '✅ Browser window opened with Monzo login',
        '1. Login with your Monzo credentials', 
        '2. Verify your email',
        '3. Approve access in your Monzo mobile app',
        '4. You will be redirected back automatically',
        '5. Then use /auth/exchange to get your access token'
      ]
    });
  } catch (error) {
    logger.error('Failed to start OAuth flow', { error: error.message });
    res.status(500).json({ status: 'error', message: error.message });
  }
});


// Error handling middleware
app.use(errorHandler.notFound);
app.use(errorHandler.errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  logger.info(`Monzo Data Connector server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;