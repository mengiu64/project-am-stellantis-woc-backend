'use strict';

jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dmy',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
  dml: {
    baseUrl: 'https://api.dml.test',
    basePath: '/dms',
    ibmClientId: 'ibm-id',
    ibmClientSecret: 'ibm-secret',
    xTargetEnv: 'stage',
  },
}));
jest.mock('../httpClient');

const { httpsRequest } = require('../httpClient');
const { getDmsSettings } = require('../dmsService');

describe('dmsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('throws if country is missing', async () => {
    await expect(getDmsSettings('token', { brand: 'FT', dealer: '0062230' }))
      .rejects.toThrow('[dms] country is required');
  });

  test('throws if brand is missing', async () => {
    await expect(getDmsSettings('token', { country: 'fr', dealer: '0062230' }))
      .rejects.toThrow('[dms] brand is required');
  });

  test('throws if dealer is missing', async () => {
    await expect(getDmsSettings('token', { country: 'fr', brand: 'FT' }))
      .rejects.toThrow('[dms] dealer is required');
  });

  test('calls httpsRequest with correct method GET and Authorization header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { dmsData: true } });

    await getDmsSettings('my-token', { country: 'fr', brand: 'FT', dealer: '0062230' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer my-token');
    expect(options.headers['X-IBM-Client-Id']).toBe('ibm-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('ibm-secret');
    expect(options.headers['X-Target-Env']).toBe('stage');
  });

  test('includes country, brand, dealer in query string', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.path).toContain('country=fr');
    expect(options.path).toContain('brand=FT');
    expect(options.path).toContain('dealer=0062230');
  });

  test('returns response body on success', async () => {
    const expectedBody = { setting1: 'value1', setting2: 'value2' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' });
    expect(result).toEqual(expectedBody);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 403, headers: {}, body: { error: 'forbidden' } });

    await expect(getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' }))
      .rejects.toThrow('[dms] settings failed: HTTP 403');
  });

  test('calls settings endpoint on correct hostname', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.hostname).toBe('api.dml.test');
    expect(options.path).toContain('/dms/settings');
  });
});
