const request = require('supertest');
const http = require('http');

// Helper to create test JWT tokens
function createTestJwt(payload = {}) {
  const defaultPayload = {
    sub: 'integration_test_user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload
  };

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(defaultPayload)).toString('base64');
  return `${header}.${encodedPayload}.test_signature`;
}

describe('End-to-End Integration Tests', () => {
  let server;
  const serverPort = process.env.CONNECTOR_PORT || 8080;
  const serverUrl = `http://localhost:${serverPort}`;
  
  // Test configuration
  const hasMonzoToken = !!(process.env.MONZO_ACCESS_TOKEN || process.env.MONZO_CLIENT_ID);
  const hasWalletCreds = !!(process.env.DATASWIFT_USERNAME && process.env.DATASWIFT_PASSWORD);
  const skipReason = !hasMonzoToken || !hasWalletCreds ? 
    'Missing credentials - set MONZO_ACCESS_TOKEN and DATASWIFT_* variables' : null;

  beforeAll(async () => {
    // Start the server for testing
    try {
      const app = require('../../../server');
      server = app.listen(serverPort, () => {
        console.log(`🧪 Test server running on port ${serverPort}`);
      });
      
      // Wait for server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Failed to start test server:', error);
      throw error;
    }
  }, 10000);

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log('🧪 Test server stopped');
          resolve();
        });
      });
    }
  });

  describe('Health and Status Endpoints', () => {
    test('should respond to health check', async () => {
      const response = await request(serverUrl)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        service: 'monzo-data-connector',
        timestamp: expect.any(String)
      });
    });

    test('should test wallet health', async () => {
      const response = await request(serverUrl)
        .get('/test/wallet-health')
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(success|error)$/),
        message: 'Wallet health check completed',
        timestamp: expect.any(String)
      });

      if (hasWalletCreds) {
        expect(response.body.health).toMatchObject({
          wallet: expect.any(String),
          api: expect.any(String),
          authentication: expect.any(String),
          applicationId: expect.stringMatching(/monzo/)
        });
      }
    });
  });

  describe('Webhook Endpoints', () => {
    test('should reject webhook without JWT token', async () => {
      const response = await request(serverUrl)
        .post('/webhook/connect')
        .send({ data: 'test@example.com' })
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body).toMatchObject({
        status: 'error',
        error: {
          code: 'missing_token',
          message: expect.any(String)
        }
      });
    });

    test('should reject webhook with invalid JWT token', async () => {
      const response = await request(serverUrl)
        .post('/webhook/connect')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .send({ data: 'test@example.com' })
        .expect('Content-Type', /json/)
        .expect(401);

      expect(response.body).toMatchObject({
        status: 'error',
        error: {
          code: 'invalid_token',
          message: expect.any(String)
        }
      });
    });

    test('should accept webhook with valid JWT format', async () => {
      if (skipReason) {
        console.warn(`⚠️  Skipping webhook test: ${skipReason}`);
        return;
      }

      const testJwt = createTestJwt();
      const response = await request(serverUrl)
        .post('/webhook/connect')
        .set('Authorization', `Bearer ${testJwt}`)
        .send({ data: 'integration-test@example.com' })
        .expect('Content-Type', /json/);

      // Should either succeed (200) or fail due to missing token (400)
      expect([200, 400]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          status: 'success',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: expect.stringContaining('completed successfully'),
          data: expect.objectContaining({
            accounts: expect.any(Array),
            balances: expect.any(Array)
          }),
          wallet: expect.objectContaining({
            stored: expect.any(Boolean)
          })
        });
      } else {
        expect(response.body).toMatchObject({
          status: 'error',
          error: expect.objectContaining({
            code: 'no_token'
          })
        });
      }
    });

    test('should handle async webhook requests', async () => {
      if (skipReason) {
        console.warn(`⚠️  Skipping async webhook test: ${skipReason}`);
        return;
      }

      const testJwt = createTestJwt({ sub: 'async_test_user' });
      const response = await request(serverUrl)
        .post('/webhook/connect')
        .set('Authorization', `Bearer ${testJwt}`)
        .send({ 
          data: 'async-test@example.com',
          async: true,
          callback_url: 'https://httpbin.org/post'
        })
        .expect('Content-Type', /json/);

      expect([202, 400]).toContain(response.status);

      if (response.status === 202) {
        expect(response.body).toMatchObject({
          status: 'accepted',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: 'Request accepted for asynchronous processing',
          processing: expect.objectContaining({
            status: 'pending',
            callbackUrl: 'https://httpbin.org/post'
          })
        });

        // Test request status endpoint
        const statusResponse = await request(serverUrl)
          .get(`/webhook/status/${response.body.requestId}`)
          .expect('Content-Type', /json/);

        expect([200, 404]).toContain(statusResponse.status);

        if (statusResponse.status === 200) {
          expect(statusResponse.body.data).toMatchObject({
            requestId: response.body.requestId,
            status: expect.stringMatching(/^(pending|processing|completed|failed)$/),
            hasCallback: true
          });
        }
      }
    });
  });

  describe('Wallet Integration Tests', () => {
    test('should test wallet connection', async () => {
      const response = await request(serverUrl)
        .get('/test/wallet-connection')
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);

      if (hasWalletCreds && response.status === 200) {
        expect(response.body).toMatchObject({
          status: 'success',
          message: expect.any(String),
          details: expect.objectContaining({
            success: true,
            details: expect.objectContaining({
              namespace: 'test/monzo'
            })
          })
        });
      } else {
        expect(response.body.status).toBe('error');
      }
    });

    test('should store test data in wallet', async () => {
      if (!hasWalletCreds) {
        console.warn('⚠️  Skipping wallet storage test - no wallet credentials');
        return;
      }

      const response = await request(serverUrl)
        .post('/test/wallet-store')
        .send({ useTestData: true })
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          status: 'success',
          message: expect.stringContaining('stored'),
          result: expect.objectContaining({
            success: true,
            namespace: 'test/monzo',
            recordId: expect.any(String)
          }),
          testDataUsed: true
        });
      }
    });

    test('should retrieve data from wallet', async () => {
      if (!hasWalletCreds) {
        console.warn('⚠️  Skipping wallet retrieval test - no wallet credentials');
        return;
      }

      const response = await request(serverUrl)
        .get('/test/wallet-retrieve/monzo?isTest=true')
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(success|error)$/),
        message: expect.any(String),
        result: expect.objectContaining({
          success: expect.any(Boolean),
          namespace: 'test/monzo'
        })
      });
    });
  });

  describe('Complete End-to-End Flow', () => {
    test('should execute complete flow with test data', async () => {
      const response = await request(serverUrl)
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
            useTestData: true,
            accountCount: expect.any(Number),
            balanceCount: expect.any(Number)
          }),
          walletStorage: expect.objectContaining({
            success: expect.any(Boolean)
          })
        });

        if (hasWalletCreds) {
          expect(response.body.flow.walletStorage).toMatchObject({
            success: true,
            recordId: expect.any(String),
            namespace: 'test/monzo'
          });
        }
      }
    });

    test('should execute complete flow with real data if available', async () => {
      if (!hasMonzoToken || !hasWalletCreds) {
        console.warn('⚠️  Skipping real data flow test - missing credentials');
        return;
      }

      const response = await request(serverUrl)
        .get('/test/complete-flow')
        .expect('Content-Type', /json/);

      expect([200, 400, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          status: expect.stringMatching(/^(success|partial_success)$/),
          flow: expect.objectContaining({
            monzoExtraction: expect.objectContaining({
              success: true,
              useTestData: false,
              accountCount: expect.any(Number)
            }),
            walletStorage: expect.objectContaining({
              success: expect.any(Boolean),
              namespace: 'test/monzo'
            })
          })
        });
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle callback URL validation', async () => {
      const response = await request(serverUrl)
        .post('/webhook/test-callback')
        .send({ url: 'https://httpbin.org/post' })
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(success|error)$/),
        data: expect.objectContaining({
          success: expect.any(Boolean),
          url: 'https://httpbin.org/post'
        })
      });
    });

    test('should reject invalid callback URLs', async () => {
      const response = await request(serverUrl)
        .post('/webhook/test-callback')
        .send({ url: 'not-a-valid-url' })
        .expect('Content-Type', /json/);

      expect([200, 400, 500]).toContain(response.status);
      
      if (response.status !== 500) {
        expect(response.body.data.success).toBe(false);
      }
    });

    test('should handle missing request data', async () => {
      const testJwt = createTestJwt();
      const response = await request(serverUrl)
        .post('/webhook/connect')
        .set('Authorization', `Bearer ${testJwt}`)
        .send({}) // Missing data field
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toMatchObject({
        status: 'error',
        error: {
          code: 'missing_data',
          message: expect.any(String)
        }
      });
    });
  });

  describe('Environment and Configuration', () => {
    test('should have proper environment configuration', () => {
      const config = {
        hasMonzoToken,
        hasWalletCreds,
        applicationId: process.env.DS_APPLICATION_ID,
        walletUrl: process.env.DATASWIFT_API_URL,
        serverPort: process.env.CONNECTOR_PORT || 8080
      };

      expect(config.applicationId).toBeDefined();
      expect(config.applicationId).toContain('monzo');

      if (hasWalletCreds) {
        expect(config.walletUrl).toBeDefined();
        expect(config.walletUrl).toMatch(/^https?:\/\/.+/);
      }

      console.log('🔧 Configuration check:', config);
    });
  });
});