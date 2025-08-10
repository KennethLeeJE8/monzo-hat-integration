// Mock axios completely to avoid import issues
jest.mock('axios', () => ({
  create: jest.fn()
}));

const CallbackClient = require('../callback-client');

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('CallbackClient', () => {
  let callbackClient;
  let mockAxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios instance
    mockAxiosInstance = {
      post: jest.fn()
    };
    
    const axios = require('axios');
    axios.create.mockReturnValue(mockAxiosInstance);
    
    callbackClient = new CallbackClient({
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 500
    });
  });

  describe('Constructor', () => {
    test('should initialize with default options', () => {
      const axios = require('axios');
      const client = new CallbackClient();
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'User-Agent': 'Monzo-Data-Connector/1.0'
          })
        })
      );
    });

    test('should initialize with custom options', () => {
      const axios = require('axios');
      const customOptions = {
        timeout: 10000,
        maxRetries: 5,
        userAgent: 'Custom-Agent/2.0'
      };
      
      const client = new CallbackClient(customOptions);
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 10000,
          headers: expect.objectContaining({
            'User-Agent': 'Custom-Agent/2.0'
          })
        })
      );
    });
  });

  describe('sendCallback', () => {
    const testUrl = 'https://example.com/callback';
    const testPayload = { requestId: 'test123', status: 'completed' };

    test('should send successful callback', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: { received: true }
      });

      const result = await callbackClient.sendCallback(testUrl, testPayload);

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          statusCode: 200,
          duration: expect.any(Number),
          attempts: 1
        })
      );
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(testUrl, testPayload);
    });

    test('should return error when no URL provided', async () => {
      const result = await callbackClient.sendCallback(null, testPayload);

      expect(result).toEqual({
        success: false,
        error: 'No callback URL provided'
      });
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    test('should retry on server errors', async () => {
      mockAxiosInstance.post
        .mockRejectedValueOnce(new Error('HTTP 500: Server error'))
        .mockResolvedValue({
          status: 200,
          statusText: 'OK',
          data: { received: true }
        });

      const result = await callbackClient.sendCallback(testUrl, testPayload);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    test('should not retry on client errors', async () => {
      const clientError = new Error('HTTP 404: Not Found');
      clientError.response = { status: 404, statusText: 'Not Found' };
      mockAxiosInstance.post.mockRejectedValue(clientError);

      const result = await callbackClient.sendCallback(testUrl, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 404');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    test('should fail after max retries', async () => {
      const serverError = new Error('HTTP 503: Service Unavailable');
      mockAxiosInstance.post.mockRejectedValue(serverError);

      const result = await callbackClient.sendCallback(testUrl, testPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('All 2 callback attempts failed');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendStatusCallback', () => {
    const testUrl = 'https://example.com/callback';
    const testStatus = { requestId: 'test123', status: 'processing' };

    test('should add metadata to status callback', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { received: true }
      });

      await callbackClient.sendStatusCallback(testUrl, testStatus);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          ...testStatus,
          timestamp: expect.any(String),
          connector: 'monzo-data-connector',
          version: '1.0.0'
        })
      );
    });
  });

  describe('sendSuccessCallback', () => {
    const testUrl = 'https://example.com/callback';

    test('should format success callback correctly', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { received: true }
      });

      const testData = { accounts: [], balances: [] };
      await callbackClient.sendSuccessCallback(testUrl, 'req123', testData, 5000);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          requestId: 'req123',
          status: 'completed',
          message: 'Data extraction completed successfully',
          data: testData,
          duration: 5000,
          timestamp: expect.any(String),
          connector: 'monzo-data-connector',
          version: '1.0.0'
        })
      );
    });
  });

  describe('sendFailureCallback', () => {
    const testUrl = 'https://example.com/callback';

    test('should format failure callback correctly', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { received: true }
      });

      await callbackClient.sendFailureCallback(testUrl, 'req123', 'Connection failed', 3000);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          requestId: 'req123',
          status: 'failed',
          message: 'Data extraction failed: Connection failed',
          error: 'Connection failed',
          duration: 3000,
          timestamp: expect.any(String),
          connector: 'monzo-data-connector',
          version: '1.0.0'
        })
      );
    });
  });

  describe('sendProcessingCallback', () => {
    const testUrl = 'https://example.com/callback';

    test('should format processing callback correctly', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { received: true }
      });

      await callbackClient.sendProcessingCallback(testUrl, 'req123', 'Custom processing message');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          requestId: 'req123',
          status: 'processing',
          message: 'Custom processing message',
          timestamp: expect.any(String),
          connector: 'monzo-data-connector',
          version: '1.0.0'
        })
      );
    });

    test('should use default processing message', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { received: true }
      });

      await callbackClient.sendProcessingCallback(testUrl, 'req123');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          message: 'Data extraction in progress'
        })
      );
    });
  });

  describe('URL Validation', () => {
    test('should accept valid HTTPS URLs', () => {
      expect(callbackClient.isValidCallbackUrl('https://example.com/callback')).toBe(true);
    });

    test('should accept valid HTTP URLs', () => {
      expect(callbackClient.isValidCallbackUrl('http://example.com/callback')).toBe(true);
    });

    test('should reject non-HTTP protocols', () => {
      expect(callbackClient.isValidCallbackUrl('ftp://example.com')).toBe(false);
      expect(callbackClient.isValidCallbackUrl('file://test.txt')).toBe(false);
    });

    test('should reject local addresses for security', () => {
      expect(callbackClient.isValidCallbackUrl('http://localhost/callback')).toBe(false);
      expect(callbackClient.isValidCallbackUrl('http://127.0.0.1/callback')).toBe(false);
      expect(callbackClient.isValidCallbackUrl('http://192.168.1.1/callback')).toBe(false);
      expect(callbackClient.isValidCallbackUrl('http://10.0.0.1/callback')).toBe(false);
    });

    test('should reject malformed URLs', () => {
      expect(callbackClient.isValidCallbackUrl('not-a-url')).toBe(false);
      expect(callbackClient.isValidCallbackUrl('')).toBe(false);
      expect(callbackClient.isValidCallbackUrl(null)).toBe(false);
    });
  });

  describe('Local Address Detection', () => {
    test('should identify localhost variations', () => {
      expect(callbackClient.isLocalAddress('localhost')).toBe(true);
      expect(callbackClient.isLocalAddress('LOCALHOST')).toBe(true);
      expect(callbackClient.isLocalAddress('127.0.0.1')).toBe(true);
      expect(callbackClient.isLocalAddress('127.1.1.1')).toBe(true);
    });

    test('should identify private networks', () => {
      expect(callbackClient.isLocalAddress('192.168.1.1')).toBe(true);
      expect(callbackClient.isLocalAddress('10.0.0.1')).toBe(true);
      expect(callbackClient.isLocalAddress('172.16.0.1')).toBe(true);
      expect(callbackClient.isLocalAddress('169.254.1.1')).toBe(true);
    });

    test('should allow public addresses', () => {
      expect(callbackClient.isLocalAddress('example.com')).toBe(false);
      expect(callbackClient.isLocalAddress('8.8.8.8')).toBe(false);
      expect(callbackClient.isLocalAddress('1.1.1.1')).toBe(false);
    });
  });

  describe('URL Sanitization', () => {
    test('should sanitize sensitive query parameters', () => {
      const url = 'https://example.com/callback?token=secret123&key=apikey456&other=public';
      const sanitized = callbackClient.sanitizeUrl(url);
      
      expect(sanitized).toContain('token=***');
      expect(sanitized).toContain('key=***');
      expect(sanitized).toContain('other=public');
      expect(sanitized).not.toContain('secret123');
      expect(sanitized).not.toContain('apikey456');
    });

    test('should handle malformed URLs gracefully', () => {
      const url = 'not-a-url?token=secret123';
      const sanitized = callbackClient.sanitizeUrl(url);
      
      expect(sanitized).toContain('token=***');
      expect(sanitized).not.toContain('secret123');
    });
  });

  describe('testCallback', () => {
    const testUrl = 'https://example.com/test';

    test('should send test payload successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { received: true }
      });

      const result = await callbackClient.testCallback(testUrl);

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          url: testUrl,
          duration: expect.any(Number),
          statusCode: 200
        })
      );

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          test: true,
          connector: 'monzo-data-connector',
          message: 'Connectivity test'
        })
      );
    });

    test('should handle test callback failure', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Connection failed'));

      const result = await callbackClient.testCallback(testUrl);

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          url: testUrl
        })
      );
      
      // Check that result has either error or duration property
      expect(result).toHaveProperty('duration');
    });
  });

  describe('Utility Methods', () => {
    test('should generate unique callback IDs', () => {
      const id1 = callbackClient.generateCallbackId();
      const id2 = callbackClient.generateCallbackId();
      
      expect(id1).toMatch(/^cb_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^cb_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('should implement sleep correctly', async () => {
      const startTime = Date.now();
      await callbackClient.sleep(100);
      const duration = Date.now() - startTime;
      
      // Allow some tolerance for timing
      expect(duration).toBeGreaterThanOrEqual(95);
      expect(duration).toBeLessThan(150);
    });
  });
});