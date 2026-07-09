'use strict';

jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:asv',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
  asv: {
    baseUrl: 'https://api.v360.test',
    basePath: '/ps-prod/extra/asv360/vehicle/v1',
    clientId: 'asv-client-id',
    clientSecret: 'asv-client-secret',
  },
  getDetailsDefaults: {
    countryCode: 'FR',
    languageCode: 'fr',
    clientId: 'a8bf933a532cc85570a68d9bec7f44c4',
    offering: 'Vehicle Description,campaign',
  },
}));
jest.mock('../httpClient');

const { httpsRequest } = require('../httpClient');
const { otaCompatibility, getDetails } = require('../v360Service');

describe('v360Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  // ── otaCompatibility ─────────────────────────────────────────────────────────

  test('throws if vin is missing for otaCompatibility', async () => {
    await expect(otaCompatibility('token', {})).rejects.toThrow('[v360] vin is required for otaCompatibility');
  });

  test('calls httpsRequest with POST method and correct path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { compatible: true } });

    await otaCompatibility('token', { vin: 'VIN123' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.path).toContain('/otaCompatibility');
    expect(options.hostname).toBe('api.v360.test');
  });

  test('sends vin in request body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN123' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.vin).toBe('VIN123');
  });

  test('includes optional params in request body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN123', includeOtaHistoryData: 'true', locale: 'fr_FR' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.includeOtaHistoryData).toBe('true');
    expect(body.locale).toBe('fr_FR');
  });

  test('does not include undefined optional params in body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN123' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body).not.toHaveProperty('includeOtaHistoryData');
    expect(body).not.toHaveProperty('locale');
  });

  test('includes IBM client credentials in headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('my-bearer-token', { vin: 'VIN1' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['X-IBM-Client-Id']).toBe('asv-client-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('asv-client-secret');
    expect(options.headers.Authorization).toBe('Bearer my-bearer-token');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  test('returns response body on success', async () => {
    const expectedBody = { vin: 'VIN123', compatible: true, otaHistory: [] };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await otaCompatibility('token', { vin: 'VIN123' });
    expect(result).toEqual(expectedBody);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 422, headers: {}, body: { error: 'invalid vin' } });

    await expect(otaCompatibility('token', { vin: 'BADVIN' }))
      .rejects.toThrow('[v360] otaCompatibility failed: HTTP 422');
  });

  test('includes x-trace-id header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN1' });

    const [options] = httpsRequest.mock.calls[0];
    expect(typeof options.headers['x-trace-id']).toBe('string');
    expect(options.headers['x-trace-id'].length).toBeGreaterThan(0);
  });

  // ── getDetails ───────────────────────────────────────────────────────────────

  test('throws if vin is missing for getDetails', async () => {
    await expect(getDetails('token', {})).rejects.toThrow('[v360] vin is required for getdetails');
  });

  test('calls httpsRequest with POST method and correct path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', { vin: 'VIN456' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.path).toContain('/getdetails');
  });

  test('defaults searchType to "vin" when not provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', { vin: 'VIN456' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.searchType).toBe('vin');
    expect(body.vin).toBe('VIN456');
  });

  test('includes optional params in request body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', {
      vin: 'VIN456',
      countryCode: 'FR',
      clientId: 'client1',
      offering: 'Vehicle Description,campaign',
      languageCode: 'fr',
    });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.countryCode).toBe('FR');
    expect(body.clientId).toBe('client1');
    expect(body.offering).toBe('Vehicle Description,campaign');
    expect(body.languageCode).toBe('fr');
  });

  test('falls back to config defaults when optional params are not provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', { vin: 'VIN456' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.countryCode).toBe('FR');
    expect(body.clientId).toBe('a8bf933a532cc85570a68d9bec7f44c4');
    expect(body.offering).toBe('Vehicle Description,campaign');
    expect(body.languageCode).toBe('fr');
  });

  test('returns response body on success', async () => {
    const expectedBody = { vin: 'VIN456', details: { model: 'Peugeot 3008' } };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });
    expect(result).toEqual(expectedBody);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: { error: 'server error' } });

    await expect(getDetails('token', { vin: 'VIN456' }))
      .rejects.toThrow('[v360] getdetails failed: HTTP 500');
  });
});
