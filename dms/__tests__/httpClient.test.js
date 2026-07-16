'use strict';

jest.mock('https');

const https = require('https');
const { httpsRequest } = require('../httpClient');

function buildMockReq(onErrorCb = null) {
  return {
    on: jest.fn((event, cb) => {
      if (event === 'error' && onErrorCb) onErrorCb(cb);
    }),
    write: jest.fn(),
    end: jest.fn(),
  };
}

function buildMockRes(statusCode, chunks) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    on: jest.fn((event, cb) => {
      if (event === 'data') chunks.forEach((c) => cb(c));
      if (event === 'end') cb();
    }),
  };
}

describe('httpsRequest', () => {
  afterEach(() => jest.clearAllMocks());

  test('resolves with statusCode, headers and parsed JSON body', async () => {
    const data = JSON.stringify({ success: true });
    const mockRes = buildMockRes(200, [Buffer.from(data)]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'test', path: '/test', method: 'GET' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ success: true });
    expect(result.headers).toEqual(mockRes.headers);
    expect(mockReq.end).toHaveBeenCalled();
  });

  test('resolves with raw string when body is not valid JSON', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('plain text response')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'test', path: '/test', method: 'GET' });
    expect(result.body).toBe('plain text response');
  });

  test('resolves with multiple chunks concatenated', async () => {
    const mockRes = buildMockRes(200, [
      Buffer.from('{"part":'),
      Buffer.from('"value"}'),
    ]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({});
    expect(result.body).toEqual({ part: 'value' });
  });

  test('writes body when provided', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ hostname: 'test', path: '/post', method: 'POST' }, '{"key":"val"}');
    expect(mockReq.write).toHaveBeenCalledWith('{"key":"val"}');
  });

  test('does not write body when body is null', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ hostname: 'test', path: '/get', method: 'GET' }, null);
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

    const promise = httpsRequest({ hostname: 'test', path: '/test', method: 'GET' });
    errorCb(new Error('connection refused'));
    await expect(promise).rejects.toThrow('connection refused');
  });

  test('handles 404 response correctly', async () => {
    const mockRes = buildMockRes(404, [Buffer.from(JSON.stringify({ message: 'not found' }))]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({});
    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({ message: 'not found' });
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
      const mockReq = buildMockReq();
      https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

      await httpsRequest({
        hostname: 'test',
        path: '/secure',
        method: 'POST',
        headers: { Authorization: '******', 'Content-Type': 'application/json' },
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
      const mockReq = buildMockReq();
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
      const mockReq = buildMockReq();
      https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

      const result = await httpsRequest({ hostname: 'test', path: '/flag', method: 'GET' });
      expect(result.body).toBe(true);

      const [, resLog] = parsedLogs();
      expect(resLog.body).toBe(true);
    });
  });
});
