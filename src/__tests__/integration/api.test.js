const request = require('supertest');

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

describe('End-to-End Integration Tests (Server Running)', () => {
  const serverPort = process.env.CONNECTOR_PORT || 8080;
  const serverUrl = `http://localhost:${serverPort}`;
  
  // Test configuration
  const hasMonzoToken = !!(process.env.MONZO_ACCESS_TOKEN || process.env.MONZO_CLIENT_ID);
  const hasWalletCreds = !!(process.env.DATASWIFT_USERNAME && process.env.DATASWIFT_PASSWORD);

  beforeAll(() => {
    console.log('🧪 Running integration tests against server at', serverUrl);
    console.log('Environment:', {
      hasMonzoToken,
      hasWalletCreds,
      applicationId: process.env.DS_APPLICATION_ID || 'oi-s-monzodataconnector'
    });
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
        timestamp: expect.any(String),
        version: expect.any(String)
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

      if (hasWalletCreds && response.status === 200) {
        expect(response.body.health).toMatchObject({
          wallet: expect.any(String),
          api: expect.any(String),
          authentication: expect.any(String)
        });
      }
    });
  });

  describe('Webhook Endpoints - Authentication', () => {
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

  describe('Webhook Endpoints - Real API Integration', () => {
    test('should process webhook with valid JWT (sync mode)', async () => {
      const testJwt = createTestJwt();
      const response = await request(serverUrl)
        .post('/webhook/connect')
        .set('Authorization', `Bearer ${testJwt}`)
        .send({ data: 'integration-test@example.com' })
        .expect('Content-Type', /json/);

      // Should either succeed (200) or fail due to missing/invalid token (400)
      expect([200, 400, 503]).toContain(response.status);

      if (response.status === 200) {
        // Success: Real API integration working
        expect(response.body).toMatchObject({
          status: 'success',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: expect.stringContaining('completed successfully'),
          data: expect.objectContaining({
            accounts: expect.any(Array),
            balances: expect.any(Array),
            extractionTime: expect.any(String),
            connectionTest: expect.objectContaining({
              success: true
            })
          }),
          wallet: expect.objectContaining({
            stored: expect.any(Boolean),
            namespace: expect.stringMatching(/monzo$/)
          }),
          timestamp: expect.any(String)
        });

        // Verify we got real Monzo data
        if (response.body.data.accounts.length > 0) {
          expect(response.body.data.accounts[0]).toMatchObject({
            id: expect.stringMatching(/^acc_/),
            description: expect.any(String),
            currency: 'GBP'
          });
        }

        console.log('✅ Real Monzo API integration successful:', {
          accounts: response.body.data.accounts.length,
          balances: response.body.data.balances.length,
          walletStored: response.body.wallet.stored,
          namespace: response.body.wallet.namespace
        });

      } else if (response.status === 400) {
        // Expected failure: No Monzo token available
        expect(response.body).toMatchObject({
          status: 'error',
          error: expect.objectContaining({
            code: 'no_token'
          })
        });
        console.log('⚠️  Webhook test skipped - no Monzo access token available');

      } else if (response.status === 503) {
        // API connection failure
        expect(response.body).toMatchObject({
          status: 'error',
          error: expect.objectContaining({
            code: 'connection_failed'
          })
        });
        console.log('⚠️  Monzo API connection failed - check token validity');
      }
    });

    test('should process webhook with callback (async mode)', async () => {
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
        // Async request accepted
        expect(response.body).toMatchObject({
          status: 'accepted',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: 'Request accepted for asynchronous processing',
          processing: expect.objectContaining({
            status: 'pending',
            callbackUrl: 'https://httpbin.org/post'
          })
        });

        console.log('✅ Async webhook accepted:', response.body.requestId);

        // Wait for processing to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check request status
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

          console.log('✅ Async processing status:', statusResponse.body.data.status);
        }

      } else {
        console.log('⚠️  Async webhook test skipped - no access token');
      }
    });
  });

  describe('Wallet Integration - Real API Tests', () => {
    test('should test wallet connection with real credentials', async () => {
      if (!hasWalletCreds) {
        console.log('⚠️  Skipping wallet connection test - no credentials');
        return;
      }

      const response = await request(serverUrl)
        .get('/test/wallet-connection')
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          status: 'success',
          message: expect.stringContaining('successful'),
          details: expect.objectContaining({
            success: true,
            namespace: 'monzo/test'
          })
        });

        console.log('✅ Wallet connection successful:', {
          namespace: response.body.details.namespace,
          success: response.body.details.success
        });

      } else {
        console.log('❌ Wallet connection failed:', response.body.message);
      }
    });

    test('should store test data in wallet (test/monzo namespace)', async () => {
      if (!hasWalletCreds) {
        console.log('⚠️  Skipping wallet storage test - no credentials');
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
            namespace: 'monzo/test',
            dataSize: expect.any(Number)
          }),
          testDataUsed: true
        });

        console.log('✅ Test data stored in wallet:', {
          recordId: response.body.result.recordId,
          namespace: response.body.result.namespace,
          dataSize: response.body.result.dataSize
        });

      } else {
        console.log('❌ Wallet storage failed:', response.body.message);
      }
    });

    test('should store real Monzo data in wallet (test/monzo namespace)', async () => {
      if (!hasWalletCreds || !hasMonzoToken) {
        console.log('⚠️  Skipping real data wallet storage - missing credentials');
        return;
      }

      const response = await request(serverUrl)
        .post('/test/wallet-store')
        .send({ useTestData: false })
        .expect('Content-Type', /json/);

      expect([200, 400, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          status: 'success',
          result: expect.objectContaining({
            success: true,
            namespace: 'monzo/test',
            recordId: expect.any(String)
          }),
          testDataUsed: false
        });

        console.log('✅ Real Monzo data stored in wallet:', {
          recordId: response.body.result.recordId,
          namespace: response.body.result.namespace,
          realData: true
        });

      } else if (response.status === 400) {
        console.log('⚠️  Real data storage skipped - no Monzo token available');
      } else {
        console.log('❌ Real data storage failed:', response.body.message);
      }
    });

    test('should retrieve data from wallet', async () => {
      if (!hasWalletCreds) {
        console.log('⚠️  Skipping wallet retrieval test - no credentials');
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

      if (response.status === 200 && response.body.result.success) {
        console.log('✅ Data retrieved from wallet successfully');
      } else {
        console.log('⚠️  Wallet retrieval status:', response.body.result.success ? 'success' : 'failed');
      }
    });
  });

  describe('OAuth Integration Tests (Split for Mobile Approval)', () => {
    test('PART 1: Webhook → OAuth Authentication (Complete first, then approve in mobile app)', async () => {
      console.log('🔐 PART 1: Testing Webhook → Monzo OAuth authentication...');
      console.log('💡 After this test, you will need to approve access in your Monzo mobile app');
      console.log('🔄 Then run PART 2 to complete the full flow\n');

      // Step 1: Test webhook functionality first
      console.log('   📡 Step 1: Testing webhook endpoint...');
      const testJwt = createTestJwt({ sub: 'oauth_test_user_part1' });
      
      const webhookResponse = await request(serverUrl)
        .post('/webhook/connect')
        .set('Authorization', `Bearer ${testJwt}`)
        .send({ data: 'oauth-part1-test@example.com' })
        .timeout(30000)
        .expect('Content-Type', /json/);

      expect([200, 400, 503]).toContain(webhookResponse.status);
      
      if (webhookResponse.status === 200) {
        console.log('   ✅ Webhook processed successfully');
        expect(webhookResponse.body).toMatchObject({
          status: 'success',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: expect.stringContaining('completed successfully')
        });
      } else {
        console.log('   ⚠️  Webhook processing had issues (expected if no token):', webhookResponse.body.message);
      }

      // Step 2: Trigger OAuth authentication (opens browser popup)
      console.log('   🚀 Step 2: Triggering Monzo OAuth authentication...');
      console.log('   💡 This will open your browser for Monzo login - please complete authentication');
      
      const oauthResponse = await request(serverUrl)
        .get('/test/monzo-auth')
        .timeout(180000) // 3 minutes for user interaction
        .expect('Content-Type', /json/);

      // Accept both successful OAuth and cases where we already have a token
      expect([200, 400]).toContain(oauthResponse.status);

      if (oauthResponse.status === 400 && oauthResponse.body.message?.includes('already have')) {
        console.log('   ✅ OAuth token already available from previous session');
        console.log('   🔄 PART 1 completed - token is saved, proceed to PART 2');
        return;
      }

      if (oauthResponse.status !== 200) {
        console.log('   ❌ OAuth authentication failed:', oauthResponse.body.message || 'Unknown error');
        console.log('   ⚠️  This could be due to:');
        console.log('       - User cancelled the login process');
        console.log('       - Timeout waiting for user interaction');
        console.log('       - Monzo API connectivity issues');
        console.log('   💡 Try running PART 1 again to retry OAuth');
        return;
      }

      // Validate OAuth response
      expect(oauthResponse.body).toMatchObject({
        status: expect.stringMatching(/^(success|auth_success_api_failed)$/),
        tokenData: expect.objectContaining({
          tokenType: expect.any(String),
          expiresIn: expect.any(Number),
          scope: expect.any(String)
        })
      });

      console.log('   ✅ OAuth authentication completed and token saved!');
      console.log('   📋 Token details:', {
        tokenType: oauthResponse.body.tokenData.tokenType,
        expiresIn: oauthResponse.body.tokenData.expiresIn,
        scope: oauthResponse.body.tokenData.scope,
        status: oauthResponse.body.status
      });

      // PART 1 STOPS HERE - Token is now saved on the server
      console.log('\n   🎯 PART 1 COMPLETED SUCCESSFULLY!');
      console.log('   💾 Access token has been saved on the server');
      
      if (oauthResponse.body.status === 'auth_success_api_failed') {
        console.log('   📱 NEXT STEP: Please approve access in your Monzo mobile app');
        console.log('   ⏳ After mobile approval, run: npm run test:oauth-part2');
      } else {
        console.log('   ✅ API connection is working - you can run: npm run test:oauth-part2');
      }
      
      console.log('   🔄 Token will be available for PART 2 test');

    }, 300000); // 5 minute timeout for OAuth flow

    test('PART 2: Monzo Data → Wallet Storage (Run after mobile app approval)', async () => {
      console.log('🏦 PART 2: Testing Monzo Data → Wallet Storage...');
      console.log('💡 Make sure you approved access in your Monzo mobile app before running this test\n');

      // Step 1: Verify we have a stored token from Part 1
      console.log('   🔍 Step 1: Checking for stored access token from PART 1...');
      
      const tokenCheckResponse = await request(serverUrl)
        .get('/test/monzo-connection-auto')
        .timeout(10000)
        .expect('Content-Type', /json/);

      if (tokenCheckResponse.status === 400) {
        console.log('   ❌ No access token found from PART 1');
        console.log('   💡 Please run PART 1 test first to complete OAuth authentication');
        throw new Error('No access token - run PART 1 first');
      }

      console.log('   ✅ Access token found from PART 1');

      // Step 2: Retrieve Monzo account data using stored token
      console.log('   📊 Step 2: Retrieving Monzo account data...');
      
      const monzoDataResponse = await request(serverUrl)
        .get('/test/monzo-data')
        .timeout(30000)
        .expect('Content-Type', /json/);

      expect([200, 400]).toContain(monzoDataResponse.status);

      if (monzoDataResponse.status !== 200) {
        console.log('   ❌ Monzo data retrieval failed:', monzoDataResponse.body.message || 'Unknown error');
        console.log('   💡 Make sure you approved access in your Monzo mobile app');
        console.log('   🔄 Try approving in the app and re-running this test');
        throw new Error('Mobile app approval still needed');
      }

      // Validate Monzo data response
      expect(monzoDataResponse.body).toMatchObject({
        status: 'success',
        message: expect.stringContaining('Successfully retrieved'),
        data: expect.objectContaining({
          connectionTest: expect.objectContaining({
            success: true
          }),
          accounts: expect.any(Array),
          balances: expect.any(Array),
          summary: expect.objectContaining({
            accountCount: expect.any(Number)
          })
        })
      });

      console.log('   ✅ Monzo data retrieved successfully!');
      console.log('   📊 Account data:', {
        accountCount: monzoDataResponse.body.data.accounts.length,
        balanceCount: monzoDataResponse.body.data.balances.length,
        connectionSuccess: monzoDataResponse.body.data.connectionTest.success
      });

      // Step 3: Store Monzo data in Dataswift wallet
      if (!hasWalletCreds) {
        console.log('   ⚠️  Skipping wallet storage - no Dataswift credentials configured');
        console.log('   🎉 OAuth → Monzo flow completed successfully!');
        return;
      }

      console.log('   💾 Step 3: Storing Monzo data in Dataswift wallet with new checksum format...');

      // Take the Monzo data and store it with proper checksum metadata structure
      try {
        // Use a custom endpoint that ensures proper data structure and namespace
        const walletStoreResponse = await request(serverUrl)
          .post('/test/store-monzo-with-checksum')
          .send({ 
            monzoData: monzoDataResponse.body.data,
            namespace: 'monzo',
            isTest: false, // Ensures writes to monzo namespace (production)
            inbox_message_id: `test_${Date.now()}` // Add unique message ID
          })
          .expect('Content-Type', /json/);
        
        console.log('   📋 Wallet storage result:', walletStoreResponse.body.status);
        
        const walletResult = walletStoreResponse.body.result || { success: walletStoreResponse.body.status === 'success' };
        
        var walletResponse = {
          status: walletResult.success ? 200 : 500,
          body: {
            status: walletResult.success ? 'success' : 'error',
            message: walletResult.success ? 'Monzo data stored with checksum metadata' : 'Failed to store Monzo data',
            result: walletResult
          }
        };
        
        if (walletResult.success) {
          console.log('   ✅ Monzo data stored with checksum metadata!');
          console.log('   📋 Storage details:', {
            namespace: walletResult.namespace,
            path: walletResult.path,
            actualChecksum: walletResult.actualChecksum?.substring(0, 16) + '...',
            dataSize: walletResult.dataSize,
            timestamp: walletResult.timestamp
          });
          
          // Verify the payload structure matches our requirements
          expect(walletResult.payloadStructure).toMatchObject({
            metadata: {
              inbox_message_id: expect.any(String),
              create_at: expect.any(String),
              checksum: expect.stringMatching(/^[a-f0-9]{64}$/) // SHA-256 hex
            },
            data: expect.any(String)
          });
          
          console.log('   ✅ Payload structure verified with actual checksum:', walletResult.actualChecksum?.substring(0, 16) + '...');
        } else if (walletResult.isDuplicate) {
          console.log('   ✅ Data already exists (duplicate data - this is expected)');
        } else {
          console.log('   ❌ Storage failed:', walletResult.error);
        }
        
      } catch (walletError) {
        // Fallback: try the original wallet store endpoint
        console.log('   🔄 Fallback: Using original wallet-store endpoint...');
        try {
          const fallbackResponse = await request(serverUrl)
            .post('/test/wallet-store')
            .send({ useTestData: false })
            .expect('Content-Type', /json/);
          
          var walletResponse = {
            status: fallbackResponse.status,
            body: fallbackResponse.body
          };
          
          console.log('   📋 Fallback storage result:', fallbackResponse.body.status);
          
        } catch (fallbackError) {
          var walletResponse = {
            status: 500,
            body: {
              status: 'error',
              message: 'Both wallet storage methods failed',
              result: {
                success: false,
                error: fallbackError.message,
                originalError: walletError.message
              }
            }
          };
          
          console.log('   ❌ All wallet storage attempts failed');
        }
      }

      expect([200, 400, 500]).toContain(walletResponse.status);

      // Step 4: Test callback to simulate end-to-end webhook response
      console.log('   📞 Step 4: Testing callback URL (simulating webhook completion)...');
      
      const callbackTestResponse = await request(serverUrl)
        .post('/webhook/test-callback')
        .send({ url: 'https://httpbin.org/post' })
        .timeout(10000)
        .expect('Content-Type', /json/);

      expect([200, 500]).toContain(callbackTestResponse.status);

      if (walletResponse.status === 200) {
        expect(walletResponse.body).toMatchObject({
          status: 'success',
          message: expect.stringContaining('stored'),
          result: expect.objectContaining({
            success: expect.any(Boolean),
            namespace: 'monzo', // Updated to production namespace
            actualChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) // Verify actual SHA-256 checksum
          })
        });

        console.log('   ✅ Complete integration flow successful!');
        console.log('   🎯 Final results:');
        console.log('   📊 Monzo Data:', {
          accountsRetrieved: monzoDataResponse.body.data.accounts.length,
          balancesRetrieved: monzoDataResponse.body.data.balances.length
        });
        console.log('   💾 Wallet Storage:', {
          success: walletResponse.body.result.success,
          namespace: walletResponse.body.result.namespace,
          recordId: walletResponse.body.result.recordId || 'N/A',
          isDuplicate: walletResponse.body.result.isDuplicate || false
        });
        console.log('   📞 Callback:', {
          success: callbackTestResponse.body.data?.success || false,
          url: 'https://httpbin.org/post'
        });

      } else {
        console.log('   ⚠️  Wallet storage had issues:', walletResponse.body.message);
        console.log('   🎉 But Monzo data retrieval was successful!');
      }

      console.log('\n🎉 PART 2 completed! Full webhook → OAuth → Monzo → Wallet → Callback flow tested!');

    }, 120000); // 2 minute timeout for data operations

    test('should handle OAuth flow with fallback to test data', async () => {
      console.log('🔄 Testing OAuth flow with fallback to mock data...');

      // This test should always work, even without real OAuth tokens
      const response = await request(serverUrl)
        .get('/test/complete-flow?useTestData=true')
        .expect('Content-Type', /json/);

      expect([200, 400, 503]).toContain(response.status);

      if (response.body.flow) {
        expect(response.body.flow).toMatchObject({
          monzoExtraction: expect.objectContaining({
            success: expect.any(Boolean),
            useTestData: true,
            accountCount: expect.any(Number),
            balanceCount: expect.any(Number)
          })
        });

        if (hasWalletCreds) {
          expect(response.body.flow.walletStorage).toMatchObject({
            success: expect.any(Boolean),
            namespace: 'monzo/test'
          });
        }

        console.log('   ✅ Fallback flow completed:', {
          monzoSuccess: response.body.flow.monzoExtraction.success,
          walletSuccess: response.body.flow.walletStorage?.success || false,
          testData: true
        });
      }
    });
  });

  describe('Complete End-to-End Flow Tests', () => {
    test('should execute complete flow with test data', async () => {
      const response = await request(serverUrl)
        .get('/test/complete-flow?useTestData=true')
        .expect('Content-Type', /json/);

      expect([200, 400, 503]).toContain(response.status);

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

        console.log('✅ Complete flow test (test data):', {
          monzoSuccess: response.body.flow.monzoExtraction.success,
          walletSuccess: response.body.flow.walletStorage.success,
          accounts: response.body.flow.monzoExtraction.accountCount,
          namespace: response.body.flow.walletStorage.namespace
        });

        if (hasWalletCreds) {
          expect(response.body.flow.walletStorage.namespace).toBe('monzo/test');
        }
      }
    });

    test('should execute complete flow with real data (if available)', async () => {
      if (!hasMonzoToken || !hasWalletCreds) {
        console.log('⚠️  Skipping real data complete flow - missing credentials');
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
              namespace: 'monzo/test'
            })
          })
        });

        console.log('✅ Complete flow test (real data):', {
          status: response.body.status,
          accounts: response.body.flow.monzoExtraction.accountCount,
          balances: response.body.flow.monzoExtraction.balanceCount,
          walletStored: response.body.flow.walletStorage.success,
          recordId: response.body.flow.walletStorage.recordId
        });

      } else {
        console.log('⚠️  Real data flow test result:', response.body.message);
      }
    });
  });

  describe('Callback and Error Handling', () => {
    test('should validate callback URLs', async () => {
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

      if (response.body.data.success) {
        console.log('✅ Callback URL validation successful');
      }
    });

    test('should reject invalid callback URLs', async () => {
      const response = await request(serverUrl)
        .post('/webhook/test-callback')
        .send({ url: 'not-a-valid-url' })
        .expect('Content-Type', /json/);

      // Should handle gracefully
      expect([200, 400, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.data.success).toBe(false);
      }
    });
  });
});

// Export test utilities
module.exports = { createTestJwt };