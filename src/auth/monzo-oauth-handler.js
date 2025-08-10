const config = require('../config/environment');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Monzo OAuth 2.0 Handler
 * Follows data connector template authentication patterns
 */
class MonzoOAuthHandler {
  constructor() {
    this.clientId = config.monzo.clientId;
    this.clientSecret = config.monzo.clientSecret;
    this.redirectUrl = config.monzo.redirectUrl;
    this.baseUrl = config.monzo.baseUrl;
    this.tokenUrl = config.monzo.tokenUrl;
    this.scope = 'read';
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Missing required Monzo OAuth credentials');
    }
    
    logger.info('Monzo OAuth Handler initialized', {
      clientId: this.clientId?.substring(0, 20) + '...',
      redirectUrl: this.redirectUrl
    });
  }

  /**
   * Generate OAuth authorization URL with state parameter
   * @returns {Object} Authorization URL and state
   */
  generateAuthorizationUrl() {
    try {
      // Generate secure state parameter for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');
      
      const authUrl = new URL('https://auth.monzo.com/');
      authUrl.searchParams.append('client_id', this.clientId);
      authUrl.searchParams.append('redirect_uri', this.redirectUrl);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('state', state);
      authUrl.searchParams.append('scope', this.scope);
      authUrl.searchParams.append('intent', 'login');

      logger.info('Generated Monzo authorization URL', { state });

      return {
        authorizationUrl: authUrl.toString(),
        state: state
      };
    } catch (error) {
      logger.error('Failed to generate authorization URL', { error: error.message });
      throw error;
    }
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from Monzo
   * @param {string} state - State parameter for validation
   * @param {string} storedState - Stored state for comparison
   * @returns {Object} Token response
   */
  async exchangeCodeForToken(code, state, storedState) {
    try {
      // Validate required parameters
      if (!code) {
        throw new Error('Authorization code is required');
      }

      // Validate state parameter for CSRF protection
      if (state !== storedState) {
        throw new Error('State parameter mismatch - possible CSRF attack');
      }

      logger.info('Exchanging authorization code for access token');

      const tokenData = new URLSearchParams();
      tokenData.append('grant_type', 'authorization_code');
      tokenData.append('client_id', this.clientId);
      tokenData.append('client_secret', this.clientSecret);
      tokenData.append('redirect_uri', this.redirectUrl);
      tokenData.append('code', code);

      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MonzoDataConnector/1.0.0'
        },
        body: tokenData
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Token exchange failed', { 
          status: response.status, 
          statusText: response.statusText,
          error: errorText 
        });
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
      }

      const tokenResponse = await response.json();

      if (!tokenResponse.access_token) {
        logger.error('No access token in response', { response: tokenResponse });
        throw new Error('No access token received from Monzo');
      }

      logger.info('Successfully obtained access token', {
        tokenType: tokenResponse.token_type,
        expiresIn: tokenResponse.expires_in,
        hasRefreshToken: !!tokenResponse.refresh_token
      });

      return {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresIn: tokenResponse.expires_in,
        refreshToken: tokenResponse.refresh_token,
        scope: tokenResponse.scope
      };

    } catch (error) {
      logger.error('Failed to exchange code for token', { error: error.message });
      throw error;
    }
  }

  /**
   * Refresh an expired access token
   * @param {string} refreshToken - Refresh token
   * @returns {Object} New token response
   */
  async refreshAccessToken(refreshToken) {
    try {
      if (!refreshToken) {
        throw new Error('Refresh token is required');
      }

      logger.info('Refreshing access token');

      const tokenData = new URLSearchParams();
      tokenData.append('grant_type', 'refresh_token');
      tokenData.append('client_id', this.clientId);
      tokenData.append('client_secret', this.clientSecret);
      tokenData.append('refresh_token', refreshToken);

      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MonzoDataConnector/1.0.0'
        },
        body: tokenData
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Token refresh failed', { 
          status: response.status, 
          statusText: response.statusText,
          error: errorText 
        });
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }

      const tokenResponse = await response.json();

      if (!tokenResponse.access_token) {
        logger.error('No access token in refresh response', { response: tokenResponse });
        throw new Error('No access token received from token refresh');
      }

      logger.info('Successfully refreshed access token');

      return {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresIn: tokenResponse.expires_in,
        refreshToken: tokenResponse.refresh_token || refreshToken, // Keep old refresh token if new one not provided
        scope: tokenResponse.scope
      };

    } catch (error) {
      logger.error('Failed to refresh access token', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate an access token by making a test API call
   * @param {string} accessToken - Access token to validate
   * @returns {boolean} Token validity
   */
  async validateToken(accessToken) {
    try {
      if (!accessToken) {
        return false;
      }

      logger.info('Validating access token');

      const response = await fetch(`${this.baseUrl}/ping/whoami`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'MonzoDataConnector/1.0.0'
        }
      });

      const isValid = response.ok;
      
      logger.info('Token validation result', { 
        isValid,
        status: response.status 
      });

      return isValid;

    } catch (error) {
      logger.error('Token validation failed', { error: error.message });
      return false;
    }
  }
}

module.exports = MonzoOAuthHandler;