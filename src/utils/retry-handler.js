const config = require('../config/environment');
const logger = require('./logger');

// Configurable retry logic following template
class RetryHandler {
  constructor(customConfig = {}) {
    this.maxAttempts = customConfig.maxAttempts || config.retry.maxAttempts;
    this.baseDelay = customConfig.baseDelay || config.retry.baseDelay;
    this.maxDelay = customConfig.maxDelay || config.retry.maxDelay;
    this.backoffMultiplier = customConfig.backoffMultiplier || config.retry.backoffMultiplier;
  }

  async withRetry(operation, context = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        logger.debug(`Retry attempt ${attempt}/${this.maxAttempts}`, context);
        return await operation();
      } catch (error) {
        lastError = error;
        
        logger.warn(`Attempt ${attempt} failed`, {
          error: error.message,
          retryable: error.retryable,
          attempt,
          maxAttempts: this.maxAttempts,
          ...context
        });
        
        // Don't retry if not retryable
        if (!this.isRetryable(error)) {
          logger.debug('Error not retryable, throwing immediately', {
            error: error.message,
            code: error.code
          });
          throw error;
        }
        
        // Don't retry on last attempt
        if (attempt === this.maxAttempts) {
          logger.error('Max retry attempts reached', {
            error: error.message,
            attempts: attempt,
            ...context
          });
          break;
        }
        
        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt, error);
        logger.debug(`Waiting ${delay}ms before retry`, { attempt, delay });
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  isRetryable(error) {
    // Check if error has explicit retryable flag
    if (error.retryable !== undefined) {
      return error.retryable;
    }

    // Default retryable status codes
    const retryableCodes = [429, 500, 502, 503, 504];
    return retryableCodes.includes(error.status) || retryableCodes.includes(error.statusCode);
  }

  calculateDelay(attempt, error) {
    // Use error-specific retry-after if available (in seconds)
    if (error.retryAfter) {
      return error.retryAfter * 1000;
    }
    
    // Check for Retry-After header (if error came from HTTP response)
    if (error.headers && error.headers['retry-after']) {
      const retryAfter = parseInt(error.headers['retry-after']);
      if (!isNaN(retryAfter)) {
        return retryAfter * 1000;
      }
    }
    
    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseDelay * Math.pow(this.backoffMultiplier, attempt - 1),
      this.maxDelay
    );
    
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(0, delay + jitter);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RetryHandler;