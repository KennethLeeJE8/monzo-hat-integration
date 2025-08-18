const crypto = require('crypto');

/**
 * Integrity utility for computing checksums of data
 * Provides a consistent checksum implementation for data validation
 */
class Integrity {
  /**
   * Compute checksum for data using SHA-256
   * @param {any} data - The data to compute checksum for
   * @param {string} algorithm - Hash algorithm to use (default: 'sha256')
   * @returns {string} - Hexadecimal checksum string
   */
  static compute_checksum(data, algorithm = 'sha256') {
    try {
      // Convert data to consistent string representation
      const dataString = typeof data === 'string' 
        ? data 
        : this._stringifyDeterministic(data);
      
      // Create hash
      const hash = crypto.createHash(algorithm);
      hash.update(dataString, 'utf8');
      
      return hash.digest('hex');
    } catch (error) {
      throw new Error(`Failed to compute checksum: ${error.message}`);
    }
  }

  /**
   * Convert object to deterministic string representation
   * @param {any} obj - Object to stringify
   * @returns {string} - Deterministic string representation
   */
  static _stringifyDeterministic(obj) {
    if (obj === null || obj === undefined) {
      return JSON.stringify(obj);
    }
    
    if (typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this._stringifyDeterministic(item)).join(',') + ']';
    }
    
    // Sort object keys for consistent hashing
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map(key => 
      JSON.stringify(key) + ':' + this._stringifyDeterministic(obj[key])
    );
    
    return '{' + pairs.join(',') + '}';
  }

  /**
   * Compute checksum with additional metadata
   * @param {any} data - The data to compute checksum for
   * @param {object} options - Additional options
   * @returns {object} - Checksum with metadata
   */
  static compute_checksum_with_metadata(data, options = {}) {
    const { algorithm = 'sha256', includeTimestamp = false } = options;
    
    const checksum = this.compute_checksum(data, algorithm);
    
    const result = {
      checksum,
      algorithm,
      computed_at: new Date().toISOString()
    };

    if (includeTimestamp) {
      result.data_timestamp = new Date().toISOString();
    }

    return result;
  }

  /**
   * Verify data against a known checksum
   * @param {any} data - The data to verify
   * @param {string} expectedChecksum - The expected checksum
   * @param {string} algorithm - Hash algorithm used (default: 'sha256')
   * @returns {boolean} - True if checksum matches
   */
  static verify_checksum(data, expectedChecksum, algorithm = 'sha256') {
    try {
      const computedChecksum = this.compute_checksum(data, algorithm);
      return computedChecksum === expectedChecksum;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get supported hash algorithms
   * @returns {string[]} - Array of supported algorithms
   */
  static get_supported_algorithms() {
    return crypto.getHashes();
  }
}

module.exports = Integrity;