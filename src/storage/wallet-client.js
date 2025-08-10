const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Dataswyft Wallet Client for storing banking data
 * Handles authentication and data insertion with proper metadata
 */
class WalletClient {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || process.env.DATASWIFT_API_URL || 'https://kennethleeje8wka.hubat.net';
    this.username = options.username || process.env.DATASWIFT_USERNAME || 'kennethleeje8wka';
    this.password = options.password || process.env.DATASWIFT_PASSWORD || 'burger-wine-cheese';
    this.applicationId = options.applicationId || process.env.DS_APPLICATION_ID || 'oi-s-monzodataconnector';
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    
    // Token storage
    this.accessToken = null;
    this.applicationToken = null;
    this.tokenExpiry = null;
    
    // Configure HTTP client
    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add response interceptor for token refresh (proper data connector pattern)
    this.httpClient.interceptors.response.use(
      response => response,
      async error => {
        if (error.response?.status === 401 && !error.config._retry) {
          error.config._retry = true;
          // Refresh both access and application tokens
          await this.refreshTokens();
          error.config.headers['x-auth-token'] = this.applicationToken;
          return this.httpClient.request(error.config);
        }
        return Promise.reject(error);
      }
    );

    logger.info('Dataswyft Wallet Client initialized', { 
      apiUrl: this.apiUrl,
      applicationId: this.applicationId,
      hasCredentials: !!(this.username && this.password)
    });
  }

  /**
   * Authenticate with Dataswyft and get access token
   */
  async authenticate() {
    try {
      logger.info('Authenticating with Dataswyft wallet');

      const response = await this.httpClient.get('/users/access_token', {
        headers: {
          'Accept': 'application/json',
          'username': this.username,
          'password': this.password
        }
      });

      // Handle both text and JSON responses
      let accessToken;
      if (typeof response.data === 'string') {
        accessToken = response.data.trim();
      } else if (response.data?.accessToken) {
        accessToken = response.data.accessToken;
      } else {
        throw new Error('No access token received from authentication');
      }

      this.accessToken = accessToken;
      this.tokenExpiry = Date.now() + (3600 * 1000); // Default 1 hour expiry
      
      logger.info('Dataswyft authentication successful', { 
        tokenLength: accessToken.length,
        tokenPrefix: accessToken.substring(0, 20) + '...'
      });
      return this.accessToken;

    } catch (error) {
      logger.error('Dataswyft authentication failed', { 
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: `${this.apiUrl}/users/access_token`,
        username: this.username,
        hasPassword: !!this.password
      });
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Get application token using access token
   */
  async getApplicationToken() {
    try {
      if (!this.accessToken) {
        await this.authenticate();
      }

      logger.info('Getting application token', { applicationId: this.applicationId });

      const response = await this.httpClient.get(`/api/v2.6/applications/${this.applicationId}/access-token`, {
        headers: {
          'x-auth-token': this.accessToken
        }
      });

      if (!response.data?.accessToken) {
        throw new Error('No application token received');
      }

      this.applicationToken = response.data.accessToken;
      
      logger.info('Application token obtained successfully');
      return this.applicationToken;

    } catch (error) {
      logger.error('Failed to get application token', { 
        error: error.message,
        status: error.response?.status,
        applicationId: this.applicationId
      });
      throw new Error(`Failed to get application token: ${error.message}`);
    }
  }

  /**
   * Refresh both access and application tokens
   */
  async refreshTokens() {
    logger.info('Refreshing Dataswyft tokens');
    this.accessToken = null;
    this.applicationToken = null;
    await this.authenticate();
    await this.getApplicationToken();
  }

  /**
   * Ensure valid application token is available
   */
  async ensureValidToken() {
    if (!this.applicationToken) {
      await this.getApplicationToken();
    } else if (this.tokenExpiry && Date.now() > this.tokenExpiry) {
      logger.info('Token expired, refreshing');
      await this.refreshTokens();
    }
  }

  /**
   * Store Monzo data in Dataswyft wallet with proper metadata
   */
  async storeData(namespace, dataPath, data, options = {}) {
    const { isTest = false, recordName = 'monzo-banking-data' } = options;
    
    // Determine namespace: test/monzo/accounts for tests, monzo/accounts for production
    const finalNamespace = isTest ? `test/${namespace}` : namespace;
    const finalPath = dataPath;

    try {
      // Get application token for data operations (proper data connector pattern)
      if (!this.applicationToken) {
        await this.getApplicationToken();
      }

      logger.info('Storing data in Dataswyft wallet', { 
        namespace: finalNamespace,
        path: finalPath,
        recordName,
        dataType: typeof data,
        accountCount: data.accounts?.length || 0
      });

      // Prepare data with metadata (or use raw data for testing)
      const walletData = isTest ? data : this.prepareWalletData(data, finalNamespace, recordName);
      
      // Store data using application token (correct data connector pattern)
      const response = await this.httpClient.post(`/api/v2.6/data/${finalNamespace}/${finalPath}`, walletData, {
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': this.applicationToken
        }
      });

      logger.info('Data stored successfully in wallet', { 
        namespace: finalNamespace,
        path: finalPath,
        recordId: response.data?.id,
        statusCode: response.status
      });

      return {
        success: true,
        recordId: response.data?.id,
        namespace: finalNamespace,
        path: finalPath,
        timestamp: new Date().toISOString(),
        dataSize: JSON.stringify(walletData).length
      };

    } catch (error) {
      logger.error('Failed to store data in wallet', { 
        error: error.message,
        status: error.response?.status,
        namespace: finalNamespace,
        data: error.response?.data
      });

      // Handle duplicate data as partial success for testing
      const isDuplicateData = error.response?.data?.cause?.includes('Duplicate data') || 
                             error.response?.data?.message?.includes('Duplicate data');

      return {
        success: isDuplicateData, // Consider duplicate data as success for testing
        error: error.message,
        isDuplicate: isDuplicateData,
        namespace: finalNamespace,
        path: finalPath,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Prepare data for wallet storage with proper metadata
   */
  prepareWalletData(rawData, namespace, recordName) {
    const timestamp = new Date().toISOString();
    
    return {
      // Data source metadata
      source: {
        name: 'monzo-data-connector',
        version: '1.0.0',
        provider: 'monzo',
        extractionTime: timestamp
      },
      
      // Record metadata
      metadata: {
        recordName,
        namespace,
        contentType: 'application/json',
        dataType: 'banking-data',
        schema: 'raw-monzo-api-response',
        created: timestamp,
        updated: timestamp
      },

      // Raw Monzo data
      data: {
        accounts: rawData.accounts || [],
        balances: rawData.balances || [],
        transactions: rawData.transactions || [],
        connectionTest: rawData.connectionTest || null,
        extractionMeta: {
          accountCount: rawData.accounts?.length || 0,
          balanceCount: rawData.balances?.length || 0,
          transactionCount: rawData.transactions?.length || 0,
          extractedAt: timestamp,
          connector: 'monzo-data-connector'
        }
      }
    };
  }

  /**
   * Store account data specifically
   */
  async storeAccountData(accountData, options = {}) {
    return await this.storeData('monzo', 'accounts', accountData, {
      ...options,
      recordName: 'monzo-accounts'
    });
  }

  /**
   * Store balance data specifically  
   */
  async storeBalanceData(balanceData, options = {}) {
    return await this.storeData('monzo', 'balances', balanceData, {
      ...options,
      recordName: 'monzo-balances'
    });
  }

  /**
   * Store transaction data specifically
   */
  async storeTransactionData(transactionData, options = {}) {
    return await this.storeData('monzo', 'transactions', transactionData, {
      ...options,
      recordName: 'monzo-transactions'
    });
  }

  /**
   * Store complete banking dataset
   */
  async storeCompleteData(completeData, options = {}) {
    return await this.storeData('monzo', 'complete', completeData, {
      ...options,
      recordName: 'monzo-complete-data'
    });
  }

  /**
   * Test wallet connectivity
   */
  async testConnection() {
    try {
      if (!this.accessToken) {
        await this.authenticate();
      }
      
      // Test with a minimal data write to test namespace (matches your pattern)
      const testData = {
        "something": "Normal JSON",
        "data": {
          "nested": "no problem",
          "value": true,
          "id": Math.floor(Math.random() * 1000), // Random ID to avoid duplicates
          "test_timestamp": new Date().toISOString(),
          "connector": "monzo-data-connector"
        }
      };

      const result = await this.storeData('monzo', 'testconnection', testData, {
        isTest: true,
        recordName: 'connectivity-test'
      });

      return {
        success: result.success,
        message: result.success ? 'Wallet connection successful' : 'Wallet connection failed',
        details: result
      };

    } catch (error) {
      logger.error('Wallet connection test failed', { error: error.message });
      return {
        success: false,
        message: 'Wallet connection test failed',
        error: error.message
      };
    }
  }

  /**
   * Get stored data from wallet (for verification)
   */
  async getData(namespace, options = {}) {
    try {
      if (!this.applicationToken) {
        await this.getApplicationToken();
      }

      const { isTest = false } = options;
      const finalNamespace = isTest ? `test/${namespace}` : namespace;

      logger.info('Retrieving data from wallet', { namespace: finalNamespace });

      const response = await this.httpClient.get(`/api/v2.6/data/${finalNamespace}`, {
        headers: {
          'x-auth-token': this.applicationToken
        }
      });

      return {
        success: true,
        data: response.data,
        namespace: finalNamespace
      };

    } catch (error) {
      logger.error('Failed to retrieve data from wallet', { 
        error: error.message,
        namespace
      });
      
      return {
        success: false,
        error: error.message,
        namespace
      };
    }
  }

  /**
   * Health check for wallet service
   */
  async healthCheck() {
    try {
      // Basic API availability check
      const response = await this.httpClient.get('/api/v2.6/system/status', {
        timeout: 5000
      });

      const hasCredentials = !!(this.username && this.password);
      let authStatus = 'not_tested';
      
      if (hasCredentials) {
        try {
          if (!this.applicationToken) {
            await this.getApplicationToken();
          }
          authStatus = 'authenticated';
        } catch (error) {
          authStatus = 'failed';
        }
      } else {
        authStatus = 'no_credentials';
      }

      return {
        wallet: 'available',
        api: response.status === 200 ? 'healthy' : 'unhealthy',
        authentication: authStatus,
        applicationId: this.applicationId,
        apiUrl: this.apiUrl
      };

    } catch (error) {
      return {
        wallet: 'unavailable',
        api: 'unhealthy',
        authentication: 'unknown',
        error: error.message
      };
    }
  }
}

module.exports = WalletClient;