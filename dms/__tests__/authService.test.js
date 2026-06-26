'use strict';

jest.mock('fs');
jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dmy',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
}));
jest.mock('../httpClient');

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');

describe('authService (dms)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('returns cached token when cache file has a valid non-expired token', async () => {
    const futureExpiry = Date.now() + 3600 * 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ access_token: 'cached-token', expires_at: futureExpiry })
    );

    const token = await getBearerToken();
    expect(token).toBe('cached-token');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('requests new token when cache file does not exist', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});

    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'new-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('new-token');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  test('requests new token when cached token is expired', async () => {
    const pastExpiry = Date.now() - 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ access_token: 'old-token', expires_at: pastExpiry })
    );
    fs.writeFileSync.mockImplementation(() => {});

    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'refreshed-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('refreshed-token');
  });

  test('writes new token to cache file after successful request', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});

    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'new-token', expires_in: 3600 },
    });

    await getBearerToken();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [, written] = fs.writeFileSync.mock.calls[0];
    const parsed = JSON.parse(written);
    expect(parsed.access_token).toBe('new-token');
    expect(parsed.expires_at).toBeGreaterThan(Date.now());
  });

  test('throws when HTTP status is not 200', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    httpsRequest.mockResolvedValue({ statusCode: 401, headers: {}, body: { error: 'unauthorized' } });

    await expect(getBearerToken()).rejects.toThrow('Token request failed');
  });

  test('throws when access_token is missing from response', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await expect(getBearerToken()).rejects.toThrow('No access_token in response');
  });

  test('uses default expires_in of 3600 when not provided', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'token-no-expiry' },
    });

    const token = await getBearerToken();
    expect(token).toBe('token-no-expiry');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    const expectedExpiry = Date.now() + 3600 * 1000;
    expect(written.expires_at).toBeGreaterThanOrEqual(expectedExpiry - 1000);
    expect(written.expires_at).toBeLessThanOrEqual(expectedExpiry + 1000);
  });

  test('POSTs to correct auth endpoint with correct content-type', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
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
