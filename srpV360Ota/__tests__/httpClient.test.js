'use strict';

jest.mock('https');

const https = require('https');
const { httpsRequest, redactHeaders, redactBody, truncate } = require('../httpClient');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Costruisce un oggetto mock per la risposta HTTP.
 */
function buildMockRes(statusCode, chunks, headers = {}) {
  return {
    statusCode,
    headers,
    on: jest.fn((event, cb) => {
      if (event === 'data') chunks.forEach((c) => cb(c));
      if (event === 'end') cb();
    }),
  };
}

/**
 * Costruisce un oggetto mock per la richiesta HTTP.
 */
function buildMockReq() {
  return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
}

// ── truncate ──────────────────────────────────────────────────────────────────

describe('truncate', () => {
  test('returns string unchanged when length is exactly 4000', () => {
    const str = 'a'.repeat(4000);
    expect(truncate(str)).toBe(str);
    expect(truncate(str).length).toBe(4000);
  });

  test('truncates string at 4001 characters and appends suffix', () => {
    const str = 'b'.repeat(4001);
    const result = truncate(str);
    expect(result).toBe('b'.repeat(4000) + '...[truncated]');
    expect(result.length).toBe(4000 + '...[truncated]'.length);
  });

  test('returns short strings unchanged', () => {
    expect(truncate('hello')).toBe('hello');
    expect(truncate('')).toBe('');
  });

  test('returns non-string input unchanged', () => {
    expect(truncate(123)).toBe(123);
    expect(truncate(null)).toBe(null);
    expect(truncate(undefined)).toBe(undefined);
    expect(truncate(true)).toBe(true);
  });

  test('truncates long strings preserving first 4000 chars', () => {
    // Stringa con pattern riconoscibile per verificare che i primi 4000 caratteri siano preservati
    const pattern = '0123456789';
    const str = pattern.repeat(500); // 5000 caratteri
    const result = truncate(str);
    expect(result.startsWith(str.slice(0, 4000))).toBe(true);
    expect(result.endsWith('...[truncated]')).toBe(true);
  });
});

// ── redactHeaders ─────────────────────────────────────────────────────────────

describe('redactHeaders', () => {
  test('redacts Authorization header', () => {
    const result = redactHeaders({ Authorization: 'Bearer token123' });
    expect(result.Authorization).toBe('***REDACTED***');
  });

  test('redacts x-api-key header', () => {
    const result = redactHeaders({ 'x-api-key': 'my-api-key-value' });
    expect(result['x-api-key']).toBe('***REDACTED***');
  });

  test('redacts client_secret header', () => {
    const result = redactHeaders({ client_secret: 'secret-value' });
    expect(result.client_secret).toBe('***REDACTED***');
  });

  test('redacts password header', () => {
    const result = redactHeaders({ password: 'my-pass' });
    expect(result.password).toBe('***REDACTED***');
  });

  test('redacts token header', () => {
    const result = redactHeaders({ token: 'jwt-value' });
    expect(result.token).toBe('***REDACTED***');
  });

  test('redacts pwd header', () => {
    const result = redactHeaders({ pwd: 'pass123' });
    expect(result.pwd).toBe('***REDACTED***');
  });

  test('does NOT redact Content-Type header', () => {
    const result = redactHeaders({ 'Content-Type': 'application/json' });
    expect(result['Content-Type']).toBe('application/json');
  });

  test('does NOT redact Accept header', () => {
    const result = redactHeaders({ Accept: 'application/json' });
    expect(result.Accept).toBe('application/json');
  });

  test('does NOT redact x-trace-id header', () => {
    const result = redactHeaders({ 'x-trace-id': 'abc123def456' });
    expect(result['x-trace-id']).toBe('abc123def456');
  });

  test('handles mixed sensitive and non-sensitive headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer xyz',
      'x-api-key': 'key123',
      Accept: 'text/html',
      'x-trace-id': 'trace-001',
      password: 'secret',
    };
    const result = redactHeaders(headers);
    expect(result['Content-Type']).toBe('application/json');
    expect(result.Authorization).toBe('***REDACTED***');
    expect(result['x-api-key']).toBe('***REDACTED***');
    expect(result.Accept).toBe('text/html');
    expect(result['x-trace-id']).toBe('trace-001');
    expect(result.password).toBe('***REDACTED***');
  });

  test('returns empty object for empty input', () => {
    expect(redactHeaders({})).toEqual({});
  });

  test('handles undefined input gracefully', () => {
    expect(redactHeaders(undefined)).toEqual({});
  });
});

// ── redactBody ────────────────────────────────────────────────────────────────

describe('redactBody', () => {
  test('redacts sensitive keys in flat JSON object', () => {
    const body = { username: 'john', password: 'secret123', name: 'John' };
    const result = redactBody(body);
    expect(result.password).toBe('***REDACTED***');
    expect(result.username).toBe('john');
    expect(result.name).toBe('John');
  });

  test('redacts sensitive keys in nested JSON objects', () => {
    const body = {
      user: {
        name: 'Alice',
        credentials: {
          token: 'jwt-token',
          apiKey: 'key-value',
        },
      },
      safe: 'data',
    };
    const result = redactBody(body);
    expect(result.user.name).toBe('Alice');
    expect(result.user.credentials.token).toBe('***REDACTED***');
    expect(result.user.credentials.apiKey).toBe('***REDACTED***');
    expect(result.safe).toBe('data');
  });

  test('redacts sensitive keys in arrays of objects', () => {
    const body = [
      { name: 'item1', secret: 'val1' },
      { name: 'item2', secret: 'val2' },
    ];
    const result = redactBody(body);
    expect(result[0].name).toBe('item1');
    expect(result[0].secret).toBe('***REDACTED***');
    expect(result[1].name).toBe('item2');
    expect(result[1].secret).toBe('***REDACTED***');
  });

  test('redacts sensitive keys deeply nested (3+ levels)', () => {
    const body = {
      level1: {
        level2: {
          level3: {
            authorization: 'deep-secret',
            value: 42,
          },
        },
      },
    };
    const result = redactBody(body);
    expect(result.level1.level2.level3.authorization).toBe('***REDACTED***');
    expect(result.level1.level2.level3.value).toBe(42);
  });

  test('handles JSON string input by parsing and redacting', () => {
    const body = JSON.stringify({ token: 'abc', data: 'safe' });
    const result = redactBody(body);
    expect(result.token).toBe('***REDACTED***');
    expect(result.data).toBe('safe');
  });

  test('redacts sensitive params in form-urlencoded strings', () => {
    const body = 'grant_type=client_credentials&client_secret=my-secret&scope=prd:asv';
    const result = redactBody(body);
    expect(result).toContain('client_secret=***REDACTED***');
    expect(result).not.toContain('my-secret');
    expect(result).toContain('grant_type=client_credentials');
    expect(result).toContain('scope=prd:asv');
  });

  test('redacts multiple sensitive params in form-urlencoded strings', () => {
    const body = 'password=pass123&token=jwt-val&name=john';
    const result = redactBody(body);
    expect(result).toContain('password=***REDACTED***');
    expect(result).toContain('token=***REDACTED***');
    expect(result).toContain('name=john');
  });

  test('returns null/undefined unchanged', () => {
    expect(redactBody(null)).toBe(null);
    expect(redactBody(undefined)).toBe(undefined);
  });

  test('returns primitive values unchanged', () => {
    expect(redactBody(42)).toBe(42);
    expect(redactBody(true)).toBe(true);
  });
});

// ── httpsRequest ──────────────────────────────────────────────────────────────

describe('httpsRequest', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  function parsedLogs() {
    return logSpy.mock.calls.map(([arg]) => JSON.parse(arg));
  }

  test('resolves with statusCode, headers, and parsed JSON body', async () => {
    const responseData = JSON.stringify({ result: 'ok', count: 5 });
    const mockRes = buildMockRes(200, [Buffer.from(responseData)], { 'content-type': 'application/json' });
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({
      hostname: 'api.example.com',
      path: '/data',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ 'content-type': 'application/json' });
    expect(result.body).toEqual({ result: 'ok', count: 5 });
  });

  test('resolves with raw string for non-JSON response body', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('plain text response')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'test', path: '/', method: 'GET' });
    expect(result.body).toBe('plain text response');
  });

  test('writes body when provided', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ hostname: 'test', path: '/', method: 'POST' }, '{"key":"value"}');
    expect(mockReq.write).toHaveBeenCalledWith('{"key":"value"}');
  });

  test('does not write body when body is null', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ hostname: 'test', path: '/', method: 'GET' }, null);
    expect(mockReq.write).not.toHaveBeenCalled();
  });

  test('calls req.end() to finalize the request', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ hostname: 'test', path: '/', method: 'GET' });
    expect(mockReq.end).toHaveBeenCalled();
  });

  // ── Network error ─────────────────────────────────────────────────────────

  test('rejects and emits http_error log on network error', async () => {
    let errorCb;
    const mockReq = {
      on: jest.fn((event, cb) => { if (event === 'error') errorCb = cb; }),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation(() => mockReq);

    const promise = httpsRequest({ hostname: 'unreachable.example.com', path: '/api', method: 'POST' });
    errorCb(new Error('ECONNREFUSED'));

    await expect(promise).rejects.toThrow('ECONNREFUSED');

    // Verifica che venga emesso il log http_error
    const logs = parsedLogs();
    const errorLog = logs.find((l) => l.logType === 'http_error');
    expect(errorLog).toBeDefined();
    expect(errorLog.logType).toBe('http_error');
    expect(errorLog.method).toBe('POST');
    expect(errorLog.url).toBe('https://unreachable.example.com/api');
    expect(errorLog.error).toBe('ECONNREFUSED');
    expect(typeof errorLog.durationMs).toBe('number');
  });

  // ── Structured logging ────────────────────────────────────────────────────

  test('emits http_request and http_response logs with correct structure', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{"data":"ok"}')], { 'x-req-id': '123' });
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({
      hostname: 'api.example.com',
      path: '/resource',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, '{"key":"value"}');

    const logs = parsedLogs();
    expect(logs.length).toBe(2);

    // Verifica struttura http_request
    const reqLog = logs[0];
    expect(reqLog.logType).toBe('http_request');
    expect(reqLog.method).toBe('POST');
    expect(reqLog.url).toBe('https://api.example.com/resource');
    expect(reqLog.headers).toBeDefined();
    expect(reqLog.body).toBeDefined();

    // Verifica struttura http_response
    const resLog = logs[1];
    expect(resLog.logType).toBe('http_response');
    expect(resLog.method).toBe('POST');
    expect(resLog.url).toBe('https://api.example.com/resource');
    expect(resLog.statusCode).toBe(200);
    expect(typeof resLog.durationMs).toBe('number');
    expect(resLog.headers).toBeDefined();
    expect(resLog.body).toBeDefined();
  });

  test('redacts sensitive headers in logs', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')], { 'x-token': 'resp-token' });
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({
      hostname: 'test',
      path: '/',
      method: 'GET',
      headers: { Authorization: 'Bearer secret-jwt', 'Content-Type': 'application/json' },
    });

    const [reqLog, resLog] = parsedLogs();
    expect(reqLog.headers.Authorization).toBe('***REDACTED***');
    expect(reqLog.headers['Content-Type']).toBe('application/json');
    expect(resLog.headers['x-token']).toBe('***REDACTED***');
  });

  test('redacts sensitive body fields in logs', async () => {
    const responseBody = JSON.stringify({ access_token: 'secret', data: 'safe' });
    const mockRes = buildMockRes(200, [Buffer.from(responseBody)]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest(
      { hostname: 'test', path: '/', method: 'POST', headers: {} },
      JSON.stringify({ client_secret: 'my-secret', action: 'login' })
    );

    const [reqLog, resLog] = parsedLogs();
    expect(reqLog.body.client_secret).toBe('***REDACTED***');
    expect(reqLog.body.action).toBe('login');
    expect(resLog.body.access_token).toBe('***REDACTED***');
    expect(resLog.body.data).toBe('safe');
  });
});
