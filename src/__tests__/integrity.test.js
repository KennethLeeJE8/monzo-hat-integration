const Integrity = require('../utils/integrity');

describe('Integrity Checksum Implementation', () => {
  test('should compute consistent checksum for same data', () => {
    const data = { 
      accounts: [{ id: 'acc_123', name: 'Test Account' }],
      balances: [{ balance: 1000, currency: 'GBP' }]
    };

    const checksum1 = Integrity.compute_checksum(data);
    const checksum2 = Integrity.compute_checksum(data);

    expect(checksum1).toBe(checksum2);
    expect(checksum1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex string
  });

  test('should produce different checksums for different data', () => {
    const data1 = { accounts: [{ id: 'acc_123' }] };
    const data2 = { accounts: [{ id: 'acc_456' }] };

    const checksum1 = Integrity.compute_checksum(data1);
    const checksum2 = Integrity.compute_checksum(data2);

    expect(checksum1).not.toBe(checksum2);
  });

  test('should handle string data', () => {
    const stringData = 'test string data';
    const checksum = Integrity.compute_checksum(stringData);

    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof checksum).toBe('string');
  });

  test('should verify checksum correctly', () => {
    const data = { test: 'data', value: 123 };
    const checksum = Integrity.compute_checksum(data);

    expect(Integrity.verify_checksum(data, checksum)).toBe(true);
    expect(Integrity.verify_checksum(data, 'invalid_checksum')).toBe(false);
  });

  test('should compute checksum with metadata', () => {
    const data = { test: 'data' };
    const result = Integrity.compute_checksum_with_metadata(data);

    expect(result).toHaveProperty('checksum');
    expect(result).toHaveProperty('algorithm', 'sha256');
    expect(result).toHaveProperty('computed_at');
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  test('should handle empty objects consistently', () => {
    const emptyObj1 = {};
    const emptyObj2 = {};

    const checksum1 = Integrity.compute_checksum(emptyObj1);
    const checksum2 = Integrity.compute_checksum(emptyObj2);

    expect(checksum1).toBe(checksum2);
  });

  test('should sort object keys for consistent hashing', () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };

    const checksum1 = Integrity.compute_checksum(obj1);
    const checksum2 = Integrity.compute_checksum(obj2);

    expect(checksum1).toBe(checksum2);
  });
});