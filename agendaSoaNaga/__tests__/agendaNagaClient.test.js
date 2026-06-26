'use strict';

jest.mock('axios');

const axios = require('axios');
const AgendaNagaClient = require('../src/agendaNagaClient');

describe('AgendaNagaClient', () => {
  let mockHttp;
  let client;

  beforeEach(() => {
    mockHttp = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    axios.create.mockReturnValue(mockHttp);

    client = new AgendaNagaClient({
      host: 'http://test-host',
      username: 'testuser',
      password: 'testpass',
      apiKey: 'test-api-key',
    });
  });

  afterEach(() => jest.clearAllMocks());

  // ── constructor ──────────────────────────────────────────────────────────────

  test('creates axios instance with correct baseURL and timeout', () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://test-host', timeout: 30000 })
    );
  });

  test('falls back to env vars when config not provided', () => {
    process.env.AGENDA_SOA_HOST = 'http://env-host';
    process.env.AGENDA_SOA_USERNAME = 'env-user';
    const c = new AgendaNagaClient({});
    expect(c.host).toBe('http://env-host');
    expect(c.username).toBe('env-user');
    delete process.env.AGENDA_SOA_HOST;
    delete process.env.AGENDA_SOA_USERNAME;
  });

  // ── _basicAuthHeader ─────────────────────────────────────────────────────────

  test('_basicAuthHeader returns correct Basic auth header', () => {
    const header = client._basicAuthHeader();
    const expected = Buffer.from('testuser:testpass').toString('base64');
    expect(header.Authorization).toBe(`Basic ${expected}`);
  });

  // ── _processResponse ─────────────────────────────────────────────────────────

  test('_processResponse returns success=true for 200', () => {
    const result = client._processResponse({ status: 200, data: { id: 'appt1' } });
    expect(result).toEqual({ success: true, data: { id: 'appt1' } });
  });

  test('_processResponse returns success=true for 201', () => {
    expect(client._processResponse({ status: 201, data: {} }).success).toBe(true);
  });

  test('_processResponse returns success=false for 400', () => {
    const result = client._processResponse({ status: 400, data: { message: 'bad request' } });
    expect(result.success).toBe(false);
    expect(result.data).toContain('400');
  });

  test('_processResponse returns success=false for 503', () => {
    const result = client._processResponse({ status: 503, data: {} });
    expect(result.success).toBe(false);
    expect(result.data).toContain('GENERIC');
  });

  // ── createnaga ───────────────────────────────────────────────────────────────

  test('createnaga calls POST with correct path and body', async () => {
    mockHttp.post.mockResolvedValue({ status: 200, data: { apptId: 'new-appt' } });
    const payload = { vin: 'VIN123', date: '2024-01-01' };
    const result = await client.createnaga(payload);
    expect(mockHttp.post).toHaveBeenCalledWith(
      'appointmentrest/rdvs/v1/createnaga',
      payload,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ apptId: 'new-appt' });
  });

  test('createnaga returns success=false on HTTP error', async () => {
    mockHttp.post.mockResolvedValue({ status: 500, data: { message: 'server error' } });
    const result = await client.createnaga({});
    expect(result.success).toBe(false);
  });

  // ── updatenaga ───────────────────────────────────────────────────────────────

  test('updatenaga calls POST with apptId in the URL path', async () => {
    mockHttp.post.mockResolvedValue({ status: 200, data: { updated: true } });
    await client.updatenaga({ vin: 'VIN1' }, 'appt-99');
    expect(mockHttp.post).toHaveBeenCalledWith(
      'appointmentrest/rdvs/v1/updatenaga/appt-99',
      expect.any(Object),
      expect.any(Object)
    );
  });

  test('updatenaga appends authUser (base64 user:pass) to body', async () => {
    mockHttp.post.mockResolvedValue({ status: 200, data: {} });
    const payload = { vin: 'VIN1', date: '2024-01-01' };
    await client.updatenaga(payload, 'appt-99');
    const sentBody = mockHttp.post.mock.calls[0][1];
    const expectedAuth = Buffer.from('testuser:testpass').toString('base64');
    expect(sentBody).toMatchObject({ ...payload, authUser: expectedAuth });
  });

  test('updatenaga returns success=false on HTTP error', async () => {
    mockHttp.post.mockResolvedValue({ status: 409, data: { message: 'conflict' } });
    const result = await client.updatenaga({}, 'appt-1');
    expect(result.success).toBe(false);
  });
});
