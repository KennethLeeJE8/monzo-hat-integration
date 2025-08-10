const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Callback Client for CheckD Gateway Status Reporting
 * Handles sending status updates back to CheckD Gateway or other callback URLs
 */
class CallbackClient {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000; // 30 second timeout
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000; // 1 second base delay
    this.userAgent = options.userAgent || 'Monzo-Data-Connector/1.0';
    
    // Configure axios instance
    this.httpClient = axios.create({
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': this.userAgent
      },
      validateStatus: (status) => status < 500 // Retry on 5xx errors only
    });

    logger.info('Callback Client initialized', { 
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      userAgent: this.userAgent
    });
  }

  /**
   * Send status callback to CheckD Gateway or provided URL
   */
  async sendCallback(url, payload) {
    if (!url) {
      logger.warn('No callback URL provided, skipping callback');
      return { success: false, error: 'No callback URL provided' };
    }

    const callbackId = this.generateCallbackId();
    const startTime = Date.now();

    try {
      logger.info('Sending callback request', { 
        callbackId, 
        url: this.sanitizeUrl(url),
        requestId: payload.requestId,
        status: payload.status
      });

      const result = await this.sendWithRetry(url, payload, callbackId);
      
      logger.info('Callback request successful', { 
        callbackId,
        duration: Date.now() - startTime,
        statusCode: result.statusCode,
        attempt: result.attempt
      });

      return {
        success: true,
        callbackId,
        statusCode: result.statusCode,
        duration: Date.now() - startTime,
        attempts: result.attempt
      };

    } catch (error) {
      logger.error('Callback request failed after all retries', { 
        callbackId,
        url: this.sanitizeUrl(url),
        error: error.message,
        duration: Date.now() - startTime
      });

      return {
        success: false,
        callbackId,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Send status callback specifically for async requests
   */
  async sendStatusCallback(url, statusData) {
    const payload = {
      timestamp: new Date().toISOString(),
      connector: 'monzo-data-connector',
      version: '1.0.0',
      ...statusData
    };

    return await this.sendCallback(url, payload);
  }

  /**
   * Send success callback with data
   */
  async sendSuccessCallback(url, requestId, data, duration = null) {
    const payload = {
      requestId,
      status: 'completed',
      message: 'Data extraction completed successfully',
      data,
      duration,
      timestamp: new Date().toISOString()
    };

    return await this.sendStatusCallback(url, payload);
  }

  /**
   * Send failure callback with error details
   */
  async sendFailureCallback(url, requestId, error, duration = null) {
    const payload = {
      requestId,
      status: 'failed',
      message: `Data extraction failed: ${error}`,
      error,
      duration,
      timestamp: new Date().toISOString()
    };

    return await this.sendStatusCallback(url, payload);
  }

  /**
   * Send processing callback to indicate work has started
   */
  async sendProcessingCallback(url, requestId, message = 'Data extraction in progress') {
    const payload = {
      requestId,
      status: 'processing',
      message,
      timestamp: new Date().toISOString()
    };

    return await this.sendStatusCallback(url, payload);
  }

  /**
   * Send request with retry logic
   */
  async sendWithRetry(url, payload, callbackId) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug('Sending callback attempt', { callbackId, attempt, maxRetries: this.maxRetries });

        const response = await this.httpClient.post(url, payload);
        
        if (response.status >= 200 && response.status < 300) {
          logger.debug('Callback successful', { 
            callbackId, 
            attempt, 
            statusCode: response.status 
          });
          
          return {
            statusCode: response.status,
            attempt,
            data: response.data
          };
        } else if (response.status >= 400 && response.status < 500) {
          // Client errors (4xx) - don't retry
          throw new Error(`HTTP ${response.status}: ${response.statusText || 'Client error'}`);
        } else {
          // Server errors (5xx) - retry
          throw new Error(`HTTP ${response.status}: ${response.statusText || 'Server error'}`);
        }

      } catch (error) {
        lastError = error;
        
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          // Client errors - don't retry
          logger.warn('Callback failed with client error, not retrying', { 
            callbackId,
            attempt,
            status: error.response.status,
            error: error.message
          });
          throw error;
        }

        logger.warn('Callback attempt failed', { 
          callbackId,
          attempt,
          maxRetries: this.maxRetries,
          error: error.message
        });

        // Don't wait after the last attempt
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          logger.debug('Waiting before retry', { callbackId, delay, nextAttempt: attempt + 1 });
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    throw new Error(`All ${this.maxRetries} callback attempts failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Validate callback URL format and security
   */
  isValidCallbackUrl(url) {
    try {
      const parsedUrl = new URL(url);
      
      // Only allow HTTP/HTTPS
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
      }

      // Reject local/internal addresses for security
      const hostname = parsedUrl.hostname;
      if (this.isLocalAddress(hostname)) {
        logger.warn('Rejected local callback URL for security', { hostname });
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if hostname is a local/internal address
   */
  isLocalAddress(hostname) {
    // Local addresses that should be rejected for security
    const localPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^169\.254\./,
      /^0\./,
      /^::1$/,
      /^fc00::/,
      /^fe80::/
    ];

    return localPatterns.some(pattern => pattern.test(hostname));
  }

  /**
   * Utility methods
   */
  generateCallbackId() {
    return `cb_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  }

  sanitizeUrl(url) {
    // Return URL without sensitive query parameters for logging
    try {
      const parsedUrl = new URL(url);
      // Remove query parameters that might contain sensitive data
      const sensitiveParams = ['token', 'key', 'secret', 'auth', 'password'];
      
      sensitiveParams.forEach(param => {
        if (parsedUrl.searchParams.has(param)) {
          parsedUrl.searchParams.set(param, '***');
        }
      });

      return parsedUrl.toString();
    } catch (error) {
      return url.replace(/([?&](token|key|secret|auth|password)=)[^&]*/gi, '$1***');
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test connectivity to a callback URL
   */
  async testCallback(url) {
    const testPayload = {
      test: true,
      timestamp: new Date().toISOString(),
      connector: 'monzo-data-connector',
      message: 'Connectivity test'
    };

    try {
      const result = await this.sendCallback(url, testPayload);
      return {
        success: result.success,
        url: this.sanitizeUrl(url),
        duration: result.duration,
        statusCode: result.statusCode
      };
    } catch (error) {
      return {
        success: false,
        url: this.sanitizeUrl(url),
        error: error.message
      };
    }
  }
}

module.exports = CallbackClient;