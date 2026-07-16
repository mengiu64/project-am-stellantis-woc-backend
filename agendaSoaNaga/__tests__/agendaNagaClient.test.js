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

  test('does not set httpsAgent on axios config when not provided', () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ httpsAgent: expect.anything() })
    );
  });

  test('passes httpsAgent to axios.create when provided', () => {
    const fakeAgent = { fake: true };
    // eslint-disable-next-line no-unused-vars
    const c = new AgendaNagaClient({ host: 'http://test-host', httpsAgent: fakeAgent });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ httpsAgent: fakeAgent })
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

  // ── _post validateStatus ──────────────────────────────────────────────────────

  test('_post passes validateStatus that always returns true', async () => {
    let capturedOpts;
    mockHttp.post.mockImplementation((_url, _body, opts) => {
      capturedOpts = opts;
      return Promise.resolve({ status: 200, data: {} });
    });
    await client._post('/test', {});
    expect(capturedOpts.validateStatus()).toBe(true);
    expect(capturedOpts.validateStatus(500)).toBe(true);
  });

  // ── interceptors ─────────────────────────────────────────────────────────────

  test('request interceptor passes request through unchanged', () => {
    const [callback] = mockHttp.interceptors.request.use.mock.calls[0];
    const req = { method: 'GET', url: '/test', headers: {} };
    expect(callback(req)).toBe(req);
  });

  test('response interceptor success callback passes response through', () => {
    const [successCb] = mockHttp.interceptors.response.use.mock.calls[0];
    const res = { status: 200, data: {} };
    expect(successCb(res)).toBe(res);
  });

  test('response interceptor error callback rejects with the error', async () => {
    const [, errorCb] = mockHttp.interceptors.response.use.mock.calls[0];
    await expect(errorCb(new Error('network failure'))).rejects.toThrow('network failure');
  });

  describe('interceptors: request/response logging redaction', () => {
    let logSpy;

    beforeEach(() => {
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => logSpy.mockRestore());

    test('request interceptor masks sensitive headers and truncates long string body', () => {
      const [callback] = mockHttp.interceptors.request.use.mock.calls[0];
      const longBody = 'x'.repeat(5000);
      const req = {
        method: 'post',
        baseURL: 'http://test-host',
        url: '/endpoint',
        headers: { Authorization: 'Basic xxx', 'Content-Type': 'application/json' },
        params: { foo: 'bar' },
        data: longBody,
      };

      callback(req);

      const log = JSON.parse(logSpy.mock.calls[0][0]);
      expect(log.headers.Authorization).toBe('***REDACTED***');
      expect(log.headers['Content-Type']).toBe('application/json');
      expect(log.body.endsWith('...[truncated]')).toBe(true);
      expect(req.metadata.startedAt).toEqual(expect.any(Number));
    });

    test('request interceptor masks sensitive fields (including authUser) in object/array body', () => {
      const [callback] = mockHttp.interceptors.request.use.mock.calls[0];
      const req = {
        method: 'post',
        url: '/endpoint',
        headers: {},
        data: {
          authUser: 'dXNlcjpwYXNz',
          list: [{ password: 'p1' }, { name: 'ok' }],
          foo: 'bar',
        },
      };

      callback(req);

      const log = JSON.parse(logSpy.mock.calls[0][0]);
      expect(log.body.authUser).toBe('***REDACTED***');
      expect(log.body.list[0].password).toBe('***REDACTED***');
      expect(log.body.list[1].name).toBe('ok');
      expect(log.body.foo).toBe('bar');
    });

    test('response interceptor logs redacted body and computes durationMs from metadata', () => {
      const [successCb] = mockHttp.interceptors.response.use.mock.calls[0];
      const res = {
        status: 200,
        config: {
          method: 'post',
          baseURL: 'http://test-host',
          url: '/endpoint',
          metadata: { startedAt: Date.now() - 10 },
        },
        headers: {},
        data: { accessToken: 'secret-value', foo: 'bar' },
      };

      successCb(res);

      const log = JSON.parse(logSpy.mock.calls[0][0]);
      expect(log.body.accessToken).toBe('***REDACTED***');
      expect(log.body.foo).toBe('bar');
      expect(log.durationMs).toEqual(expect.any(Number));
    });

    test('response interceptor logs primitive body without throwing when metadata missing', () => {
      const [successCb] = mockHttp.interceptors.response.use.mock.calls[0];
      const res = { status: 204, data: 'plain text', headers: {} };

      successCb(res);

      const log = JSON.parse(logSpy.mock.calls[0][0]);
      expect(log.body).toBe('plain text');
      expect(log.durationMs).toBeUndefined();
    });

    test('error interceptor logs redacted response data when available', async () => {
      const [, errorCb] = mockHttp.interceptors.response.use.mock.calls[0];
      const err = {
        message: 'Request failed',
        config: { method: 'post', baseURL: 'http://test-host', url: '/endpoint' },
        response: { status: 500, data: { secret: 'abc' } },
      };

      await expect(errorCb(err)).rejects.toBe(err);

      const log = JSON.parse(logSpy.mock.calls[0][0]);
      expect(log.body.secret).toBe('***REDACTED***');
      expect(log.statusCode).toBe(500);
    });

    test('error interceptor handles missing config and response gracefully', async () => {
      const [, errorCb] = mockHttp.interceptors.response.use.mock.calls[0];
      const err = { message: 'Unknown error' };

      await expect(errorCb(err)).rejects.toBe(err);

      const log = JSON.parse(logSpy.mock.calls[0][0]);
      expect(log.url).toBeUndefined();
      expect(log.statusCode).toBeUndefined();
    });
  });
});
