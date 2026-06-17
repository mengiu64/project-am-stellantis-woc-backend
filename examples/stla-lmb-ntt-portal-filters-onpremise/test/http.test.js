jest.mock('https');

const https = require('https');
const EventEmitter = require('events');
const { httpsPost } = require('../src/http.js');

/**
 * Sets up a single https.request mock that simulates a response or error.
 */
function mockRequest({ statusCode, responseBody = '', networkError = null, triggerTimeout = false }) {
  const req = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn();
  req.destroy = jest.fn((err) => {
    process.nextTick(() => req.emit('error', err));
  });
  req.setTimeout = jest.fn((ms, cb) => {
    if (triggerTimeout) {
      process.nextTick(cb);
    }
  });

  https.request.mockImplementationOnce((opts, resCb) => {
    if (networkError) {
      process.nextTick(() => req.emit('error', networkError));
    } else if (!triggerTimeout) {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      // Call resCb synchronously so listeners are registered before data events fire
      resCb(res);
      process.nextTick(() => {
        res.emit('data', responseBody);
        res.emit('end');
      });
    }
    return req;
  });

  return req;
}

describe('http.js', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves with status and parsed JSON data on success', async () => {
    const body = { result: 'ok' };
    mockRequest({ statusCode: 200, responseBody: JSON.stringify(body) });

    const result = await httpsPost('https://example.com/path', {}, 'request-body');

    expect(result).toEqual({ status: 200, data: body });
  });

  it('resolves with data: null when response body is not valid JSON', async () => {
    mockRequest({ statusCode: 200, responseBody: 'not-json' });

    const result = await httpsPost('https://example.com/path', {}, 'request-body');

    expect(result).toEqual({ status: 200, data: null });
  });

  it('resolves correctly on non-200 status codes', async () => {
    mockRequest({ statusCode: 401, responseBody: JSON.stringify({ error: 'Unauthorized' }) });

    const result = await httpsPost('https://example.com/path', {}, 'request-body');

    expect(result.status).toBe(401);
    expect(result.data).toEqual({ error: 'Unauthorized' });
  });

  it('handles chunked response body', async () => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn();
    req.destroy = jest.fn();
    req.setTimeout = jest.fn();

    https.request.mockImplementationOnce((opts, resCb) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      resCb(res);
      process.nextTick(() => {
        res.emit('data', '{"fo');
        res.emit('data', 'o":"bar"}');
        res.emit('end');
      });
      return req;
    });

    const result = await httpsPost('https://example.com/path', {}, 'body');

    expect(result).toEqual({ status: 200, data: { foo: 'bar' } });
  });

  it('rejects with a TimeoutError on request timeout', async () => {
    mockRequest({ triggerTimeout: true });

    await expect(
      httpsPost('https://example.com/path', { timeoutMs: 100 }, 'body')
    ).rejects.toMatchObject({ name: 'TimeoutError', message: 'Request timed out' });
  });

  it('rejects with network error when request fails', async () => {
    const networkErr = new Error('ECONNREFUSED');
    mockRequest({ networkError: networkErr });

    await expect(
      httpsPost('https://example.com/path', {}, 'body')
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('includes Content-Length and custom headers in the request', async () => {
    mockRequest({ statusCode: 200, responseBody: '{}' });

    await httpsPost('https://example.com/path', { headers: { 'X-Custom': 'header-val' } }, 'hello');

    const [[opts]] = https.request.mock.calls;
    expect(opts.headers['Content-Length']).toBe(Buffer.byteLength('hello'));
    expect(opts.headers['X-Custom']).toBe('header-val');
  });

  it('defaults to port 443 when no port is in the URL', async () => {
    mockRequest({ statusCode: 200, responseBody: '{}' });

    await httpsPost('https://example.com/path', {}, 'body');

    const [[opts]] = https.request.mock.calls;
    expect(opts.port).toBe(443);
  });

  it('uses explicit port when specified in the URL', async () => {
    mockRequest({ statusCode: 200, responseBody: '{}' });

    await httpsPost('https://example.com:8443/path', {}, 'body');

    const [[opts]] = https.request.mock.calls;
    expect(opts.port).toBe('8443');
  });

  it('includes query string in the path', async () => {
    mockRequest({ statusCode: 200, responseBody: '{}' });

    await httpsPost('https://example.com/path?foo=bar&baz=1', {}, 'body');

    const [[opts]] = https.request.mock.calls;
    expect(opts.path).toBe('/path?foo=bar&baz=1');
  });

  it('uses POST method', async () => {
    mockRequest({ statusCode: 200, responseBody: '{}' });

    await httpsPost('https://example.com/path', {}, 'body');

    const [[opts]] = https.request.mock.calls;
    expect(opts.method).toBe('POST');
  });
});
