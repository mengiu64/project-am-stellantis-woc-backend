'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/handlers/translations', () => ({ handler: jest.fn() }));

const { handler, _parseKvArgs, _cliMain } = require('../index');
const translations = require('../src/handlers/translations');

describe('translations Lambda dispatcher (index.js)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('routes event.action=translations to translations handler', async () => {
    translations.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'translations', queryStringParameters: { lang: 'en' } };
    const res = await handler(event, {});
    expect(translations.handler).toHaveBeenCalledWith(event, {});
    expect(res.statusCode).toBe(200);
  });

  test('derives action from event.path (REST API proxy event) last segment', async () => {
    translations.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { path: '/api/translations', queryStringParameters: { lang: 'it' } };
    await handler(event, {});
    expect(translations.handler).toHaveBeenCalledWith(event, {});
  });

  test('derives action from event.rawPath (HTTP API v2 proxy event) last segment', async () => {
    translations.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { rawPath: '/api/translations', queryStringParameters: { lang: 'it' } };
    await handler(event, {});
    expect(translations.handler).toHaveBeenCalledWith(event, {});
  });

  test('derives action from event.pathParameters.proxy when path/rawPath are absent', async () => {
    translations.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { pathParameters: { proxy: 'translations' } };
    await handler(event, {});
    expect(translations.handler).toHaveBeenCalledWith(event, {});
  });

  test('falls back to "translations" when no action/path is present', async () => {
    translations.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { queryStringParameters: { lang: 'en' } };
    await handler(event, {});
    expect(translations.handler).toHaveBeenCalledWith(event, {});
  });

  test('returns 400 for unknown action', async () => {
    const event = { action: 'unknown' };
    const res = await handler(event, {});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('unknown');
  });

  test('response has Content-Type header', async () => {
    const res = await handler({ action: 'unknown' }, {});
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});

// ── CLI unit tests ─────────────────────────────────────────────────────────────

describe('_parseKvArgs', () => {
  test('parses string key=value pairs', () => {
    expect(_parseKvArgs(['lang=en'])).toEqual({ lang: 'en' });
  });

  test('ignores args without "="', () => {
    expect(_parseKvArgs(['novalue', 'also-no-equals'])).toEqual({});
  });

  test('handles empty array', () => {
    expect(_parseKvArgs([])).toEqual({});
  });
});

describe('_cliMain', () => {
  let originalArgv;
  let exitSpy;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    originalArgv = process.argv;
    jest.clearAllMocks();
    exitSpy  = jest.spyOn(process, 'exit').mockImplementation(() => {});
    logSpy   = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    jest.restoreAllMocks();
  });

  test('exits with 1 and shows help when action is missing', async () => {
    process.argv = ['node', 'index.js'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
  });

  test('exits with 1 for unknown action', async () => {
    process.argv = ['node', 'index.js', 'unknown'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('routes translations and prints result', async () => {
    translations.handler.mockResolvedValue({ statusCode: 200, body: '{"common":{"welcome":"Welcome"}}' });
    process.argv = ['node', 'index.js', 'translations', 'lang=en'];
    await _cliMain();
    expect(translations.handler).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'translations', params: { lang: 'en' } }),
      undefined,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('exits with 1 when statusCode >= 400', async () => {
    translations.handler.mockResolvedValue({ statusCode: 404, body: '{"success":false}' });
    process.argv = ['node', 'index.js', 'translations'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('exits with 1 when handler throws', async () => {
    translations.handler.mockRejectedValue(new Error('network error'));
    process.argv = ['node', 'index.js', 'translations'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('\n[ERROR]', 'network error');
  });

  test('handles non-string body in response', async () => {
    translations.handler.mockResolvedValue({ statusCode: 200, body: { common: {} } });
    process.argv = ['node', 'index.js', 'translations'];
    await _cliMain();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
