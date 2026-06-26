'use strict';

jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dgt',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
  dgt: {
    baseUrl: 'https://api.dgt.test',
    basePath: '/ps-stage/extra/srp/digital-layer/v1',
    clientId: 'dgt-client-id',
    clientSecret: 'dgt-client-secret',
  },
}));
jest.mock('../httpClient');

const { httpsRequest } = require('../httpClient');
const { getJobCardList, getJobCardDetails } = require('../jobCardService');

describe('jobCardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  // ── getJobCardList ───────────────────────────────────────────────────────────

  test('throws if dealerId is missing', async () => {
    await expect(getJobCardList('token', {})).rejects.toThrow('[jobCard] dealerId is required');
  });

  test('calls httpsRequest with correct path and method', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { items: [] } });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(options.path).toContain('/jobCardList');
    expect(options.hostname).toBe('api.dgt.test');
  });

  test('sends dealerId in headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.dealerId).toBe('0062219');
  });

  test('includes IBM client credentials in headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('bearer-token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['X-IBM-Client-Id']).toBe('dgt-client-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('dgt-client-secret');
    expect(options.headers.Authorization).toBe('Bearer bearer-token');
  });

  test('sends optional filters as headers when provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', {
      dealerId: '0062219',
      vin: 'VIN123',
      licensePlate: 'AB123',
      page: 2,
      pageSize: 10,
      sortBy: 'creationDate',
      sortOrder: 'desc',
    });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.vin).toBe('VIN123');
    expect(options.headers.licensePlate).toBe('AB123');
    expect(options.headers.page).toBe('2');
    expect(options.headers.pageSize).toBe('10');
    expect(options.headers.sortBy).toBe('creationDate');
    expect(options.headers.sortOrder).toBe('desc');
  });

  test('returns response body on success', async () => {
    const body = { total: 5, items: [{ jobCardId: '1' }] };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardList('token', { dealerId: '0062219' });
    expect(result).toEqual(body);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: { error: 'server error' } });

    await expect(getJobCardList('token', { dealerId: '0062219' }))
      .rejects.toThrow('[jobCard] jobCardList failed: HTTP 500');
  });

  test('includes x-trace-id header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['x-trace-id']).toBeDefined();
    expect(typeof options.headers['x-trace-id']).toBe('string');
  });

  // ── getJobCardDetails ────────────────────────────────────────────────────────

  test('throws if jobCardId is missing', async () => {
    await expect(getJobCardDetails('token', '')).rejects.toThrow('[jobCard] jobCardId is required');
    await expect(getJobCardDetails('token', null)).rejects.toThrow('[jobCard] jobCardId is required');
    await expect(getJobCardDetails('token', undefined)).rejects.toThrow('[jobCard] jobCardId is required');
  });

  test('calls httpsRequest with correct path including jobCardId in header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardId: '79' } });

    await getJobCardDetails('token', '79');

    const [options] = httpsRequest.mock.calls[0];
    expect(options.path).toContain('/jobCardDetails');
    expect(options.headers.jobCardId).toBe('79');
  });

  test('returns response body on success', async () => {
    const body = { jobCardId: '79', status: 'open' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardDetails('token', '79');
    expect(result).toEqual(body);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 404, headers: {}, body: { message: 'not found' } });

    await expect(getJobCardDetails('token', '99'))
      .rejects.toThrow('[jobCard] jobCardDetails failed: HTTP 404');
  });

  test('converts numeric jobCardId to string', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardDetails('token', 79);

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.jobCardId).toBe('79');
  });
});
