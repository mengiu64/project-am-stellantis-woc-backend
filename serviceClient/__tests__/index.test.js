'use strict';

const mockSign = jest.fn(async (request) => ({
  ...request, headers: { ...request.headers, authorization: 'AWS4-HMAC-SHA256 test-signature' },
}));
jest.mock('@smithy/signature-v4', () => ({ SignatureV4: jest.fn().mockImplementation(() => ({ sign: mockSign })) }));
jest.mock('@aws-sdk/credential-provider-node', () => ({ defaultProvider: jest.fn(() => async () => ({})) }));

const { callService, isInternalRequest, handleInternal, requireArgs } = require('..');
const { SignatureV4 } = require('@smithy/signature-v4');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WOC_INTERNAL_API_URL = 'https://gateway.execute-api.eu-west-1.amazonaws.com/wia/';
  process.env.AWS_REGION = 'eu-west-1';
  delete process.env.WOC_INTERNAL_TIMEOUT_MS;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { result: true } }) }));
});
afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('reads REST URL and timeout from the shared secret rather than environment values', async () => {
  process.env.WOC_INTERNAL_CONFIG_SECRET_ID = 'shared-config';
  const spy = jest.spyOn(require('../../runtimeConfig'), 'loadSettings').mockResolvedValue({
    WOC_INTERNAL_API_URL: 'https://secret-gateway/wia', WOC_INTERNAL_TIMEOUT_MS: 15000,
  });
  await callService('dms', 'inquiry');
  expect(spy).toHaveBeenCalledWith('WOC_INTERNAL_CONFIG_SECRET_ID');
  expect(mockSign).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'secret-gateway' }));
  spy.mockResolvedValue({});
  await expect(callService('dms', 'inquiry')).rejects.toThrow('Missing configuration keys');
  spy.mockResolvedValue({ WOC_INTERNAL_API_URL: 'https://secret-gateway/wia', WOC_INTERNAL_TIMEOUT_MS: 0 });
  await expect(callService('dms', 'inquiry')).rejects.toThrow('positivo');
});

test('requires the shared secret reference when running in Lambda', async () => {
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-consumer';
  delete process.env.WOC_INTERNAL_CONFIG_SECRET_ID;
  await expect(callService('dms', 'inquiry')).rejects.toThrow('WOC_INTERNAL_CONFIG_SECRET_ID is required');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('signs a POST with role credentials, exact payload and private API path', async () => {
  expect(await callService('dms', 'inquiry', { vin: 'VIN' })).toEqual({ result: true });
  expect(defaultProvider).toHaveBeenCalled();
  expect(SignatureV4).toHaveBeenCalledWith(expect.objectContaining({ region: 'eu-west-1', service: 'execute-api' }));
  expect(mockSign).toHaveBeenCalledWith(expect.objectContaining({
    hostname: 'gateway.execute-api.eu-west-1.amazonaws.com', path: '/wia/internal/dms/inquiry',
    method: 'POST', body: '{"vin":"VIN"}',
  }));
  expect(global.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
    redirect: 'manual', headers: expect.objectContaining({ authorization: 'AWS4-HMAC-SHA256 test-signature' }),
  }));
});

test('supports region fallback, explicit TLS port, no stage and null domain responses', async () => {
  delete process.env.AWS_REGION;
  process.env.AWS_DEFAULT_REGION = 'eu-west-1';
  process.env.WOC_INTERNAL_API_URL = 'https://gateway:8443';
  global.fetch.mockResolvedValue({ ok: true, text: async () => '{"data":null}' });
  expect(await callService('v360', 'getBrand')).toBeNull();
  expect(mockSign).toHaveBeenCalledWith(expect.objectContaining({ port: 8443, path: '/internal/v360/getBrand' }));
});

test.each([['unknown', 'inquiry'], ['dms', '../escape'], ['dms', ''], ['dms', 'x?query']])('rejects invalid destinations %s/%s', async (service, op) => {
  await expect(callService(service, op)).rejects.toThrow('non validi');
  expect(global.fetch).not.toHaveBeenCalled();
});
test.each(['http://gateway/wia', 'https://user:password@gateway/wia', 'https://gateway/wia?x=1', 'https://gateway/wia#frag'])('rejects unsafe base URL %s', async (url) => {
  process.env.WOC_INTERNAL_API_URL = url;
  await expect(callService('dms', 'inquiry')).rejects.toThrow('HTTPS');
});
test.each(['WOC_INTERNAL_API_URL', 'AWS_REGION'])('requires %s', async (key) => {
  delete process.env[key];
  delete process.env.AWS_DEFAULT_REGION;
  await expect(callService('dms', 'inquiry')).rejects.toThrow('obbligatori');
});
test.each(['0', '-1', 'invalid', 'Infinity'])('rejects invalid timeout %s', async (timeout) => {
  process.env.WOC_INTERNAL_TIMEOUT_MS = timeout;
  await expect(callService('dms', 'inquiry')).rejects.toThrow('positivo');
});
test.each([
  [false, 403, '{"message":"denied"}', 'HTTP 403: denied'],
  [false, 502, '{}', 'richiesta fallita'],
  [false, 502, 'null', 'richiesta fallita'],
  [true, 200, '{}', 'contratto'],
  [true, 200, 'null', 'contratto'],
  [false, 502, '<html>error</html>', 'non JSON'],
])('rejects malformed/failed responses', async (ok, status, text, error) => {
  global.fetch.mockResolvedValue({ ok, status, text: async () => text });
  await expect(callService('dms', 'inquiry')).rejects.toThrow(error);
});
test('network failure propagates and mutations are never automatically retried', async () => {
  global.fetch.mockRejectedValue(new Error('connection reset'));
  await expect(callService('dmlconfigsync', 'registerDealer')).rejects.toThrow('connection reset');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('request timeout aborts fetch and rejects', async () => {
  jest.useFakeTimers();
  process.env.WOC_INTERNAL_TIMEOUT_MS = '10';
  global.fetch.mockImplementation(async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const promise = callService('dms', 'inquiry');
  const assertion = expect(promise).rejects.toThrow('aborted');
  await jest.advanceTimersByTimeAsync(10);
  await assertion;
});

const event = (overrides = {}) => ({
  path: '/internal/dms/inquiry', httpMethod: 'POST', body: '{"vin":"VIN"}',
  requestContext: { identity: { userArn: 'arn:aws:sts::123:assumed-role/caller/session' } }, ...overrides,
});
const decode = (response) => ({ code: response.statusCode, ...JSON.parse(response.body) });

test('internal dispatcher validates IAM and preserves the domain response', async () => {
  const inquiry = jest.fn(async (payload) => payload);
  expect(decode(await handleInternal(event(), 'dms', { inquiry }))).toEqual({ code: 200, data: { vin: 'VIN' } });
  expect(inquiry).toHaveBeenCalledWith({ vin: 'VIN' });
});
test.each([
  [{ path: '/internal/other/inquiry' }, 404],
  [{ path: '/internal/dms/inquiry/extra' }, 404],
  [{ requestContext: {} }, 403],
  [{ httpMethod: 'GET' }, 405],
  [{ path: '/internal/dms/constructor' }, 404],
  [{ path: '/internal/dms/unknown' }, 404],
  [{ body: '[' }, 400], [{ body: '[]' }, 400], [{ body: 'null' }, 400], [{ body: undefined }, 400],
])('rejects invalid internal requests %p', async (overrides, code) => {
  const inquiry = jest.fn();
  expect((await handleInternal(event(overrides), 'dms', { inquiry })).statusCode).toBe(code);
  expect(inquiry).not.toHaveBeenCalled();
});
test('accepts base64 and object bodies, rawPath and undefined results', async () => {
  const inquiry = jest.fn();
  const response = await handleInternal(event({
    path: undefined, rawPath: '/internal/dms/inquiry',
    body: Buffer.from('{"a":1}').toString('base64'), isBase64Encoded: true,
  }), 'dms', { inquiry });
  expect(decode(response)).toEqual({ code: 200, data: null });
  expect(inquiry).toHaveBeenCalledWith({ a: 1 });
  await handleInternal(event({ body: { a: 2 } }), 'dms', { inquiry });
  expect(inquiry).toHaveBeenLastCalledWith({ a: 2 });
});
test.each([['upstream down', undefined, 502], ['"vin" is required', undefined, 400], ['missing', 404, 404]])('logs and surfaces operation errors', async (message, status, code) => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const inquiry = async () => { throw Object.assign(new Error(message), { statusCode: status }); };
  expect(decode(await handleInternal(event(), 'dms', { inquiry }))).toEqual({ code, message });
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});
test('recognizes only internal route paths', () => {
  expect(isInternalRequest()).toBe(false);
  expect(isInternalRequest({ path: '/api/session' })).toBe(false);
  expect(isInternalRequest({ rawPath: '/internal/session/getData' })).toBe(true);
  expect(isInternalRequest({ path: '/internal/session/getData' })).toBe(true);
});
test('positional contracts require an args array', () => {
  expect(requireArgs({ args: ['x'] })).toEqual(['x']);
  expect(() => requireArgs({})).toThrow('args');
});
