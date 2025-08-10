const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Monzo Webhook Handler for CheckD Gateway Integration
 * Handles incoming webhook requests, validates JWT tokens, and processes data extraction requests
 */
class MonzoWebhookHandler {
  constructor(connector, walletClient, callbackClient) {
    this.connector = connector;
    this.walletClient = walletClient;
    this.callbackClient = callbackClient;
    this.pendingRequests = new Map(); // Store async request states
    logger.info('Monzo Webhook Handler initialized');
  }

  /**
   * Main webhook endpoint handler for CheckD Gateway
   * Processes connection requests with JWT validation
   */
  async handleConnectRequest(req, res) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    try {
      logger.info('Webhook connect request received', { requestId });

      // Extract and validate JWT token
      const token = this.extractJwtToken(req);
      if (!token) {
        return this.respondWithError(res, 'missing_token', 'Missing or invalid JWT token', 401);
      }

      // Validate JWT token
      const tokenData = await this.validateJwtToken(token);
      if (!tokenData) {
        return this.respondWithError(res, 'invalid_token', 'Invalid or expired JWT token', 401);
      }

      // Extract request data
      const { data: userIdentifier, callback_url, async: isAsync } = req.body;
      
      if (!userIdentifier) {
        return this.respondWithError(res, 'missing_data', 'Missing user identifier in request body', 400);
      }

      // Validate callback URL if provided
      if (callback_url && !this.isValidUrl(callback_url)) {
        return this.respondWithError(res, 'invalid_callback', 'Invalid callback URL format', 400);
      }

      logger.info('Webhook request validated', { 
        requestId, 
        userIdentifier: userIdentifier.substring(0, 10) + '...', 
        hasCallback: !!callback_url,
        isAsync: !!isAsync,
        tokenValid: true
      });

      // Handle asynchronous processing if requested
      if (isAsync) {
        return await this.handleAsyncRequest(req, res, requestId, tokenData, userIdentifier, callback_url);
      } else {
        return await this.handleSyncRequest(req, res, requestId, tokenData, userIdentifier);
      }

    } catch (error) {
      logger.error('Webhook request processing failed', { 
        requestId, 
        error: error.message,
        duration: Date.now() - startTime
      });
      
      return this.respondWithError(res, 'processing_error', 'Internal server error processing webhook', 500);
    }
  }

  /**
   * Handle synchronous webhook requests (immediate response)
   */
  async handleSyncRequest(req, res, requestId, tokenData, userIdentifier) {
    try {
      // For sync requests, we need existing access token from environment or cache
      const accessToken = process.env.MONZO_ACCESS_TOKEN || global.tempAccessToken;
      
      if (!accessToken) {
        return this.respondWithError(res, 'no_token', 'No Monzo access token available for immediate processing. Use async mode or provide token.', 400);
      }

      // Test connection first
      const connectionTest = await this.connector.testConnection(accessToken);
      if (!connectionTest.success) {
        return this.respondWithError(res, 'connection_failed', 'Unable to connect to Monzo API. Please check token validity.', 503);
      }

      // Extract account data
      const accountData = await this.connector.getCompleteAccountData(accessToken);
      
      // Store data in Dataswyft wallet
      let walletResult = null;
      try {
        walletResult = await this.walletClient.storeCompleteData(accountData, {
          isTest: false, // Production data goes to 'monzo' namespace
          recordName: `monzo-data-sync-${requestId}`
        });
        
        if (walletResult.success) {
          logger.info('Sync request: Data stored in wallet successfully', {
            requestId,
            recordId: walletResult.recordId,
            namespace: walletResult.namespace
          });
        } else {
          logger.warn('Sync request: Failed to store data in wallet', {
            requestId,
            error: walletResult.error
          });
        }
      } catch (walletError) {
        logger.error('Wallet storage error during sync processing', {
          requestId,
          error: walletError.message
        });
        walletResult = { success: false, error: walletError.message };
      }
      
      logger.info('Sync webhook request processed successfully', { 
        requestId,
        accountCount: accountData.accounts?.length || 0,
        hasBalances: (accountData.balances?.length || 0) > 0,
        walletStored: walletResult?.success || false
      });

      // Return immediate response with data
      return res.status(200).json({
        status: 'success',
        requestId,
        message: 'Data extraction and wallet storage completed successfully',
        data: {
          accounts: accountData.accounts || [],
          balances: accountData.balances || [],
          extractionTime: new Date().toISOString(),
          connectionTest
        },
        wallet: {
          stored: walletResult?.success || false,
          recordId: walletResult?.recordId || null,
          namespace: walletResult?.namespace || null,
          error: walletResult?.error || null
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Sync request processing failed', { requestId, error: error.message });
      return this.respondWithError(res, 'extraction_failed', `Data extraction failed: ${error.message}`, 500);
    }
  }

  /**
   * Handle asynchronous webhook requests (background processing)
   */
  async handleAsyncRequest(req, res, requestId, tokenData, userIdentifier, callbackUrl) {
    try {
      // Store request state for background processing
      this.pendingRequests.set(requestId, {
        tokenData,
        userIdentifier,
        callbackUrl,
        status: 'pending',
        createdAt: new Date().toISOString(),
        startTime: Date.now()
      });

      // Return immediate acknowledgment
      const response = {
        status: 'accepted',
        requestId,
        message: 'Request accepted for asynchronous processing',
        processing: {
          status: 'pending',
          estimatedDuration: '30-60 seconds',
          callbackUrl: callbackUrl || 'none'
        },
        timestamp: new Date().toISOString()
      };

      res.status(202).json(response);

      // Start background processing (non-blocking)
      setImmediate(() => this.processAsyncRequest(requestId));

      return;

    } catch (error) {
      logger.error('Async request setup failed', { requestId, error: error.message });
      return this.respondWithError(res, 'async_setup_failed', `Failed to setup async processing: ${error.message}`, 500);
    }
  }

  /**
   * Background processing for async requests
   */
  async processAsyncRequest(requestId) {
    const requestData = this.pendingRequests.get(requestId);
    
    if (!requestData) {
      logger.error('Async request data not found', { requestId });
      return;
    }

    try {
      logger.info('Starting async request processing', { requestId });
      
      // Update status
      requestData.status = 'processing';
      this.pendingRequests.set(requestId, requestData);

      // Send processing callback if URL provided
      if (requestData.callbackUrl) {
        await this.callbackClient.sendStatusCallback(requestData.callbackUrl, {
          requestId,
          status: 'processing',
          message: 'Data extraction in progress'
        });
      }

      // For async processing, we also need an access token
      const accessToken = process.env.MONZO_ACCESS_TOKEN || global.tempAccessToken;
      
      if (!accessToken) {
        throw new Error('No Monzo access token available for processing');
      }

      // Test connection
      const connectionTest = await this.connector.testConnection(accessToken);
      if (!connectionTest.success) {
        throw new Error('Unable to connect to Monzo API');
      }

      // Extract account data with retry logic
      const accountData = await this.connector.getCompleteAccountData(accessToken);

      // Store data in Dataswyft wallet
      let walletResult = null;
      try {
        walletResult = await this.walletClient.storeCompleteData(accountData, {
          isTest: false, // Production data goes to 'monzo' namespace
          recordName: `monzo-data-${requestId}`
        });
        
        if (walletResult.success) {
          logger.info('Data stored in wallet successfully', {
            requestId,
            recordId: walletResult.recordId,
            namespace: walletResult.namespace
          });
        } else {
          logger.warn('Failed to store data in wallet', {
            requestId,
            error: walletResult.error
          });
        }
      } catch (walletError) {
        logger.error('Wallet storage error during async processing', {
          requestId,
          error: walletError.message
        });
        walletResult = { success: false, error: walletError.message };
      }

      // Mark as completed
      requestData.status = 'completed';
      requestData.completedAt = new Date().toISOString();
      requestData.duration = Date.now() - requestData.startTime;
      requestData.result = accountData;
      requestData.walletResult = walletResult;
      this.pendingRequests.set(requestId, requestData);

      logger.info('Async request processing completed', { 
        requestId,
        duration: requestData.duration,
        accountCount: accountData.accounts?.length || 0,
        walletStored: walletResult?.success || false
      });

      // Send completion callback
      if (requestData.callbackUrl) {
        await this.callbackClient.sendStatusCallback(requestData.callbackUrl, {
          requestId,
          status: 'completed',
          message: 'Data extraction and wallet storage completed successfully',
          data: {
            accounts: accountData.accounts || [],
            balances: accountData.balances || [],
            extractionTime: requestData.completedAt,
            duration: requestData.duration
          },
          wallet: {
            stored: walletResult?.success || false,
            recordId: walletResult?.recordId || null,
            namespace: walletResult?.namespace || null,
            error: walletResult?.error || null
          }
        });
      }

      // Clean up after some time (5 minutes)
      setTimeout(() => {
        this.pendingRequests.delete(requestId);
        logger.debug('Async request data cleaned up', { requestId });
      }, 5 * 60 * 1000);

    } catch (error) {
      logger.error('Async request processing failed', { requestId, error: error.message });
      
      // Mark as failed
      requestData.status = 'failed';
      requestData.completedAt = new Date().toISOString();
      requestData.duration = Date.now() - requestData.startTime;
      requestData.error = error.message;
      this.pendingRequests.set(requestId, requestData);

      // Send failure callback
      if (requestData.callbackUrl) {
        try {
          await this.callbackClient.sendStatusCallback(requestData.callbackUrl, {
            requestId,
            status: 'failed',
            message: `Data extraction failed: ${error.message}`,
            error: error.message
          });
        } catch (callbackError) {
          logger.error('Failed to send error callback', { requestId, error: callbackError.message });
        }
      }
    }
  }

  /**
   * Get status of an async request
   */
  getRequestStatus(requestId) {
    const requestData = this.pendingRequests.get(requestId);
    if (!requestData) {
      return null;
    }

    return {
      requestId,
      status: requestData.status,
      createdAt: requestData.createdAt,
      completedAt: requestData.completedAt || null,
      duration: requestData.duration || (Date.now() - requestData.startTime),
      hasCallback: !!requestData.callbackUrl,
      result: requestData.status === 'completed' ? requestData.result : null,
      error: requestData.error || null
    };
  }

  /**
   * Extract JWT token from request headers or body
   */
  extractJwtToken(req) {
    // Check Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check request body token field
    if (req.body && req.body.token) {
      return req.body.token;
    }

    // Check X-Auth-Token header
    if (req.headers['x-auth-token']) {
      return req.headers['x-auth-token'];
    }

    return null;
  }

  /**
   * Validate JWT token
   * In production, this should validate against CheckD Gateway's public key
   */
  async validateJwtToken(token) {
    try {
      // For development, we'll do basic JWT structure validation
      // In production, replace with actual CheckD Gateway key validation
      
      if (!token || typeof token !== 'string') {
        return null;
      }

      // Basic JWT format check (three parts separated by dots)
      const parts = token.split('.');
      if (parts.length !== 3) {
        logger.warn('Invalid JWT token format');
        return null;
      }

      // For now, we'll accept any properly formatted JWT
      // TODO: Replace with actual signature validation using CheckD's public key
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      // Basic payload validation
      if (!payload.sub || !payload.iat) {
        logger.warn('JWT missing required claims');
        return null;
      }

      // Check expiration if present
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        logger.warn('JWT token expired');
        return null;
      }

      logger.debug('JWT token validated', { sub: payload.sub, iat: payload.iat });
      return payload;

    } catch (error) {
      logger.warn('JWT validation failed', { error: error.message });
      return null;
    }
  }

  /**
   * Utility methods
   */
  generateRequestId() {
    return `monzo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  respondWithError(res, errorCode, message, statusCode = 400) {
    const response = {
      status: 'error',
      error: {
        code: errorCode,
        message
      },
      timestamp: new Date().toISOString()
    };
    
    logger.warn('Webhook request error', { errorCode, message, statusCode });
    return res.status(statusCode).json(response);
  }
}

module.exports = MonzoWebhookHandler;