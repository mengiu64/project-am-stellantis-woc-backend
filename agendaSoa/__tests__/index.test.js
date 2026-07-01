'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/handlers/appointment', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/availableHours', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/cCSList', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/data', () => ({ handler: jest.fn() }));

const { handler, _parseKvArgs, _cliMain } = require('../index');
const appointment    = require('../src/handlers/appointment');
const availableHours = require('../src/handlers/availableHours');
const cCSList        = require('../src/handlers/cCSList');
const data           = require('../src/handlers/data');

describe('agendaSoa Lambda dispatcher (index.js)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('routes event.action=appointment to appointment handler', async () => {
    appointment.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'appointment', queryStringParameters: {} };
    const res = await handler(event, {});
    expect(appointment.handler).toHaveBeenCalledWith(event, {});
    expect(res.statusCode).toBe(200);
  });

  test('routes event.action=availableHours to availableHours handler', async () => {
    availableHours.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'availableHours' };
    await handler(event, {});
    expect(availableHours.handler).toHaveBeenCalledWith(event, {});
  });

  test('routes event.action=cCSList to cCSList handler', async () => {
    cCSList.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'cCSList' };
    await handler(event, {});
    expect(cCSList.handler).toHaveBeenCalledWith(event, {});
  });

  test('routes event.action=data to data handler', async () => {
    data.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'data' };
    await handler(event, {});
    expect(data.handler).toHaveBeenCalledWith(event, {});
  });

  test('uses event.httpMethod as fallback when action is absent', async () => {
    appointment.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { httpMethod: 'appointment' };
    await handler(event, {});
    expect(appointment.handler).toHaveBeenCalledWith(event, {});
  });

  test('returns 400 for unknown action', async () => {
    const event = { action: 'unknown' };
    const res = await handler(event, {});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('unknown');
  });

  test('returns 400 when action is missing', async () => {
    const res = await handler({}, {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('response has Content-Type header', async () => {
    const res = await handler({ action: 'unknown' }, {});
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});

// ── CLI unit tests ─────────────────────────────────────────────────────────────

describe('_parseKvArgs', () => {
  test('parses string key=value pairs', () => {
    expect(_parseKvArgs(['id=PDV123', 'startDate=2025-01-01'])).toEqual({ id: 'PDV123', startDate: '2025-01-01' });
  });

  test('casts numeric-only values to numbers', () => {
    expect(_parseKvArgs(['page=2', 'size=10'])).toEqual({ page: 2, size: 10 });
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

  test('routes appointment and prints result', async () => {
    appointment.handler.mockResolvedValue({ statusCode: 200, body: '{"success":true}' });
    process.argv = ['node', 'index.js', 'appointment', 'ccs=MY_CCS', 'date=2025-06-01'];
    await _cliMain();
    expect(appointment.handler).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appointment', params: { ccs: 'MY_CCS', date: '2025-06-01' } }),
      undefined,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('routes availableHours', async () => {
    availableHours.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    process.argv = ['node', 'index.js', 'availableHours', 'id=MY_PDV'];
    await _cliMain();
    expect(availableHours.handler).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('routes cCSList', async () => {
    cCSList.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    process.argv = ['node', 'index.js', 'cCSList', 'id=MY_PDV'];
    await _cliMain();
    expect(cCSList.handler).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('routes data', async () => {
    data.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    process.argv = ['node', 'index.js', 'data', 'id=MY_APPT'];
    await _cliMain();
    expect(data.handler).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('exits with 1 when statusCode >= 400', async () => {
    appointment.handler.mockResolvedValue({ statusCode: 502, body: '{"success":false}' });
    process.argv = ['node', 'index.js', 'appointment'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('exits with 1 when handler throws', async () => {
    appointment.handler.mockRejectedValue(new Error('network error'));
    process.argv = ['node', 'index.js', 'appointment'];
    await _cliMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('\n[ERROR]', 'network error');
  });

  test('handles non-string body in response', async () => {
    appointment.handler.mockResolvedValue({ statusCode: 200, body: { success: true } });
    process.argv = ['node', 'index.js', 'appointment'];
    await _cliMain();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
