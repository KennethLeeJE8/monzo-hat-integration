const WalletClient = require('../storage/wallet-client');
const Integrity = require('../utils/integrity');

describe('Wallet Client Payload Structure', () => {
  let walletClient;

  beforeEach(() => {
    walletClient = new WalletClient({
      apiUrl: 'https://test.example.com',
      username: 'test',
      password: 'test'
    });
  });

  test('should create payload with correct structure', () => {
    const rawData = {
      accounts: [
        { id: 'acc_123', description: 'Test Account', currency: 'GBP' }
      ],
      balances: [
        { balance: 1000, currency: 'GBP' }
      ],
      transactions: [
        { id: 'tx_123', amount: -500, description: 'Test Transaction' }
      ]
    };

    const inbox_message_id = 'msg_12345';
    const payload = walletClient.prepareWalletData(rawData, 'monzo', 'test-record', inbox_message_id);

    // Check top-level structure
    expect(payload).toHaveProperty('metadata');
    expect(payload).toHaveProperty('data');

    // Check metadata structure
    expect(payload.metadata).toHaveProperty('inbox_message_id', inbox_message_id);
    expect(payload.metadata).toHaveProperty('create_at');
    expect(payload.metadata).toHaveProperty('checksum');

    // Validate timestamp format (ISO 8601)
    expect(payload.metadata.create_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Validate checksum format (SHA-256 hex)
    expect(payload.metadata.checksum).toMatch(/^[a-f0-9]{64}$/);

    // Check data structure
    expect(payload.data).toHaveProperty('accounts');
    expect(payload.data).toHaveProperty('balances');
    expect(payload.data).toHaveProperty('transactions');
    expect(payload.data).toHaveProperty('extractionMeta');
  });

  test('should handle null inbox_message_id', () => {
    const rawData = { accounts: [], balances: [], transactions: [] };
    const payload = walletClient.prepareWalletData(rawData, 'monzo', 'test-record', null);

    expect(payload.metadata.inbox_message_id).toBeNull();
    expect(payload.metadata).toHaveProperty('create_at');
    expect(payload.metadata).toHaveProperty('checksum');
  });

  test('should compute correct checksum of data', () => {
    const rawData = {
      accounts: [{ id: 'acc_123', name: 'Test' }],
      balances: [{ balance: 1000 }]
    };

    const payload = walletClient.prepareWalletData(rawData, 'monzo', 'test-record');
    
    // Manually compute checksum of the data portion
    const expectedChecksum = Integrity.compute_checksum(payload.data);
    
    expect(payload.metadata.checksum).toBe(expectedChecksum);
  });

  test('should include extraction metadata', () => {
    const rawData = {
      accounts: [{ id: 'acc_1' }, { id: 'acc_2' }],
      balances: [{ balance: 1000 }, { balance: 2000 }],
      transactions: [{ id: 'tx_1' }]
    };

    const payload = walletClient.prepareWalletData(rawData, 'monzo', 'test-record');

    expect(payload.data.extractionMeta).toEqual({
      accountCount: 2,
      balanceCount: 2,
      transactionCount: 1,
      extractedAt: expect.any(String),
      connector: 'monzo-data-connector'
    });
  });

  test('should handle empty data gracefully', () => {
    const rawData = {};
    const payload = walletClient.prepareWalletData(rawData, 'monzo', 'test-record');

    expect(payload.data.accounts).toEqual([]);
    expect(payload.data.balances).toEqual([]);
    expect(payload.data.transactions).toEqual([]);
    expect(payload.data.extractionMeta.accountCount).toBe(0);
    expect(payload.metadata.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  test('should produce different checksums for different data', () => {
    const rawData1 = { accounts: [{ id: 'acc_1' }] };
    const rawData2 = { accounts: [{ id: 'acc_2' }] };

    // Mock the date to avoid timestamp differences affecting the test
    const mockDate = '2024-01-01T00:00:00.000Z';
    const originalNow = Date.prototype.toISOString;
    Date.prototype.toISOString = jest.fn(() => mockDate);

    const payload1 = walletClient.prepareWalletData(rawData1, 'monzo', 'test-record');
    const payload2 = walletClient.prepareWalletData(rawData2, 'monzo', 'test-record');

    // Restore original date function
    Date.prototype.toISOString = originalNow;

    expect(payload1.metadata.checksum).not.toBe(payload2.metadata.checksum);
  });

  test('should verify checksum integrity', () => {
    const rawData = {
      accounts: [{ id: 'acc_123', description: 'Test Account' }],
      balances: [{ balance: 1000 }]
    };

    const payload = walletClient.prepareWalletData(rawData, 'monzo', 'test-record');
    
    // Verify the checksum matches the data
    const isValid = Integrity.verify_checksum(payload.data, payload.metadata.checksum);
    expect(isValid).toBe(true);
  });
});