const MonzoWebhookHandler = require('../monzo-webhook');

// Mock dependencies
const mockConnector = {
  testConnection: jest.fn(),
  getCompleteAccountData: jest.fn()
};

const mockWalletClient = {
  storeData: jest.fn(),
  storeCompleteData: jest.fn()
};

const mockCallbackClient = {
  sendStatusCallback: jest.fn()
};

// Mock logger to prevent console spam during tests
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('MonzoWebhookHandler', () => {
  let webhookHandler;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create fresh instance
    webhookHandler = new MonzoWebhookHandler(mockConnector, mockWalletClient, mockCallbackClient);
    
    // Setup mock request and response objects
    mockReq = {
      headers: {},
      body: {}
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis()
    };
  });

  describe('JWT Token Extraction', () => {
    test('should extract token from Authorization header', () => {
      mockReq.headers.authorization = 'Bearer test.jwt.token';
      const token = webhookHandler.extractJwtToken(mockReq);
      expect(token).toBe('test.jwt.token');
    });

    test('should extract token from request body', () => {
      mockReq.body.token = 'test.jwt.token';
      const token = webhookHandler.extractJwtToken(mockReq);
      expect(token).toBe('test.jwt.token');
    });

    test('should extract token from X-Auth-Token header', () => {
      mockReq.headers['x-auth-token'] = 'test.jwt.token';
      const token = webhookHandler.extractJwtToken(mockReq);
      expect(token).toBe('test.jwt.token');
    });

    test('should return null when no token found', () => {
      const token = webhookHandler.extractJwtToken(mockReq);
      expect(token).toBeNull();
    });

    test('should prioritize Authorization header over body token', () => {
      mockReq.headers.authorization = 'Bearer header.token';
      mockReq.body.token = 'body.token';
      const token = webhookHandler.extractJwtToken(mockReq);
      expect(token).toBe('header.token');
    });
  });

  describe('JWT Token Validation', () => {
    test('should validate properly formatted JWT with required claims', async () => {
      // Create a valid JWT-like token (base64 encoded)
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const token = `header.${encodedPayload}.signature`;

      const result = await webhookHandler.validateJwtToken(token);
      expect(result).toEqual(payload);
    });

    test('should reject token with invalid format', async () => {
      const result = await webhookHandler.validateJwtToken('invalid.token');
      expect(result).toBeNull();
    });

    test('should reject token missing required claims', async () => {
      const payload = { someOtherClaim: 'value' }; // Missing sub and iat
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const token = `header.${encodedPayload}.signature`;

      const result = await webhookHandler.validateJwtToken(token);
      expect(result).toBeNull();
    });

    test('should reject expired token', async () => {
      const payload = { 
        sub: 'user123', 
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
      };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const token = `header.${encodedPayload}.signature`;

      const result = await webhookHandler.validateJwtToken(token);
      expect(result).toBeNull();
    });

    test('should handle malformed JWT payload', async () => {
      const token = 'header.invalidbase64.signature';
      const result = await webhookHandler.validateJwtToken(token);
      expect(result).toBeNull();
    });
  });

  describe('Webhook Request Validation', () => {
    test('should reject request without JWT token', async () => {
      mockReq.body = { data: 'user@example.com' };

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'missing_token'
          })
        })
      );
    });

    test('should reject request with invalid JWT token', async () => {
      mockReq.headers.authorization = 'Bearer invalid.token';
      mockReq.body = { data: 'user@example.com' };

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'invalid_token'
          })
        })
      );
    });

    test('should reject request without user data', async () => {
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = {}; // Missing data

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'missing_data'
          })
        })
      );
    });

    test('should reject request with invalid callback URL', async () => {
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = { 
        data: 'user@example.com',
        callback_url: 'not-a-valid-url'
      };

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'invalid_callback'
          })
        })
      );
    });
  });

  describe('Synchronous Request Processing', () => {
    beforeEach(() => {
      // Mock environment token
      process.env.MONZO_ACCESS_TOKEN = 'test_access_token';
    });

    afterEach(() => {
      delete process.env.MONZO_ACCESS_TOKEN;
      delete global.tempAccessToken;
    });

    test('should process valid synchronous request successfully', async () => {
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = { data: 'user@example.com' };

      // Mock successful API calls
      mockConnector.testConnection.mockResolvedValue({ success: true });
      mockConnector.getCompleteAccountData.mockResolvedValue({
        accounts: [{ id: 'acc_123', description: 'Test Account' }],
        balances: [{ accountId: 'acc_123', balance: 1000 }]
      });
      
      // Mock successful wallet storage
      mockWalletClient.storeCompleteData.mockResolvedValue({
        success: true,
        recordId: 'wallet_record_123',
        namespace: 'monzo',
        timestamp: new Date().toISOString()
      });

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          message: 'Data extraction and wallet storage completed successfully',
          data: expect.objectContaining({
            accounts: expect.arrayContaining([
              expect.objectContaining({ id: 'acc_123' })
            ]),
            balances: expect.arrayContaining([
              expect.objectContaining({ accountId: 'acc_123' })
            ])
          }),
          wallet: expect.objectContaining({
            stored: true,
            recordId: 'wallet_record_123',
            namespace: 'monzo'
          })
        })
      );
    });

    test('should handle missing access token', async () => {
      delete process.env.MONZO_ACCESS_TOKEN;
      
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = { data: 'user@example.com' };

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'no_token'
          })
        })
      );
    });

    test('should handle API connection failure', async () => {
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = { data: 'user@example.com' };

      mockConnector.testConnection.mockResolvedValue({ success: false });

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'connection_failed'
          })
        })
      );
    });

    test('should handle data extraction failure', async () => {
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = { data: 'user@example.com' };

      mockConnector.testConnection.mockResolvedValue({ success: true });
      mockConnector.getCompleteAccountData.mockRejectedValue(new Error('API Error'));

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'extraction_failed'
          })
        })
      );
    });
  });

  describe('Asynchronous Request Processing', () => {
    beforeEach(() => {
      process.env.MONZO_ACCESS_TOKEN = 'test_access_token';
    });

    afterEach(() => {
      delete process.env.MONZO_ACCESS_TOKEN;
      jest.clearAllTimers();
    });

    test('should accept asynchronous request and return 202', async () => {
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = { 
        data: 'user@example.com',
        async: true,
        callback_url: 'https://example.com/callback'
      };

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'accepted',
          requestId: expect.stringMatching(/^monzo_\d+_[a-z0-9]+$/),
          message: 'Request accepted for asynchronous processing'
        })
      );
    });

    test('should store pending request data', async () => {
      const payload = { sub: 'user123', iat: Math.floor(Date.now() / 1000) };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      mockReq.headers.authorization = `Bearer header.${encodedPayload}.signature`;
      mockReq.body = { 
        data: 'user@example.com',
        async: true,
        callback_url: 'https://example.com/callback'
      };

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      // Check that a request was stored
      const requestId = mockRes.json.mock.calls[0][0].requestId;
      const status = webhookHandler.getRequestStatus(requestId);
      
      expect(status).toEqual(
        expect.objectContaining({
          requestId,
          status: 'pending',
          hasCallback: true
        })
      );
    });
  });

  describe('Request Status Tracking', () => {
    test('should return null for non-existent request ID', () => {
      const status = webhookHandler.getRequestStatus('non_existent_id');
      expect(status).toBeNull();
    });

    test('should track request status correctly', () => {
      // Manually add a request to the pending requests map
      const requestId = 'test_request_123';
      webhookHandler.pendingRequests.set(requestId, {
        status: 'processing',
        createdAt: new Date().toISOString(),
        startTime: Date.now() - 5000, // 5 seconds ago
        callbackUrl: 'https://example.com/callback'
      });

      const status = webhookHandler.getRequestStatus(requestId);
      
      expect(status).toEqual(
        expect.objectContaining({
          requestId,
          status: 'processing',
          hasCallback: true,
          duration: expect.any(Number)
        })
      );
    });
  });

  describe('Utility Methods', () => {
    test('should generate valid request IDs', () => {
      const id1 = webhookHandler.generateRequestId();
      const id2 = webhookHandler.generateRequestId();
      
      expect(id1).toMatch(/^monzo_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^monzo_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('should validate URLs correctly', () => {
      expect(webhookHandler.isValidUrl('https://example.com')).toBe(true);
      expect(webhookHandler.isValidUrl('http://example.com')).toBe(true);
      expect(webhookHandler.isValidUrl('ftp://example.com')).toBe(true); // URL constructor accepts all valid URLs
      expect(webhookHandler.isValidUrl('not-a-url')).toBe(false);
      expect(webhookHandler.isValidUrl('')).toBe(false);
    });

    test('should format error responses correctly', () => {
      const response = webhookHandler.respondWithError(mockRes, 'test_error', 'Test message', 400);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: {
            code: 'test_error',
            message: 'Test message'
          },
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle unexpected errors gracefully', async () => {
      // Mock an error in JWT extraction
      mockReq.headers.authorization = 'Bearer test.token.here';
      mockReq.body = { data: 'user@example.com' };
      
      // Mock validateJwtToken to throw an unexpected error
      jest.spyOn(webhookHandler, 'validateJwtToken').mockRejectedValue(new Error('Unexpected error'));

      await webhookHandler.handleConnectRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({
            code: 'processing_error'
          })
        })
      );
    });
  });
});