'use strict';

jest.mock('../config', () => ({
  dgt: {
    baseUrl: 'https://api.dgt.test',
    basePath: '/ps-stage/extra/srp/digital-layer/v1',
    clientId: 'dgt-client-id',
    clientSecret: 'dgt-client-secret',
  },
}));
jest.mock('../httpClient');

const { httpsRequest } = require('../httpClient');
const { saveJobCard } = require('../jobCardService');

describe('jobCardService (djc)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('throws if payload is missing', async () => {
    await expect(saveJobCard('token', undefined)).rejects.toThrow('[djc] payload is required');
    await expect(saveJobCard('token', null)).rejects.toThrow('[djc] payload is required');
  });

  test('throws if payload is not an object', async () => {
    await expect(saveJobCard('token', 'not-an-object')).rejects.toThrow('[djc] payload is required');
  });

  test('calls httpsRequest with POST method and /jobCard path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { success: true } });

    await saveJobCard('token', { roInfo: { jobCardSrpId: 'JCID-1' } });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.path).toContain('/jobCard');
    expect(options.hostname).toBe('api.dgt.test');
  });

  test('sends the JSON-serialized payload with Content-Type/Content-Length headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const payload = { roInfo: { jobCardSrpId: 'JCID-1' } };
    await saveJobCard('token', payload);

    const [options, body] = httpsRequest.mock.calls[0];
    expect(JSON.parse(body)).toEqual(payload);
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['Content-Length']).toBe(Buffer.byteLength(JSON.stringify(payload)));
  });

  test('includes IBM client credentials and Authorization header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await saveJobCard('bearer-token', { roInfo: {} });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['X-IBM-Client-Id']).toBe('dgt-client-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('dgt-client-secret');
    expect(options.headers.Authorization).toBe('Bearer bearer-token');
  });

  test('includes x-trace-id header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await saveJobCard('token', { roInfo: {} });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['x-trace-id']).toBeDefined();
    expect(typeof options.headers['x-trace-id']).toBe('string');
  });

  test('returns response body on 200 success', async () => {
    const body = { success: true, jobCardId: '79' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await saveJobCard('token', { roInfo: {} });
    expect(result).toEqual(body);
  });

  test('returns response body on 201 success', async () => {
    const body = { success: true, jobCardId: '79' };
    httpsRequest.mockResolvedValue({ statusCode: 201, headers: {}, body });

    const result = await saveJobCard('token', { roInfo: {} });
    expect(result).toEqual(body);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: { error: 'server error' } });

    await expect(saveJobCard('token', { roInfo: {} }))
      .rejects.toThrow('[djc] jobCard failed: HTTP 500');
  });
});
