'use strict';

jest.mock('../db', () => ({
  getPool: jest.fn(),
}));
jest.mock('../PkConfigRepository', () => ({
  getPkwstouse: jest.fn(),
}));
jest.mock('../AnagSnowflakesRepository', () => ({
  getCountryIsoCode: jest.fn(),
}));

const { getPool } = require('../db');
const { getPkwstouse } = require('../PkConfigRepository');
const { getCountryIsoCode } = require('../AnagSnowflakesRepository');
const { handler } = require('../index');

const FAKE_POOL = { query: jest.fn() };

describe('dbManager index.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockResolvedValue(FAKE_POOL);
  });

  it('resolves pkwstouse via direct invocation payload { action, body }', async () => {
    getPkwstouse.mockResolvedValue('eper');

    const res = await handler({ action: 'getPkwstouse', body: { codmarket: 'IT', codbrand: 'FIAT' } });

    expect(getPkwstouse).toHaveBeenCalledWith(FAKE_POOL, { codmarket: 'IT', codbrand: 'FIAT' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      codmarket: 'IT',
      codbrand: 'FIAT',
      pkwstouse: 'eper',
    });
  });

  it('resolves pkwstouse via an API Gateway-style event (query string + JSON body)', async () => {
    getPkwstouse.mockResolvedValue('docsoa');

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { codmarket: 'IT' },
      body: JSON.stringify({ codbrand: 'JEEP' }),
    };
    const res = await handler(event);

    expect(getPkwstouse).toHaveBeenCalledWith(FAKE_POOL, { codmarket: 'IT', codbrand: 'JEEP' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).pkwstouse).toBe('docsoa');
  });

  it('defaults codmarket to null in the response when not provided', async () => {
    getPkwstouse.mockResolvedValue('menupricing');

    const res = await handler({ action: 'getPkwstouse', body: { codbrand: 'FIAT' } });

    expect(getPkwstouse).toHaveBeenCalledWith(FAKE_POOL, { codmarket: undefined, codbrand: 'FIAT' });
    expect(JSON.parse(res.body).codmarket).toBeNull();
  });

  it('returns 400 for unsupported actions', async () => {
    const res = await handler({ action: 'unknownAction', body: {} });
    expect(res.statusCode).toBe(400);
    expect(getPkwstouse).not.toHaveBeenCalled();
  });

  it('resolves marketIso via direct invocation payload { action, body }', async () => {
    getCountryIsoCode.mockResolvedValue('IT');

    const res = await handler({ action: 'getCountryIsoCode', body: { market: '1000' } });

    expect(getCountryIsoCode).toHaveBeenCalledWith(FAKE_POOL, { market: '1000' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, market: '1000', marketIso: 'IT' });
  });

  it('maps getCountryIsoCode repository "is required" errors to 400', async () => {
    getCountryIsoCode.mockRejectedValue(new Error('"market" is required'));
    const res = await handler({ action: 'getCountryIsoCode', body: {} });
    expect(res.statusCode).toBe(400);
  });

  it('parses a stringified JSON body from an API Gateway event', async () => {
    getPkwstouse.mockResolvedValue('eper');
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ codmarket: 'IT', codbrand: 'FIAT' }),
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).pkwstouse).toBe('eper');
  });

  it('falls back to an empty body when event.body is invalid JSON', async () => {
    getPkwstouse.mockResolvedValue(null);
    const event = { httpMethod: 'POST', body: 'not-json' };
    const res = await handler(event);
    expect(getPkwstouse).toHaveBeenCalledWith(FAKE_POOL, { codmarket: undefined, codbrand: undefined });
    expect(res.statusCode).toBe(200);
  });

  it('maps repository "is required" errors to 400', async () => {
    getPkwstouse.mockRejectedValue(new Error('"codbrand" is required'));
    const res = await handler({ action: 'getPkwstouse', body: { codmarket: 'IT' } });
    expect(res.statusCode).toBe(400);
  });

  it('maps unexpected/downstream errors to 502', async () => {
    getPkwstouse.mockRejectedValue(new Error('connection timeout'));
    const res = await handler({ action: 'getPkwstouse', body: { codmarket: 'IT', codbrand: 'FIAT' } });
    expect(res.statusCode).toBe(502);
  });
});

describe('dbManager CLI', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let exitSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockResolvedValue(FAKE_POOL);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('runGetPkwstouse prints the result and returns pkwstouse', async () => {
    const { runGetPkwstouse } = require('../index');
    getPkwstouse.mockResolvedValue('eper');

    const result = await runGetPkwstouse('IT', 'FIAT');

    expect(getPkwstouse).toHaveBeenCalledWith(FAKE_POOL, { codmarket: 'IT', codbrand: 'FIAT' });
    expect(result).toBe('eper');
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('main() runs getPkwstouse with codmarket/codbrand from argv', async () => {
    const { main } = require('../index');
    getPkwstouse.mockResolvedValue('docsoa');
    process.argv = ['node', 'index.js', 'getPkwstouse', 'IT', 'JEEP'];

    await main();

    expect(getPkwstouse).toHaveBeenCalledWith(FAKE_POOL, { codmarket: 'IT', codbrand: 'JEEP' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('main() treats "null" argv codmarket as null (forces the fallback)', async () => {
    const { main } = require('../index');
    getPkwstouse.mockResolvedValue('menupricing');
    process.argv = ['node', 'index.js', 'getPkwstouse', 'null', 'FIAT'];

    await main();

    expect(getPkwstouse).toHaveBeenCalledWith(FAKE_POOL, { codmarket: null, codbrand: 'FIAT' });
  });

  it('main() exits 1 when codbrand is missing', async () => {
    const { main } = require('../index');
    process.argv = ['node', 'index.js', 'getPkwstouse', 'IT'];

    await main();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getPkwstouse).not.toHaveBeenCalled();
  });

  it('main() exits 1 for an unknown command', async () => {
    const { main } = require('../index');
    process.argv = ['node', 'index.js', 'unknownCommand'];

    await main();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('main() exits 1 and logs the error when getPkwstouse rejects', async () => {
    const { main } = require('../index');
    getPkwstouse.mockRejectedValue(new Error('db down'));
    process.argv = ['node', 'index.js', 'getPkwstouse', 'IT', 'FIAT'];

    await main();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('\n[ERROR]', 'db down');
  });

  it('runGetCountryIsoCode prints the result and returns marketIso', async () => {
    const { runGetCountryIsoCode } = require('../index');
    getCountryIsoCode.mockResolvedValue('IT');

    const result = await runGetCountryIsoCode('1000');

    expect(getCountryIsoCode).toHaveBeenCalledWith(FAKE_POOL, { market: '1000' });
    expect(result).toBe('IT');
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('main() runs getCountryIsoCode with market from argv', async () => {
    const { main } = require('../index');
    getCountryIsoCode.mockResolvedValue('IT');
    process.argv = ['node', 'index.js', 'getCountryIsoCode', '1000'];

    await main();

    expect(getCountryIsoCode).toHaveBeenCalledWith(FAKE_POOL, { market: '1000' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('main() exits 1 when market is missing for getCountryIsoCode', async () => {
    const { main } = require('../index');
    process.argv = ['node', 'index.js', 'getCountryIsoCode'];

    await main();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getCountryIsoCode).not.toHaveBeenCalled();
  });
});
