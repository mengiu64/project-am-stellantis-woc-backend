'use strict';

jest.mock('https');

const https = require('https');
const { httpsRequest } = require('../httpClient');

describe('httpsRequest (jobcard)', () => {
  afterEach(() => jest.clearAllMocks());

  function buildMockRes(statusCode, chunks) {
    return {
      statusCode,
      headers: {},
      on: jest.fn((event, cb) => {
        if (event === 'data') chunks.forEach((c) => cb(c));
        if (event === 'end') cb();
      }),
    };
  }

  test('resolves with parsed JSON body and statusCode', async () => {
    const data = JSON.stringify({ jobCards: [] });
    const mockRes = buildMockRes(200, [Buffer.from(data)]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'test', path: '/jobCardList', method: 'GET' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ jobCards: [] });
  });

  test('resolves with raw string for non-JSON body', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('not json')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({});
    expect(result.body).toBe('not json');
  });

  test('writes body when provided', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ method: 'POST' }, 'body-content');
    expect(mockReq.write).toHaveBeenCalledWith('body-content');
  });

  test('does not write body when body is null', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({}, null);
    expect(mockReq.write).not.toHaveBeenCalled();
  });

  test('rejects on request error', async () => {
    let errorCb;
    const mockReq = {
      on: jest.fn((event, cb) => { if (event === 'error') errorCb = cb; }),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation(() => mockReq);

    const promise = httpsRequest({});
    errorCb(new Error('ECONNREFUSED'));
    await expect(promise).rejects.toThrow('ECONNREFUSED');
  });

  test('calls req.end() after setup', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({});
    expect(mockReq.end).toHaveBeenCalled();
  });

  // ── logging: redazione dati sensibili ────────────────────────────────────────

  describe('request/response logging redaction', () => {
    let logSpy;

    beforeEach(() => {
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => logSpy.mockRestore());

    function parsedLogs() {
      return logSpy.mock.calls.map(([arg]) => JSON.parse(arg));
    }

    test('masks sensitive headers and nested body fields (object/array) in logs', async () => {
      const mockRes = buildMockRes(200, [Buffer.from(JSON.stringify({
        access_token: 'super-secret-token',
        list: [{ password: 'p1' }, { name: 'ok' }],
        nested: { clientSecret: 'abc', safe: 'value' },
      }))]);
      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

      await httpsRequest({
        hostname: 'test',
        path: '/secure',
        method: 'POST',
        headers: { Authorization: 'Bearer xyz', 'Content-Type': 'application/json' },
      }, JSON.stringify({ client_secret: 'req-secret', foo: 'bar' }));

      const [reqLog, resLog] = parsedLogs();
      expect(reqLog.headers.Authorization).toBe('***REDACTED***');
      expect(reqLog.headers['Content-Type']).toBe('application/json');
      expect(reqLog.body.client_secret).toBe('***REDACTED***');
      expect(reqLog.body.foo).toBe('bar');

      expect(resLog.body.access_token).toBe('***REDACTED***');
      expect(resLog.body.list[0].password).toBe('***REDACTED***');
      expect(resLog.body.list[1].name).toBe('ok');
      expect(resLog.body.nested.clientSecret).toBe('***REDACTED***');
      expect(resLog.body.nested.safe).toBe('value');
    });

    test('masks sensitive params and truncates long non-JSON string bodies', async () => {
      const longBody = 'x'.repeat(5000);
      const mockRes = buildMockRes(200, [Buffer.from(longBody)]);
      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

      await httpsRequest(
        { hostname: 'test', path: '/token', method: 'POST' },
        'grant_type=client_credentials&client_secret=req-secret&foo=bar'
      );

      const [reqLog, resLog] = parsedLogs();
      expect(reqLog.body).toContain('client_secret=***REDACTED***');
      expect(reqLog.body).not.toContain('req-secret');
      expect(resLog.body.endsWith('...[truncated]')).toBe(true);
      expect(resLog.body.length).toBeLessThan(longBody.length);
    });

    test('logs primitive (boolean/number) response bodies without throwing', async () => {
      const mockRes = buildMockRes(200, [Buffer.from('true')]);
      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

      const result = await httpsRequest({ hostname: 'test', path: '/flag', method: 'GET' });
      expect(result.body).toBe(true);

      const [, resLog] = parsedLogs();
      expect(resLog.body).toBe(true);
    });
  });
});
