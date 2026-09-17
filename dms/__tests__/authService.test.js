'use strict';

const mockGetCacheItem = jest.fn();
const mockSetCacheItem = jest.fn();
jest.mock('../dynamoCache', () => ({
  getCacheItem: (...args) => mockGetCacheItem(...args),
  setCacheItem: (...args) => mockSetCacheItem(...args),
}));
jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    auth: {
      url: 'https://auth.test/as/token.oauth2',
      grantType: 'client_credentials',
      scope: 'prd:dmy',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
  }),
}));
jest.mock('../httpClient');

const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');

describe('authService (dms)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockSetCacheItem.mockImplementation((key, value) => Promise.resolve(value));
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('returns cached token when cache has a valid non-expired token', async () => {
    mockGetCacheItem.mockResolvedValue({
      access_token: 'cached-token',
      scope: 'prd:dmy',
      client_id: 'test-client-id',
    });

    const token = await getBearerToken();
    expect(token).toBe('cached-token');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('requests new token when cached token has a different scope', async () => {
    mockGetCacheItem.mockResolvedValue({
      access_token: 'stale-wrong-scope-token',
      scope: 'prd:other',
      client_id: 'test-client-id',
    });
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'new-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('new-token');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  test('requests new token when cached token has no scope/client_id (legacy cache entry)', async () => {
    mockGetCacheItem.mockResolvedValue({ access_token: 'legacy-cached-token' });
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'new-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('new-token');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  test('requests new token when cache is missing', async () => {
    mockGetCacheItem.mockResolvedValue(null);

    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'new-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('new-token');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  test('requests new token when cache item has no access_token', async () => {
    mockGetCacheItem.mockResolvedValue({});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'refreshed-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('refreshed-token');
  });

  test('writes new token to cache with scope/client_id and a ttl that accounts for the expiry buffer', async () => {
    mockGetCacheItem.mockResolvedValue(null);

    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'new-token', expires_in: 3600 },
    });

    await getBearerToken();
    expect(mockSetCacheItem).toHaveBeenCalledTimes(1);
    const [key, value, ttlSeconds] = mockSetCacheItem.mock.calls[0];
    expect(key).toBe('dms:authtoken');
    expect(value.access_token).toBe('new-token');
    expect(value.scope).toBe('prd:dmy');
    expect(value.client_id).toBe('test-client-id');
    expect(ttlSeconds).toBe(3600 - 30);
  });

  test('throws when HTTP status is not 200', async () => {
    mockGetCacheItem.mockResolvedValue(null);
    httpsRequest.mockResolvedValue({ statusCode: 401, headers: {}, body: { error: 'unauthorized' } });

    await expect(getBearerToken()).rejects.toThrow('Token request failed');
  });

  test('throws when access_token is missing from response', async () => {
    mockGetCacheItem.mockResolvedValue(null);
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await expect(getBearerToken()).rejects.toThrow('No access_token in response');
  });

  test('uses default expires_in of 3600 when not provided', async () => {
    mockGetCacheItem.mockResolvedValue(null);
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'token-no-expiry' },
    });

    const token = await getBearerToken();
    expect(token).toBe('token-no-expiry');
    const [, , ttlSeconds] = mockSetCacheItem.mock.calls[0];
    expect(ttlSeconds).toBe(3600 - 30);
  });

  test('POSTs to correct auth endpoint with correct content-type', async () => {
    mockGetCacheItem.mockResolvedValue(null);
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'tok', expires_in: 3600 },
    });

    await getBearerToken();
    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.hostname).toBe('auth.test');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
});
