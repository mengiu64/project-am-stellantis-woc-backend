'use strict';

jest.mock('fs');
jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:asv',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
}));
jest.mock('../httpClient');

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');

describe('authService (v360)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('returns cached token when cache is valid', async () => {
    const futureExpiry = Date.now() + 3600 * 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ access_token: 'cached-v360-token', expires_at: futureExpiry })
    );

    const token = await getBearerToken();
    expect(token).toBe('cached-v360-token');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('requests new token when cache file does not exist', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'new-v360-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('new-v360-token');
  });

  test('requests new token when cached token is expired', async () => {
    const pastExpiry = Date.now() - 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ access_token: 'old-v360-token', expires_at: pastExpiry })
    );
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'refreshed-v360-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('refreshed-v360-token');
  });

  test('persists new token to cache file', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'stored-token', expires_in: 7200 },
    });

    await getBearerToken();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(parsed.access_token).toBe('stored-token');
    expect(parsed.expires_at).toBeGreaterThan(Date.now());
  });

  test('throws when HTTP status is not 200', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    httpsRequest.mockResolvedValue({ statusCode: 401, headers: {}, body: { error: 'invalid_client' } });

    await expect(getBearerToken()).rejects.toThrow('Token request failed');
  });

  test('throws when access_token is missing', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await expect(getBearerToken()).rejects.toThrow('No access_token in response');
  });

  test('POSTs correct scope in request body', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'tok', expires_in: 3600 },
    });

    await getBearerToken();
    const [, body] = httpsRequest.mock.calls[0];
    expect(body).toContain('scope=prd%3Aasv');
    expect(body).toContain('grant_type=client_credentials');
  });
});
