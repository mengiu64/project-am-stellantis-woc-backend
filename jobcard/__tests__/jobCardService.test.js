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
jest.mock('fs');

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getJobCardList, getJobCardDetails } = require('../jobCardService');

describe('jobCardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
  });

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

  test('defaults pageSize to 50 when not provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.pageSize).toBe('50');
  });

  test('defaults pageSize to 50 when null', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219', pageSize: null });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.pageSize).toBe('50');
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

  test('sanitizes ";" separators in contactInfo.address', async () => {
    const body = {
      jobCardDetail: {
        customerInfo: [
          { contactInfo: { address: '13;poissy ;test' } },
        ],
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardDetails('token', '79');

    expect(result.jobCardDetail.customerInfo[0].contactInfo.address).toBe('13 poissy test');
  });

  test('leaves address untouched when it has no ";"', async () => {
    const body = {
      jobCardDetail: {
        customerInfo: [
          { contactInfo: { address: '78 VIA PO' } },
        ],
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardDetails('token', '79');

    expect(result.jobCardDetail.customerInfo[0].contactInfo.address).toBe('78 VIA PO');
  });

  test('does not fail when jobCardDetail or customerInfo is missing', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await expect(getJobCardDetails('token', '79')).resolves.toEqual({});
  });

  // ── /tmp persistence (readable later by djc lambda) ─────────────────────────

  test('saves the sanitized response body to /tmp/<jobCardId>.json', async () => {
    const body = { jobCardId: '79', jobCardDetail: { roInfo: { foo: 'bar' } } };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    await getJobCardDetails('token', '79');

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content, encoding] = fs.writeFileSync.mock.calls[0];
    expect(filePath).toBe('/tmp/79.json');
    expect(JSON.parse(content)).toEqual(body);
    expect(encoding).toBe('utf8');
  });

  test('uses the numeric jobCardId (converted to string) as the file name', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardDetails('token', 79);

    const [filePath] = fs.writeFileSync.mock.calls[0];
    expect(filePath).toBe('/tmp/79.json');
  });

  test('still returns the response even if writing to /tmp fails', async () => {
    const body = { jobCardId: '79' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    await expect(getJobCardDetails('token', '79')).resolves.toEqual(body);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile salvare jobCardDetails'));
  });

  test('does not write to /tmp when the request fails', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 404, headers: {}, body: { message: 'not found' } });

    await expect(getJobCardDetails('token', '99')).rejects.toThrow();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('does not write to /tmp when jobCardId is missing', async () => {
    await expect(getJobCardDetails('token', '')).rejects.toThrow();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('sends date range and other optional filters as headers when provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', {
      dealerId: '0062219',
      creationStartDate: '2024-01-01',
      creationEndDate: '2024-01-31',
      deliveryStartDate: '2024-02-01',
      deliveryEndDate: '2024-02-28',
      receptionStartDate: '2024-03-01',
      receptionEndDate: '2024-03-31',
      dmsRepairOrderId: 'DMS-001',
      customerName: 'Mario Rossi',
    });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.creationStartDate).toBe('2024-01-01');
    expect(options.headers.creationEndDate).toBe('2024-01-31');
    expect(options.headers.deliveryStartDate).toBe('2024-02-01');
    expect(options.headers.deliveryEndDate).toBe('2024-02-28');
    expect(options.headers.receptionStartDate).toBe('2024-03-01');
    expect(options.headers.receptionEndDate).toBe('2024-03-31');
    expect(options.headers.dmsRepairOrderId).toBe('DMS-001');
    expect(options.headers.customerName).toBe('Mario Rossi');
  });

  test('getJobCardList works without optional params (only dealerId)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { items: [] } });

    const result = await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.dealerId).toBe('0062219');
    expect(options.headers.vin).toBeUndefined();
    expect(result).toEqual({ items: [] });
  });
});
