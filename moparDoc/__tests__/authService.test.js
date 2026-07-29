'use strict';

jest.mock('fs');
jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dgt',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
}));
jest.mock('../httpClient');

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');

describe('authService (moparDoc)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('returns cached token when cache is valid', async () => {
    const futureExpiry = Date.now() + 3600 * 1000;
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ access_token: 'cached-mopardoc-token', expires_at: futureExpiry })
    );

    const token = await getBearerToken();
    expect(token).toBe('cached-mopardoc-token');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('requests new token when cache is missing', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'fresh-mopardoc-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('fresh-mopardoc-token');
  });

  test('requests new token when cache is corrupted (invalid JSON)', async () => {
    fs.readFileSync.mockReturnValue('not-json');
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'recovered-token', expires_in: 3600 },
    });

    const token = await getBearerToken();
    expect(token).toBe('recovered-token');
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
  });

  test('defaults expires_in to 3600 when missing in response', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
    httpsRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { access_token: 'no-expiry-token' },
    });

    const token = await getBearerToken();
    expect(token).toBe('no-expiry-token');
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

  test('uses client_credentials grant type + scope prd:dgt in POST body', async () => {
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
    expect(body).toContain('scope=prd%3Adgt');
    expect(body).toContain('client_id=test-client-id');
  });
});
