'use strict';

jest.mock('../db', () => ({ getPool: jest.fn() }));
jest.mock('../DmlConfigRepository', () => ({
  listEnabledMarkets: jest.fn(), upsertDmlConfiguration: jest.fn(),
}));
jest.mock('../DmsSettingsRepository', () => ({
  listEnabledDealers: jest.fn(), upsertDmsSettings: jest.fn(),
}));
jest.mock('../../serviceClient', () => ({
  callService: jest.fn(), isInternalRequest: jest.fn().mockReturnValue(false),
}));
jest.mock('../internal', () => ({ handler: jest.fn().mockResolvedValue({ statusCode: 200 }) }));

const { getPool } = require('../db');
const { listEnabledMarkets, upsertDmlConfiguration } = require('../DmlConfigRepository');
const { listEnabledDealers, upsertDmsSettings } = require('../DmsSettingsRepository');
const { callService, isInternalRequest } = require('../../serviceClient');
const { runSync, syncMarket, syncDealer, handler, main } = require('../index');
const pool = {};

beforeEach(() => {
  jest.clearAllMocks();
  getPool.mockResolvedValue(pool);
  listEnabledMarkets.mockResolvedValue([]);
  listEnabledDealers.mockResolvedValue([]);
  callService.mockResolvedValue({ data: [] });
  isInternalRequest.mockReturnValue(false);
});

test('no enabled entries means no REST calls', async () => {
  expect(await runSync()).toEqual({ success: true, results: [], dealerResults: [] });
  expect(callService).not.toHaveBeenCalled();
});

test('syncs markets and dealers over REST without upstream credentials', async () => {
  listEnabledMarkets.mockResolvedValue([{ country: 'fr', language: 'fr' }]);
  listEnabledDealers.mockResolvedValue([{ country: 'it', brand: 'FT', dealer: '123' }]);
  const result = await runSync();
  expect(result.success).toBe(true);
  expect(callService).toHaveBeenCalledWith('dms', 'company-types', { country: 'fr', language: 'fr' });
  expect(callService).toHaveBeenCalledWith('dms', 'customer-titles', { country: 'fr', language: 'fr' });
  expect(callService).toHaveBeenCalledWith('dms', 'settings', { country: 'it', brand: 'FT', dealer: '123' });
  expect(upsertDmlConfiguration).toHaveBeenCalledWith(pool, {
    country: 'fr', language: 'fr', companyTypes: [], customerTitles: [],
  });
  expect(upsertDmsSettings).toHaveBeenCalledWith(pool, {
    country: 'it', brand: 'FT', dealer: '123', settings: { data: [] },
  });
});

test('isolates failures by market and dealer, logging each rejected REST call', async () => {
  listEnabledMarkets.mockResolvedValue([{ country: 'fr', language: 'fr' }, { country: 'de', language: 'de' }]);
  listEnabledDealers.mockResolvedValue([{ country: 'it', brand: 'FT', dealer: 'bad' }, { country: 'fr', brand: 'FT', dealer: 'ok' }]);
  callService.mockImplementation(async (_, operation, payload) => {
    if (payload.country === 'de' || payload.dealer === 'bad') throw new Error('HTTP 503');
    return { data: [] };
  });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = await runSync();
  expect(result.success).toBe(false);
  expect(result.results.map((r) => r.success)).toEqual([true, false]);
  expect(result.dealerResults.map((r) => r.success)).toEqual([false, true]);
  expect(log).toHaveBeenCalledTimes(2);
  log.mockRestore();
});

test('injected functions receive domain params, never a token', async () => {
  const companies = jest.fn().mockResolvedValue({ data: [{ code: 'A' }] });
  const titles = jest.fn().mockResolvedValue({ data: [{ code: 'B' }] });
  await syncMarket(pool, { country: 'fr', language: 'fr' }, {
    getCompanyTypesFn: companies, getCustomerTitlesFn: titles, upsertFn: upsertDmlConfiguration,
  });
  expect(companies).toHaveBeenCalledWith({ country: 'fr', language: 'fr' });
  expect(upsertDmlConfiguration.mock.calls[0][1].companyTypes).toEqual([{ code: 'A' }]);
  const settings = jest.fn().mockResolvedValue({ success: true });
  await syncDealer(pool, { country: 'fr', brand: 'FT', dealer: '123' }, {
    getDmsSettingsFn: settings, upsertDmsSettingsFn: upsertDmsSettings,
  });
  expect(settings).toHaveBeenCalledWith({ country: 'fr', brand: 'FT', dealer: '123' });
});

test.each([null, {}, { data: 'invalid' }])('retains historical empty-array fallback for missing config data: %p', async (response) => {
  await syncMarket(pool, { country: 'fr', language: 'fr' }, {
    getCompanyTypesFn: async () => response, getCustomerTitlesFn: async () => response,
    upsertFn: upsertDmlConfiguration,
  });
  expect(upsertDmlConfiguration.mock.calls[0][1].companyTypes).toEqual([]);
  expect(upsertDmlConfiguration.mock.calls[0][1].customerTitles).toEqual([]);
});

test('database failure propagates explicitly', async () => {
  getPool.mockRejectedValue(new Error('DB down'));
  await expect(runSync()).rejects.toThrow('DB down');
});

test('handler runs scheduled sync or dispatches IAM REST operations', async () => {
  expect((await handler()).success).toBe(true);
  isInternalRequest.mockReturnValue(true);
  expect(await handler({ path: '/internal/dmlconfigsync/getDmsSettings' })).toEqual({ statusCode: 200 });
});

describe('CLI', () => {
  let argv;
  let log;
  let error;
  let exit;
  beforeEach(() => {
    argv = process.argv;
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });
  afterEach(() => {
    process.argv = argv;
    delete process.exitCode;
    log.mockRestore(); error.mockRestore(); exit.mockRestore();
  });
  test('prints summary', async () => {
    process.argv = ['node', 'index.js', 'sync'];
    await main();
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
  test('reports unsuccessful sync via exitCode', async () => {
    process.argv = ['node', 'index.js', 'sync'];
    listEnabledMarkets.mockResolvedValue([{ country: 'fr', language: 'fr' }]);
    callService.mockRejectedValue(new Error('HTTP 502'));
    await main();
    expect(process.exitCode).toBe(1);
  });
  test('rejects unsupported commands', async () => {
    process.argv = ['node', 'index.js', 'unknown'];
    await main();
    expect(exit).toHaveBeenCalledWith(1);
  });
  test('reports database failure', async () => {
    process.argv = ['node', 'index.js', 'sync'];
    getPool.mockRejectedValue(new Error('DB down'));
    await main();
    expect(error).toHaveBeenCalledWith('\n[ERROR]', 'DB down');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
