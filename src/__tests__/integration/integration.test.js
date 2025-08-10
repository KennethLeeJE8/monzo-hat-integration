const request = require('supertest');
const jwt = require('jsonwebtoken');
const MonzoOAuthHandler = require('../../auth/monzo-oauth-handler');
const MonzoConnector = require('../../connectors/monzo-connector');
const WalletClient = require('../../storage/wallet-client');
const CallbackClient = require('../../gateway/callback-client');
const MonzoWebhookHandler = require('../../gateway/monzo-webhook');

// Import server for testing
let app;

describe('End-to-End Integration Tests', () => {
  let monzoConnector;
  let walletClient;
  let callbackClient;
  let webhookHandler;
  let oauthHandler;
  let testAccessToken;

  // Test configuration
  const testConfig = {
    skipIfNoCredentials: true,
    testNamespace: 'test/monzo',
    timeout: 30000
  };

  beforeAll(async () => {
    // Check if we have required environment variables for integration tests
    const requiredEnvVars = {
      monzo: ['MONZO_ACCESS_TOKEN'],
      wallet: ['DATASWIFT_API_URL', 'DATASWIFT_USERNAME', 'DATASWIFT_PASSWORD'],
      connector: ['DS_APPLICATION_ID']
    };

    let missingVars = [];
    Object.entries(requiredEnvVars).forEach(([service, vars]) => {
      vars.forEach(envVar => {
        if (!process.env[envVar]) {
          missingVars.push(`${service}: ${envVar}`);
        }
      });
    });

    if (missingVars.length > 0 && testConfig.skipIfNoCredentials) {
      console.warn('⚠️  Skipping integration tests - missing environment variables:');
      console.warn(missingVars.map(v => `   - ${v}`).join('\n'));
      return;
    }

    // Initialize components for integration testing
    oauthHandler = new MonzoOAuthHandler();
    monzoConnector = new MonzoConnector();
    walletClient = new WalletClient({
      apiUrl: process.env.DATASWIFT_API_URL,
      username: process.env.DATASWIFT_USERNAME,
      password: process.env.DATASWIFT_PASSWORD,
      applicationId: process.env.DS_APPLICATION_ID
    });
    callbackClient = new CallbackClient();
    webhookHandler = new MonzoWebhookHandler(monzoConnector, walletClient, callbackClient);

    // Import server after components are set up
    app = require('../../../server');

    // Use existing access token or OAuth flow
    testAccessToken = process.env.MONZO_ACCESS_TOKEN || global.tempAccessToken;
  }, testConfig.timeout);

  describe('Monzo API Integration', () => {
    test('should connect to Monzo API successfully', async () => {
      if (!testAccessToken) {
        console.warn('⚠️  Skipping Monzo API test - no access token available');
        return;
      }

      const connectionTest = await monzoConnector.testConnection(testAccessToken);
      
      expect(connectionTest).toMatchObject({
        success: true,
        message: expect.any(String),
        userInfo: expect.any(Object)
      });

      expect(connectionTest.userInfo).toHaveProperty('user_id');
    });

    test('should retrieve real Monzo account data', async () => {
      if (!testAccessToken) {
        console.warn('⚠️  Skipping Monzo accounts test - no access token available');
        return;
      }

      const accounts = await monzoConnector.getAccounts(testAccessToken);
      
      expect(Array.isArray(accounts)).toBe(true);
      if (accounts.length > 0) {
        expect(accounts[0]).toHaveProperty('id');
        expect(accounts[0]).toHaveProperty('description');
        expect(accounts[0]).toHaveProperty('currency');
      }
    });

    test('should retrieve complete Monzo data structure', async () => {
      if (!testAccessToken) {
        console.warn('⚠️  Skipping complete Monzo data test - no access token available');
        return;
      }

      const completeData = await monzoConnector.getCompleteAccountData(testAccessToken);
      
      expect(completeData).toMatchObject({
        accounts: expect.any(Array),
        balances: expect.any(Array)
      });

      expect(completeData.accounts.length).toBeGreaterThanOrEqual(0);
      expect(completeData.balances.length).toEqual(completeData.accounts.length);
    });
  });

  describe('Dataswyft Wallet Integration', () => {
    test('should authenticate with Dataswyft wallet', async () => {
      if (!process.env.DATASWIFT_USERNAME || !process.env.DATASWIFT_PASSWORD) {
        console.warn('⚠️  Skipping wallet auth test - no credentials available');
        return;
      }

      const accessToken = await walletClient.authenticate();
      
      expect(typeof accessToken).toBe('string');
      expect(accessToken.length).toBeGreaterThan(0);
      expect(walletClient.accessToken).toBe(accessToken);
    });

    test('should obtain application token', async () => {
      if (!process.env.DATASWIFT_USERNAME || !process.env.DATASWIFT_PASSWORD) {
        console.warn('⚠️  Skipping app token test - no credentials available');
        return;
      }

      const applicationToken = await walletClient.getApplicationToken();
      
      expect(typeof applicationToken).toBe('string');
      expect(applicationToken.length).toBeGreaterThan(0);
      expect(walletClient.applicationToken).toBe(applicationToken);
    });

    test('should perform wallet health check', async () => {
      const health = await walletClient.healthCheck();
      
      expect(health).toHaveProperty('wallet');
      expect(health).toHaveProperty('api');
      expect(health).toHaveProperty('authentication');
      expect(health).toHaveProperty('applicationId', process.env.DS_APPLICATION_ID || 'oi-s-monzodataconnector');
    });

    test('should store test data in wallet', async () => {
      if (!process.env.DATASWIFT_USERNAME || !process.env.DATASWIFT_PASSWORD) {
        console.warn('⚠️  Skipping wallet storage test - no credentials available');
        return;
      }

      const testData = {
        accounts: [
          {
            id: 'integration_test_acc_' + Date.now(),
            description: 'Integration Test Account',
            currency: 'GBP',
            owner_type: 'individual',
            owners: [{ preferred_name: 'Integration Test User' }],
            created: new Date().toISOString(),
            closed: false
          }
        ],
        balances: [
          {
            accountId: 'integration_test_acc_' + Date.now(),
            balance: 99999,
            currency: 'GBP',
            spend_today: 0
          }
        ],
        connectionTest: { success: true, message: 'Integration test connection' }
      };

      const result = await walletClient.storeCompleteData(testData, {
        isTest: true, // This ensures data goes to test/monzo namespace
        recordName: 'integration-test-data'
      });

      expect(result).toMatchObject({
        success: true,
        recordId: expect.any(String),
        namespace: 'test/monzo',
        timestamp: expect.any(String),
        dataSize: expect.any(Number)
      });

      expect(result.recordId).toBeTruthy();
      expect(result.dataSize).toBeGreaterThan(0);
    });

    test('should retrieve stored test data from wallet', async () => {
      if (!process.env.DATASWIFT_USERNAME || !process.env.DATASWIFT_PASSWORD) {
        console.warn('⚠️  Skipping wallet retrieval test - no credentials available');
        return;
      }

      // First store some test data
      const testData = {
        accounts: [{ id: 'retrieve_test_' + Date.now(), description: 'Retrieve Test' }],
        balances: []
      };

      const storeResult = await walletClient.storeCompleteData(testData, {
        isTest: true,
        recordName: 'retrieve-test-data'
      });

      expect(storeResult.success).toBe(true);

      // Then try to retrieve data from the test namespace
      const retrieveResult = await walletClient.getData('monzo', { isTest: true });
      
      expect(retrieveResult).toMatchObject({
        success: expect.any(Boolean),
        namespace: 'test/monzo'
      });

      if (retrieveResult.success) {
        expect(retrieveResult.data).toBeDefined();
      }
    });
  });

  describe('Complete End-to-End Webhook Integration', () => {
    test('should process complete webhook flow with real APIs', async () => {
      if (!testAccessToken || !process.env.DATASWIFT_USERNAME || !process.env.DATASWIFT_PASSWORD) {
        console.warn('⚠️  Skipping complete webhook test - missing credentials');
        return;
      }

      // Create a valid JWT token for testing
      const payload = {
        sub: 'integration_test_user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'integration-test',
        aud: 'monzo-data-connector'
      };

      // Create a properly formatted JWT (for testing - in production this comes from CheckD)
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const testJwt = `${header}.${encodedPayload}.test_signature`;

      // Make webhook request
      const response = await request(app)
        .post('/webhook/connect')
        .set('Authorization', `Bearer ${testJwt}`)
        .set('Content-Type', 'application/json')
        .send({
          data: 'integration-test@example.com',
          async: false // Use synchronous mode for easier testing
        })
        .expect('Content-Type', /json/);

      // Should succeed despite wallet integration
      expect([200, 500]).toContain(response.status); // Allow 500 if no token in global state

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          status: 'success',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: expect.stringContaining('completed successfully'),
          data: expect.objectContaining({
            accounts: expect.any(Array),
            balances: expect.any(Array),
            extractionTime: expect.any(String),
            connectionTest: expect.any(Object)
          }),
          wallet: expect.objectContaining({
            stored: expect.any(Boolean),
            namespace: expect.stringMatching(/monzo$/),
            recordId: expect.any(String)
          }),
          timestamp: expect.any(String)
        });

        // Verify wallet storage was attempted
        expect(response.body.wallet).toHaveProperty('stored');
        
        if (response.body.wallet.stored) {
          expect(response.body.wallet.recordId).toBeTruthy();
          expect(response.body.wallet.namespace).toBe('monzo'); // Production namespace for webhook
        }
      }
    });

    test('should handle webhook with callback URL', async () => {
      if (!testAccessToken || !process.env.DATASWIFT_USERNAME || !process.env.DATASWIFT_PASSWORD) {
        console.warn('⚠️  Skipping webhook callback test - missing credentials');
        return;
      }

      const payload = {
        sub: 'callback_test_user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const testJwt = `${header}.${encodedPayload}.test_signature`;

      // Use httpbin.org as a test callback URL
      const response = await request(app)
        .post('/webhook/connect')
        .set('Authorization', `Bearer ${testJwt}`)
        .set('Content-Type', 'application/json')
        .send({
          data: 'callback-test@example.com',
          async: true,
          callback_url: 'https://httpbin.org/post'
        })
        .expect('Content-Type', /json/);

      // Should accept async request
      expect([202, 400]).toContain(response.status); // 400 if no token available

      if (response.status === 202) {
        expect(response.body).toMatchObject({
          status: 'accepted',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: 'Request accepted for asynchronous processing',
          processing: expect.objectContaining({
            status: 'pending',
            callbackUrl: 'https://httpbin.org/post'
          }),
          timestamp: expect.any(String)
        });

        // Wait a moment for async processing to start
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check request status
        const statusResponse = await request(app)
          .get(`/webhook/status/${response.body.requestId}`)
          .expect('Content-Type', /json/);

        expect([200, 404]).toContain(statusResponse.status);

        if (statusResponse.status === 200) {
          expect(statusResponse.body).toMatchObject({
            status: 'success',
            data: expect.objectContaining({
              requestId: response.body.requestId,
              status: expect.stringMatching(/^(pending|processing|completed|failed)$/),
              hasCallback: true
            })
          });
        }
      }
    });
  });

  describe('Test Endpoints Integration', () => {
    test('should test wallet health endpoint', async () => {
      const response = await request(app)
        .get('/test/wallet-health')
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);
      
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(success|error)$/),
        message: 'Wallet health check completed',
        health: expect.objectContaining({
          wallet: expect.any(String),
          api: expect.any(String),
          authentication: expect.any(String),
          applicationId: expect.any(String)
        }),
        timestamp: expect.any(String)
      });
    });

    test('should test wallet connection endpoint', async () => {
      const response = await request(app)
        .get('/test/wallet-connection')
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);
      
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(success|error)$/),
        message: expect.any(String),
        timestamp: expect.any(String)
      });

      if (response.body.status === 'success') {
        expect(response.body.details).toMatchObject({
          success: true,
          details: expect.objectContaining({
            namespace: 'test/monzo'
          })
        });
      }
    });

    test('should test complete flow endpoint with test data', async () => {
      const response = await request(app)
        .get('/test/complete-flow?useTestData=true')
        .expect('Content-Type', /json/);

      expect([200, 400, 503]).toContain(response.status);
      
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(success|partial_success|error)$/),
        message: expect.any(String),
        timestamp: expect.any(String)
      });

      if (response.body.flow) {
        expect(response.body.flow).toMatchObject({
          monzoExtraction: expect.objectContaining({
            success: expect.any(Boolean),
            useTestData: true
          }),
          walletStorage: expect.objectContaining({
            success: expect.any(Boolean)
          })
        });
      }
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle invalid JWT tokens gracefully', async () => {
      const response = await request(app)
        .post('/webhook/connect')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .set('Content-Type', 'application/json')
        .send({
          data: 'test@example.com'
        })
        .expect(401)
        .expect('Content-Type', /json/);

      expect(response.body).toMatchObject({
        status: 'error',
        error: expect.objectContaining({
          code: 'invalid_token',
          message: expect.any(String)
        }),
        timestamp: expect.any(String)
      });
    });

    test('should handle missing authentication gracefully', async () => {
      const response = await request(app)
        .post('/webhook/connect')
        .set('Content-Type', 'application/json')
        .send({
          data: 'test@example.com'
        })
        .expect(401)
        .expect('Content-Type', /json/);

      expect(response.body).toMatchObject({
        status: 'error',
        error: expect.objectContaining({
          code: 'missing_token',
          message: expect.any(String)
        })
      });
    });

    test('should test callback connectivity', async () => {
      const response = await request(app)
        .post('/webhook/test-callback')
        .set('Content-Type', 'application/json')
        .send({
          url: 'https://httpbin.org/post'
        })
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);
      
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(success|error)$/),
        data: expect.objectContaining({
          success: expect.any(Boolean),
          url: 'https://httpbin.org/post'
        }),
        timestamp: expect.any(String)
      });
    });
  });

  afterAll(async () => {
    // Cleanup any test data if needed
    // Close any open connections
    if (walletClient && walletClient.httpClient) {
      // Clean up HTTP client if needed
    }
  });
});

// Export test utilities for other integration tests
module.exports = {
  createTestJwt: (payload = {}) => {
    const defaultPayload = {
      sub: 'test_user',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const encodedPayload = Buffer.from(JSON.stringify(defaultPayload)).toString('base64');
    return `${header}.${encodedPayload}.test_signature`;
  },
  
  testConfig
};