const logger = require('./logger');

// Standard error codes and handling following template
const ERROR_CATEGORIES = {
  // Authentication errors
  AUTH_FAILURE: {
    code: 'OAUTH_FAILURE',
    status: 401,
    retryable: true,
    retryAfter: 60,
    message: 'Monzo authentication failed'
  },
  
  TOKEN_EXPIRED: {
    code: 'OAUTH_FAILURE', 
    status: 401,
    retryable: true,
    retryAfter: 0,
    message: 'Monzo access token expired'
  },

  // Data errors  
  DATA_NOT_FOUND: {
    code: 'EMAIL_NOT_FOUND',
    status: 404,
    retryable: false,
    message: 'Account not found in Monzo'
  },

  INVALID_DATA: {
    code: 'INVALID_DATA',
    status: 400, 
    retryable: false,
    message: 'Invalid or malformed data'
  },

  // API errors
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    status: 429,
    retryable: true,
    retryAfter: 600,
    message: 'Monzo API rate limit exceeded'
  },

  API_ERROR: {
    code: 'API_ERROR',
    status: 503,
    retryable: true,
    retryAfter: 60,
    message: 'Monzo API temporarily unavailable'
  },

  // Wallet errors
  WALLET_ERROR: {
    code: 'API_ERROR',
    status: 503,
    retryable: true,
    retryAfter: 30,
    message: 'Wallet storage failed'
  },

  // Gateway errors
  INVALID_TOKEN: {
    code: 'INVALID_TOKEN',
    status: 401,
    retryable: false,
    message: 'Invalid gateway token'
  }
};

class ErrorHandler {
  static createError(category, originalError = null, context = {}) {
    const errorConfig = ERROR_CATEGORIES[category];
    if (!errorConfig) {
      throw new Error(`Unknown error category: ${category}`);
    }

    const error = new Error(errorConfig.message);
    error.code = errorConfig.code;
    error.status = errorConfig.status;
    error.retryable = errorConfig.retryable;
    error.retryAfter = errorConfig.retryAfter;
    error.category = category;
    error.context = context;
    error.originalError = originalError;
    error.timestamp = new Date().toISOString();

    return error;
  }

  static mapErrorCode(error) {
    const errorMappings = {
      'DATA_NOT_FOUND': 'EMAIL_NOT_FOUND',
      'AUTH_FAILURE': 'OAUTH_FAILURE',
      'TOKEN_EXPIRED': 'OAUTH_FAILURE', 
      'RATE_LIMITED': 'RATE_LIMITED',
      'API_ERROR': 'API_ERROR',
      'WALLET_ERROR': 'API_ERROR',
      'INVALID_TOKEN': 'INVALID_TOKEN'
    };
    
    return errorMappings[error.category] || 'API_ERROR';
  }

  static notFound(req, res, next) {
    const error = ErrorHandler.createError('DATA_NOT_FOUND', null, {
      path: req.path,
      method: req.method
    });
    error.status = 404;
    error.message = `Route ${req.method} ${req.path} not found`;
    next(error);
  }

  static errorHandler(error, req, res, next) {
    // Log error details
    logger.error('Request error', {
      error: error.message,
      stack: error.stack,
      code: error.code,
      category: error.category,
      status: error.status,
      path: req.path,
      method: req.method,
      requestId: req.headers['x-request-id']
    });

    // Prepare error response
    const errorResponse = {
      status: 'error',
      code: error.code || 'API_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    };

    // Add retry information for retryable errors
    if (error.retryable && error.retryAfter) {
      errorResponse.retryAfter = error.retryAfter;
    }

    // Include additional context in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.category = error.category;
      errorResponse.stack = error.stack;
      errorResponse.context = error.context;
    }

    res.status(error.status || 500).json(errorResponse);
  }
}

module.exports = {
  ErrorHandler,
  ERROR_CATEGORIES,
  notFound: ErrorHandler.notFound,
  errorHandler: ErrorHandler.errorHandler
};