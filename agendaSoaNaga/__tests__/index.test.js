'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/handlers/createnaga', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/updatenaga', () => ({ handler: jest.fn() }));

const { handler, _parseKvArgs, _cliMain } = require('../index');
const createnaga = require('../src/handlers/createnaga');
const updatenaga = require('../src/handlers/updatenaga');

describe('agendaSoaNaga Lambda dispatcher (index.js)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('routes event.action=createnaga to createnaga handler', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'createnaga', body: '{}' };
    const res = await handler(event, {});
    expect(createnaga.handler).toHaveBeenCalledWith(event, {});
    expect(res.statusCode).toBe(200);
  });

  test('routes event.action=updatenaga to updatenaga handler', async () => {
    updatenaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'updatenaga', body: '{}' };
    await handler(event, {});
    expect(updatenaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('uses event.httpMethod as fallback when action is absent', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { httpMethod: 'createnaga' };
    await handler(event, {});
    expect(createnaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('derives action from event.path (REST API proxy event) last segment', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { path: '/api/agendaNaga/createnaga', queryStringParameters: {} };
    await handler(event, {});
    expect(createnaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('derives action from event.rawPath (HTTP API v2 proxy event) last segment', async () => {
    updatenaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { rawPath: '/api/agendaNaga/updatenaga', queryStringParameters: {} };
    await handler(event, {});
    expect(updatenaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('derives action from event.pathParameters.proxy when path/rawPath are absent', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { pathParameters: { proxy: 'createnaga' } };
    await handler(event, {});
    expect(createnaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('falls back to event.httpMethod when the path has no segments', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { path: '/', httpMethod: 'createnaga' };
    await handler(event, {});
    expect(createnaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('returns 400 for unknown action', async () => {
    const event = { action: 'deletenaga' };
    const res = await handler(event, {});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('deletenaga');
  });

  test('returns 400 when action is missing', async () => {
    const res = await handler({}, {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('error response lists valid actions', async () => {
    const res = await handler({ action: 'bad' }, {});
    const body = JSON.parse(res.body);
    expect(body.message).toContain('createnaga');
    expect(body.message).toContain('updatenaga');
  });

  test('response has Content-Type header', async () => {
    const res = await handler({ action: 'bad' }, {});
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});

// ── CLI unit tests ─────────────────────────────────────────────────────────────

describe('_parseKvArgs (naga)', () => {
  test('parses string key=value pairs', () => {
    expect(_parseKvArgs(['rdvBrand=AP', 'locale=fr_FR'])).toEqual({ rdvBrand: 'AP', locale: 'fr_FR' });
  });

  test('casts numeric-only values to numbers', () => {
    expect(_parseKvArgs(['apptId=106799025'])).toEqual({ apptId: 106799025 });
  });

  test('excludes the "body" key from result', () => {
    const result = _parseKvArgs(['apptId=123', 'body={"foo":"bar"}']);
    expect(result).toEqual({ apptId: 123 });
    expect(result.body).toBeUndefined();
  });

  test('ignores args without "="', () => {
    expect(_parseKvArgs(['noequalssign'])).toEqual({});
  });

  test('handles empty array', () => {
    expect(_parseKvArgs([])).toEqual({});
  });
});

describe('_cliMain (naga)', () => {
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
    process.argv = ['node', 'index.js', 'deletenaga'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('routes createnaga with key=value params', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{"success":true}' });
    process.argv = ['node', 'index.js', 'createnaga', 'rdvBrand=AP', 'locale=fr_FR'];
    await _cliMain();
    expect(createnaga.handler).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'createnaga', params: { rdvBrand: 'AP', locale: 'fr_FR' } }),
      undefined,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('routes createnaga with body= JSON param', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{"success":true}' });
    process.argv = ['node', 'index.js', 'createnaga', 'body={"rdvBrand":"AP"}'];
    await _cliMain();
    expect(createnaga.handler).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'createnaga', body: '{"rdvBrand":"AP"}' }),
      undefined,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('routes updatenaga with apptId and sets pathParameters', async () => {
    updatenaga.handler.mockResolvedValue({ statusCode: 200, body: '{"success":true}' });
    process.argv = ['node', 'index.js', 'updatenaga', 'apptId=106799025', 'rdvBrand=AP'];
    await _cliMain();
    expect(updatenaga.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updatenaga',
        pathParameters: { apptId: '106799025' },
      }),
      undefined,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('exits with 1 for updatenaga without apptId', async () => {
    process.argv = ['node', 'index.js', 'updatenaga', 'rdvBrand=AP'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('apptId'));
  });

  test('exits with 1 when statusCode >= 400', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 502, body: '{"success":false}' });
    process.argv = ['node', 'index.js', 'createnaga'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('exits with 1 when handler throws', async () => {
    createnaga.handler.mockRejectedValue(new Error('connection refused'));
    process.argv = ['node', 'index.js', 'createnaga'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('\n[ERROR]', 'connection refused');
  });

  test('handles non-string body in response', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: { success: true } });
    process.argv = ['node', 'index.js', 'createnaga'];
    await _cliMain();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
