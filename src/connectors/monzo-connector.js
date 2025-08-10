const config = require('../config/environment');
const logger = require('../utils/logger');
const MonzoOAuthHandler = require('../auth/monzo-oauth-handler');

/**
 * Monzo API Connector
 * Handles data extraction from Monzo Banking API
 */
class MonzoConnector {
  constructor() {
    this.baseUrl = config.monzo.baseUrl;
    this.oauthHandler = new MonzoOAuthHandler();
    this.rateLimitDelay = 1000 / config.monzo.rateLimitPerSecond; // Convert to milliseconds between requests
    this.timeout = config.monzo.timeout;
    
    logger.info('Monzo Connector initialized', {
      baseUrl: this.baseUrl,
      rateLimitDelay: this.rateLimitDelay
    });
  }

  /**
   * Make authenticated API request to Monzo
   * @param {string} endpoint - API endpoint
   * @param {string} accessToken - Access token
   * @param {Object} options - Request options
   * @returns {Object} API response
   */
  async makeApiRequest(endpoint, accessToken, options = {}) {
    try {
      if (!accessToken) {
        throw new Error('Access token is required');
      }

      const url = `${this.baseUrl}${endpoint}`;
      logger.info('Making Monzo API request', { endpoint, url });

      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'MonzoDataConnector/1.0.0',
          ...options.headers
        },
        body: options.body,
        timeout: this.timeout
      });

      logger.info('API response received', { 
        status: response.status, 
        statusText: response.statusText,
        endpoint 
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('API request failed', { 
          endpoint,
          status: response.status, 
          statusText: response.statusText,
          error: errorText 
        });

        // Handle specific error cases
        if (response.status === 401) {
          throw new Error('Unauthorized - token may be expired or invalid');
        } else if (response.status === 403) {
          throw new Error('Forbidden - insufficient permissions. Check mobile app approval.');
        } else if (response.status === 429) {
          throw new Error('Rate limit exceeded - too many requests');
        }

        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      logger.info('API request successful', { endpoint, dataKeys: Object.keys(data) });

      return data;

    } catch (error) {
      logger.error('API request error', { endpoint, error: error.message });
      throw error;
    }
  }

  /**
   * Get user's Monzo accounts
   * @param {string} accessToken - Access token
   * @returns {Array} Array of account objects
   */
  async getAccounts(accessToken) {
    try {
      logger.info('Fetching Monzo accounts');
      
      const data = await this.makeApiRequest('/accounts', accessToken);
      
      if (!data.accounts) {
        logger.warn('No accounts found in response', { data });
        return [];
      }

      logger.info('Successfully retrieved accounts', { 
        accountCount: data.accounts.length 
      });

      return data.accounts;

    } catch (error) {
      logger.error('Failed to get accounts', { error: error.message });
      throw error;
    }
  }

  /**
   * Get account balance
   * @param {string} accountId - Account ID
   * @param {string} accessToken - Access token
   * @returns {Object} Balance information
   */
  async getAccountBalance(accountId, accessToken) {
    try {
      logger.info('Fetching account balance', { accountId });

      const data = await this.makeApiRequest(`/balance?account_id=${accountId}`, accessToken);
      
      logger.info('Successfully retrieved balance', { 
        accountId, 
        balance: data.balance,
        currency: data.currency 
      });

      return data;

    } catch (error) {
      logger.error('Failed to get account balance', { accountId, error: error.message });
      throw error;
    }
  }

  /**
   * Get transactions for an account
   * @param {string} accountId - Account ID
   * @param {string} accessToken - Access token
   * @param {Object} options - Query options (since, before, limit)
   * @returns {Array} Array of transaction objects
   */
  async getTransactions(accountId, accessToken, options = {}) {
    try {
      logger.info('Fetching transactions', { accountId, options });

      const queryParams = new URLSearchParams();
      queryParams.append('account_id', accountId);
      
      if (options.since) queryParams.append('since', options.since);
      if (options.before) queryParams.append('before', options.before);
      if (options.limit) queryParams.append('limit', options.limit.toString());

      const endpoint = `/transactions?${queryParams.toString()}`;
      const data = await this.makeApiRequest(endpoint, accessToken);

      if (!data.transactions) {
        logger.warn('No transactions found in response', { data });
        return [];
      }

      logger.info('Successfully retrieved transactions', { 
        accountId,
        transactionCount: data.transactions.length 
      });

      return data.transactions;

    } catch (error) {
      logger.error('Failed to get transactions', { accountId, error: error.message });
      throw error;
    }
  }

  /**
   * Get comprehensive account data (accounts + balances + recent transactions)
   * @param {string} accessToken - Access token
   * @param {Object} options - Options for transaction retrieval
   * @returns {Object} Complete account data
   */
  async getCompleteAccountData(accessToken, options = {}) {
    try {
      logger.info('Fetching complete account data');

      // Get all accounts
      const accounts = await this.getAccounts(accessToken);
      
      if (accounts.length === 0) {
        logger.warn('No accounts found for user');
        return { accounts: [], balances: [], transactions: [] };
      }

      const completeData = {
        accounts: [],
        balances: [],
        transactions: []
      };

      // Process each account
      for (const account of accounts) {
        logger.info('Processing account', { 
          accountId: account.id, 
          description: account.description 
        });

        // Add account data
        completeData.accounts.push(account);

        try {
          // Get balance for this account
          const balance = await this.getAccountBalance(account.id, accessToken);
          completeData.balances.push({
            accountId: account.id,
            ...balance
          });

          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));

          // Get recent transactions for this account
          const transactions = await this.getTransactions(account.id, accessToken, {
            limit: options.transactionLimit || 50
          });
          
          completeData.transactions.push({
            accountId: account.id,
            transactions: transactions
          });

          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));

        } catch (accountError) {
          logger.error('Failed to get data for account', { 
            accountId: account.id, 
            error: accountError.message 
          });
          // Continue with other accounts even if one fails
        }
      }

      logger.info('Complete account data retrieved', {
        accountCount: completeData.accounts.length,
        balanceCount: completeData.balances.length,
        transactionAccounts: completeData.transactions.length
      });

      return completeData;

    } catch (error) {
      logger.error('Failed to get complete account data', { error: error.message });
      throw error;
    }
  }

  /**
   * Test connectivity to Monzo API
   * @param {string} accessToken - Access token
   * @returns {Object} Test results
   */
  async testConnection(accessToken) {
    try {
      logger.info('Testing Monzo API connection');

      // Test basic connectivity with whoami endpoint
      const whoamiData = await this.makeApiRequest('/ping/whoami', accessToken);
      
      // Test accounts endpoint
      const accounts = await this.getAccounts(accessToken);

      const testResult = {
        success: true,
        whoami: whoamiData,
        accountCount: accounts.length,
        timestamp: new Date().toISOString()
      };

      logger.info('Monzo API connection test successful', testResult);
      return testResult;

    } catch (error) {
      const testResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };

      logger.error('Monzo API connection test failed', testResult);
      return testResult;
    }
  }
}

module.exports = MonzoConnector;