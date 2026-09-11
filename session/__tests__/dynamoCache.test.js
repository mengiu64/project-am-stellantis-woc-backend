'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((input) => ({ __type: 'GetCommand', input })),
  PutCommand: jest.fn((input) => ({ __type: 'PutCommand', input })),
}));

const { getCacheItem, setCacheItem } = require('../src/dynamoCache');

describe('dynamoCache', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env = { ...ORIGINAL_ENV, DYNAMO_CACHE_TABLE_NAME: 'test-tmp-cache' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('getCacheItem', () => {
    it('returns null when DYNAMO_CACHE_TABLE_NAME is not configured', async () => {
      delete process.env.DYNAMO_CACHE_TABLE_NAME;
      expect(await getCacheItem('some-key')).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns null when no item is found', async () => {
      mockSend.mockResolvedValue({});
      expect(await getCacheItem('some-key')).toBeNull();
    });

    it('returns the cached value when the item is present and not expired', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      mockSend.mockResolvedValue({ Item: { cacheKey: 'some-key', value: { foo: 'bar' }, expiresAt: futureExpiry } });

      expect(await getCacheItem('some-key')).toEqual({ foo: 'bar' });
    });

    it('returns null when the item is present but already expired (TTL not yet purged by DynamoDB)', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 10;
      mockSend.mockResolvedValue({ Item: { cacheKey: 'some-key', value: { foo: 'bar' }, expiresAt: pastExpiry } });

      expect(await getCacheItem('some-key')).toBeNull();
    });

    it('returns null and logs a warning when the query fails', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB unreachable'));

      expect(await getCacheItem('some-key')).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile leggere "some-key"'));
    });
  });

  describe('setCacheItem', () => {
    it('is a no-op (returns value) when DYNAMO_CACHE_TABLE_NAME is not configured', async () => {
      delete process.env.DYNAMO_CACHE_TABLE_NAME;
      expect(await setCacheItem('some-key', { foo: 'bar' }, 60)).toEqual({ foo: 'bar' });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('writes the item with an expiresAt attribute and returns the value', async () => {
      mockSend.mockResolvedValue({});

      const result = await setCacheItem('some-key', { foo: 'bar' }, 60);

      expect(result).toEqual({ foo: 'bar' });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const [command] = mockSend.mock.calls[0];
      expect(command.input.TableName).toBe('test-tmp-cache');
      expect(command.input.Item.cacheKey).toBe('some-key');
      expect(command.input.Item.value).toEqual({ foo: 'bar' });
      expect(command.input.Item.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('still returns the value (best-effort) and logs a warning when the write fails', async () => {
      mockSend.mockRejectedValue(new Error('disk full'));

      const result = await setCacheItem('some-key', { foo: 'bar' }, 60);

      expect(result).toEqual({ foo: 'bar' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile scrivere "some-key"'));
    });
  });
});
