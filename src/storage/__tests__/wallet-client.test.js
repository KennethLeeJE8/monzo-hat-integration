// Mock axios completely to avoid import issues
jest.mock('axios', () => ({
  create: jest.fn()
}));

const WalletClient = require('../wallet-client');

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('WalletClient', () => {
  let walletClient;
  let mockAxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        response: {
          use: jest.fn()
        }
      }
    };
    
    const axios = require('axios');
    axios.create.mockReturnValue(mockAxiosInstance);
    
    walletClient = new WalletClient({
      apiUrl: 'https://test.hubat.net',
      username: 'testuser',
      password: 'testpass',
      applicationId: 'test-monzo-connector',
      timeout: 5000
    });
  });

  describe('Constructor', () => {
    test('should initialize with default options', () => {
      const axios = require('axios');
      const client = new WalletClient();
      
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://postman.hubat.net',
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );
    });

    test('should initialize with custom options', () => {
      const axios = require('axios');
      const customOptions = {
        apiUrl: 'https://custom.hubat.net',
        applicationId: 'custom-app-id',
        timeout: 10000
      };
      
      const client = new WalletClient(customOptions);
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.hubat.net',
          timeout: 10000
        })
      );
    });

    test('should setup response interceptor for token refresh', () => {
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('Authentication', () => {
    test('should authenticate successfully with valid credentials', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          accessToken: 'test_access_token',
          expiresIn: 3600
        }
      });

      const token = await walletClient.authenticate();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/users/access_token', {
        username: 'testuser',
        password: 'testpass'
      });
      expect(token).toBe('test_access_token');
      expect(walletClient.accessToken).toBe('test_access_token');
    });

    test('should handle authentication failure', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Invalid credentials'));

      await expect(walletClient.authenticate()).rejects.toThrow('Authentication failed: Invalid credentials');
    });

    test('should handle missing access token in response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {} // Missing accessToken
      });

      await expect(walletClient.authenticate()).rejects.toThrow('Authentication failed: No access token received from authentication');
    });
  });

  describe('Application Token', () => {
    beforeEach(() => {
      walletClient.accessToken = 'test_access_token';
    });

    test('should get application token successfully', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          accessToken: 'test_app_token'
        }
      });

      const token = await walletClient.getApplicationToken();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v2.6/applications/test-monzo-connector/access-token', {
        headers: {
          'x-auth-token': 'test_access_token'
        }
      });
      expect(token).toBe('test_app_token');
      expect(walletClient.applicationToken).toBe('test_app_token');
    });

    test('should authenticate first if no access token', async () => {
      walletClient.accessToken = null;
      
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          accessToken: 'new_access_token',
          expiresIn: 3600
        }
      });
      
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          accessToken: 'new_app_token'
        }
      });

      const token = await walletClient.getApplicationToken();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/users/access_token', expect.any(Object));
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v2.6/applications/test-monzo-connector/access-token', expect.any(Object));
      expect(token).toBe('new_app_token');
    });

    test('should handle application token failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Application not found'));

      await expect(walletClient.getApplicationToken()).rejects.toThrow('Failed to get application token: Application not found');
    });
  });

  describe('Token Management', () => {
    test('should refresh tokens when expired', async () => {
      walletClient.tokenExpiry = Date.now() - 1000; // Expired
      
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          accessToken: 'refreshed_access_token',
          expiresIn: 3600
        }
      });
      
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          accessToken: 'refreshed_app_token'
        }
      });

      await walletClient.ensureValidToken();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/users/access_token', expect.any(Object));
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v2.6/applications/test-monzo-connector/access-token', expect.any(Object));
    });

    test('should not refresh valid tokens', async () => {
      walletClient.applicationToken = 'valid_app_token';
      walletClient.tokenExpiry = Date.now() + 3600000; // Valid for 1 hour

      await walletClient.ensureValidToken();

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });
  });

  describe('Data Storage', () => {
    beforeEach(() => {
      walletClient.applicationToken = 'test_app_token';
      walletClient.tokenExpiry = Date.now() + 3600000;
    });

    test('should store data successfully in production namespace', async () => {
      const testData = {
        accounts: [{ id: 'acc123', description: 'Test Account' }],
        balances: [{ accountId: 'acc123', balance: 1000 }]
      };

      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { id: 'record_123' }
      });

      const result = await walletClient.storeData('test', testData, {
        isTest: false,
        recordName: 'test-record'
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v2.6/data/monzo',
        expect.objectContaining({
          source: expect.objectContaining({
            name: 'monzo-data-connector',
            provider: 'monzo'
          }),
          metadata: expect.objectContaining({
            recordName: 'test-record',
            namespace: 'monzo',
            dataType: 'banking-data'
          }),
          data: expect.objectContaining({
            accounts: testData.accounts,
            balances: testData.balances
          })
        }),
        {
          headers: {
            'x-auth-token': 'test_app_token'
          }
        }
      );

      expect(result).toEqual({
        success: true,
        recordId: 'record_123',
        namespace: 'monzo',
        timestamp: expect.any(String),
        dataSize: expect.any(Number)
      });
    });

    test('should store data in test namespace when isTest=true', async () => {
      const testData = {
        accounts: [{ id: 'test_acc', description: 'Test Account' }]
      };

      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { id: 'test_record_123' }
      });

      const result = await walletClient.storeData('ignored', testData, {
        isTest: true,
        recordName: 'test-record'
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v2.6/data/test/monzo',
        expect.any(Object),
        expect.any(Object)
      );

      expect(result.namespace).toBe('test/monzo');
    });

    test('should handle storage failure gracefully', async () => {
      const testData = { accounts: [] };

      mockAxiosInstance.post.mockRejectedValue(new Error('Storage failed'));

      const result = await walletClient.storeData('test', testData);

      expect(result).toEqual({
        success: false,
        error: 'Storage failed',
        namespace: 'test',
        timestamp: expect.any(String)
      });
    });

    test('should prepare wallet data with proper metadata', () => {
      const rawData = {
        accounts: [{ id: 'acc1', description: 'Account 1' }],
        balances: [{ accountId: 'acc1', balance: 500 }],
        transactions: []
      };

      const walletData = walletClient.prepareWalletData(rawData, 'test/monzo', 'test-record');

      expect(walletData).toEqual({
        source: {
          name: 'monzo-data-connector',
          version: '1.0.0',
          provider: 'monzo',
          extractionTime: expect.any(String)
        },
        metadata: {
          recordName: 'test-record',
          namespace: 'test/monzo',
          contentType: 'application/json',
          dataType: 'banking-data',
          schema: 'raw-monzo-api-response',
          created: expect.any(String),
          updated: expect.any(String)
        },
        data: {
          accounts: rawData.accounts,
          balances: rawData.balances,
          transactions: rawData.transactions,
          connectionTest: null,
          extractionMeta: {
            accountCount: 1,
            balanceCount: 1,
            transactionCount: 0,
            extractedAt: expect.any(String),
            connector: 'monzo-data-connector'
          }
        }
      });
    });
  });

  describe('Specialized Storage Methods', () => {
    beforeEach(() => {
      walletClient.applicationToken = 'test_app_token';
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { id: 'record_123' }
      });
    });

    test('should store account data with correct record name', async () => {
      const accountData = { accounts: [{ id: 'acc1' }] };
      
      await walletClient.storeAccountData(accountData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v2.6/data/monzo',
        expect.objectContaining({
          metadata: expect.objectContaining({
            recordName: 'monzo-accounts'
          })
        }),
        expect.any(Object)
      );
    });

    test('should store balance data with correct record name', async () => {
      const balanceData = { balances: [{ accountId: 'acc1', balance: 100 }] };
      
      await walletClient.storeBalanceData(balanceData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v2.6/data/monzo',
        expect.objectContaining({
          metadata: expect.objectContaining({
            recordName: 'monzo-balances'
          })
        }),
        expect.any(Object)
      );
    });

    test('should store transaction data with correct record name', async () => {
      const transactionData = { transactions: [{ id: 'tx1', amount: 50 }] };
      
      await walletClient.storeTransactionData(transactionData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v2.6/data/monzo',
        expect.objectContaining({
          metadata: expect.objectContaining({
            recordName: 'monzo-transactions'
          })
        }),
        expect.any(Object)
      );
    });

    test('should store complete data with correct record name', async () => {
      const completeData = {
        accounts: [{ id: 'acc1' }],
        balances: [{ accountId: 'acc1', balance: 100 }],
        transactions: []
      };
      
      await walletClient.storeCompleteData(completeData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v2.6/data/monzo',
        expect.objectContaining({
          metadata: expect.objectContaining({
            recordName: 'monzo-complete-data'
          })
        }),
        expect.any(Object)
      );
    });
  });

  describe('Data Retrieval', () => {
    beforeEach(() => {
      walletClient.applicationToken = 'test_app_token';
    });

    test('should retrieve data successfully', async () => {
      const mockData = { accounts: [{ id: 'acc1' }] };
      
      mockAxiosInstance.get.mockResolvedValue({
        data: mockData
      });

      const result = await walletClient.getData('monzo', { isTest: false });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v2.6/data/monzo', {
        headers: {
          'x-auth-token': 'test_app_token'
        }
      });

      expect(result).toEqual({
        success: true,
        data: mockData,
        namespace: 'monzo'
      });
    });

    test('should retrieve test data with correct namespace', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { test: true }
      });

      const result = await walletClient.getData('monzo', { isTest: true });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v2.6/data/test/monzo', expect.any(Object));
      expect(result.namespace).toBe('test/monzo');
    });

    test('should handle retrieval failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));

      const result = await walletClient.getData('nonexistent');

      expect(result).toEqual({
        success: false,
        error: 'Not found',
        namespace: 'nonexistent'
      });
    });
  });

  describe('Connection Tests', () => {
    test('should test connection successfully', async () => {
      walletClient.applicationToken = 'test_app_token';
      
      mockAxiosInstance.post.mockResolvedValue({
        status: 200,
        data: { id: 'test_record' }
      });

      const result = await walletClient.testConnection();

      expect(result).toEqual({
        success: true,
        message: 'Wallet connection successful',
        details: expect.objectContaining({
          success: true,
          recordId: 'test_record',
          namespace: 'test/monzo'
        })
      });
    });

    test('should handle connection test failure', async () => {
      walletClient.applicationToken = 'test_app_token';
      
      mockAxiosInstance.post.mockRejectedValue(new Error('Connection failed'));

      const result = await walletClient.testConnection();

      expect(result).toEqual({
        success: false,
        message: 'Wallet connection failed',
        details: expect.objectContaining({
          success: false,
          error: 'Connection failed',
          namespace: 'test',
          timestamp: expect.any(String)
        })
      });
    });
  });

  describe('Health Check', () => {
    test('should return healthy status when API is available', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        status: 200
      });

      const health = await walletClient.healthCheck();

      expect(health).toEqual(
        expect.objectContaining({
          wallet: 'available',
          api: 'healthy',
          applicationId: 'test-monzo-connector',
          apiUrl: 'https://test.hubat.net'
        })
      );
    });

    test('should return unhealthy status when API is unavailable', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Service unavailable'));

      const health = await walletClient.healthCheck();

      expect(health).toEqual({
        wallet: 'unavailable',
        api: 'unhealthy',
        authentication: 'unknown',
        error: 'Service unavailable'
      });
    });

    test('should test authentication when credentials available', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ status: 200 }) // Status check
        .mockResolvedValueOnce({ data: { accessToken: 'app_token' } }); // App token
      
      mockAxiosInstance.post.mockResolvedValue({
        data: { accessToken: 'access_token', expiresIn: 3600 }
      });

      const health = await walletClient.healthCheck();

      expect(health.authentication).toBe('authenticated');
    });

    test('should indicate no credentials when none provided', async () => {
      const clientWithoutCreds = new WalletClient({
        username: null,
        password: null
      });
      
      mockAxiosInstance.get.mockResolvedValue({ status: 200 });

      const health = await clientWithoutCreds.healthCheck();

      expect(health.authentication).toBe('no_credentials');
    });
  });
});