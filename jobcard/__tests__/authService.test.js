'use strict';

jest.mock('fs');
jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    auth: {
      url: 'https://auth.test/as/token.oauth2',
      grantType: 'client_credentials',
      scope: 'prd:dgt',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
  }),
}));
jest.mock('../httpClient');

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');

describe('authService (jobcard)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('returns cached token when cache is valid', async () => {
    const futureExpiry = Date.now() + 3600 * 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        access_token: 'cached-jc-token',
        expires_at: futureExpiry,
        scope: 'prd:dgt',
        client_id: 'test-client-id',
      })
    );

    const token = await getBearerToken();
    expect(token).toBe('cached-jc-token');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('requests new token when cached token has a different scope', async () => {
    const futureExpiry = Date.now() + 3600 * 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        access_token: 'stale-wrong-scope-token',
        expires_at: futureExpiry,
        scope: 'prd:asv',
        client_id: 'test-client-id',
      })
    );
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'fresh-jc-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('fresh-jc-token');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  test('requests new token when cached token has no scope/client_id (legacy cache entry)', async () => {
    const futureExpiry = Date.now() + 3600 * 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ access_token: 'legacy-cached-token', expires_at: futureExpiry })
    );
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'fresh-jc-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('fresh-jc-token');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  test('requests new token when cache is missing', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'fresh-jc-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('fresh-jc-token');
  });

  test('requests new token when cached token is expired', async () => {
    const pastExpiry = Date.now() - 5000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ access_token: 'expired-token', expires_at: pastExpiry })
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

  test('writes new token to cache file', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'saved-token', expires_in: 1800 },
    });

    await getBearerToken();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(parsed.access_token).toBe('saved-token');
    expect(parsed.scope).toBe('prd:dgt');
    expect(parsed.client_id).toBe('test-client-id');
  });

  test('throws when HTTP status is not 200', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    httpsRequest.mockResolvedValue({ statusCode: 403, headers: {}, body: {} });

    await expect(getBearerToken()).rejects.toThrow('Token request failed');
  });

  test('throws when access_token is missing', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await expect(getBearerToken()).rejects.toThrow('No access_token in response');
  });

  test('uses client_credentials grant type in POST body', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'tok', expires_in: 3600 },
    });

    await getBearerToken();
    const [, body] = httpsRequest.mock.calls[0];
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=test-client-id');
  });
});
