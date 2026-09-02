'use strict';

const path = require('path');

// Mock '../db' e '../DmlConfigRepository' a livello di modulo (prima di richiedere
// '../index'): index.js richiede questi due moduli in cima al file, e '../db'
// richiede a sua volta './config' che valida le proprie variabili d'ambiente
// (DMLCONFIGSYNC_DB_HOST) non appena richiesto. Mockando l'intero modulo '../db'
// (stesso pattern di dbManager/__tests__/index.test.js), config.js non viene mai
// caricato/validato in questi test.
jest.mock('../db', () => ({
  getPool: jest.fn(),
}));
jest.mock('../DmlConfigRepository', () => ({
  listEnabledMarkets: jest.fn(),
  upsertDmlConfiguration: jest.fn(),
}));
jest.mock('../DmsSettingsRepository', () => ({
  listEnabledDealers: jest.fn(),
  upsertDmsSettings: jest.fn(),
}));

const { getPool } = require('../db');
const { listEnabledMarkets, upsertDmlConfiguration } = require('../DmlConfigRepository');
const { listEnabledDealers, upsertDmsSettings } = require('../DmsSettingsRepository');
const { runSync, syncMarket, syncDealer, handler, main } = require('../index');

const FAKE_POOL = { query: jest.fn() };

describe('dmlConfigSync/index.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockResolvedValue(FAKE_POOL);
    // Default: nessun dealer abilitato, cosi' i test che si concentrano solo sui
    // mercati (pre-esistenti) non devono preoccuparsi del ramo dealer di runSync.
    listEnabledDealers.mockResolvedValue([]);
  });

  describe('syncMarket', () => {
    it('calls getCompanyTypes/getCustomerTitles in parallel and upserts the arrays from "data"', async () => {
      const getCompanyTypesFn = jest.fn().mockResolvedValue({ success: true, data: [{ code: 'A' }] });
      const getCustomerTitlesFn = jest.fn().mockResolvedValue({ success: true, data: [{ code: 'B' }] });
      const upsertFn = jest.fn().mockResolvedValue();

      const result = await syncMarket(FAKE_POOL, 'token123', { country: 'fr', language: 'fr' }, {
        getCompanyTypesFn, getCustomerTitlesFn, upsertFn,
      });

      expect(result).toEqual({ country: 'fr', language: 'fr', success: true });
      expect(getCompanyTypesFn).toHaveBeenCalledWith('token123', { country: 'fr', language: 'fr' });
      expect(getCustomerTitlesFn).toHaveBeenCalledWith('token123', { country: 'fr', language: 'fr' });
      expect(upsertFn).toHaveBeenCalledWith(FAKE_POOL, {
        country: 'fr',
        language: 'fr',
        companyTypes: [{ code: 'A' }],
        customerTitles: [{ code: 'B' }],
      });
    });

    it('upserts empty arrays when the DML response has no "data" (e.g. normalized 404)', async () => {
      const getCompanyTypesFn = jest.fn().mockResolvedValue({ success: false, data: [] });
      const getCustomerTitlesFn = jest.fn().mockResolvedValue({ success: false, data: [] });
      const upsertFn = jest.fn().mockResolvedValue();

      await syncMarket(FAKE_POOL, 'token123', { country: 'de', language: 'de' }, {
        getCompanyTypesFn, getCustomerTitlesFn, upsertFn,
      });

      expect(upsertFn).toHaveBeenCalledWith(FAKE_POOL, {
        country: 'de',
        language: 'de',
        companyTypes: [],
        customerTitles: [],
      });
    });
  });

  describe('syncDealer', () => {
    it('calls getDmsSettings and upserts the raw settings response', async () => {
      const getDmsSettingsFn = jest.fn().mockResolvedValue({ success: true, data: [{ key: 'isDML', value: 'TRUE', format: 'boolean' }] });
      const upsertDmsSettingsFn = jest.fn().mockResolvedValue();

      const result = await syncDealer(FAKE_POOL, 'token123', { country: 'it', brand: 'FT', dealer: '0073741' }, {
        getDmsSettingsFn, upsertDmsSettingsFn,
      });

      expect(result).toEqual({ country: 'it', brand: 'FT', dealer: '0073741', success: true });
      expect(getDmsSettingsFn).toHaveBeenCalledWith('token123', { country: 'it', brand: 'FT', dealer: '0073741' });
      expect(upsertDmsSettingsFn).toHaveBeenCalledWith(FAKE_POOL, {
        country: 'it',
        brand: 'FT',
        dealer: '0073741',
        settings: { success: true, data: [{ key: 'isDML', value: 'TRUE', format: 'boolean' }] },
      });
    });
  });

  describe('runSync', () => {
    it('returns success with empty results/dealerResults when no market/dealer is enabled', async () => {
      listEnabledMarkets.mockResolvedValue([]);
      const getBearerTokenFn = jest.fn();

      const result = await runSync({ getBearerTokenFn });

      expect(result).toEqual({ success: true, results: [], dealerResults: [] });
      expect(getBearerTokenFn).not.toHaveBeenCalled();
      expect(getPool).toHaveBeenCalledTimes(1);
    });

    it('throws a wrapped error when getBearerToken fails', async () => {
      listEnabledMarkets.mockResolvedValue([{ country: 'fr', language: 'fr' }]);
      const getBearerTokenFn = jest.fn().mockRejectedValue(new Error('401 unauthorized'));

      await expect(runSync({ getBearerTokenFn }))
        .rejects.toThrow('[dmlConfigSync] getBearerToken failed: 401 unauthorized');
    });

    it('syncs all enabled markets successfully in parallel', async () => {
      listEnabledMarkets.mockResolvedValue([
        { country: 'fr', language: 'fr' },
        { country: 'de', language: 'de' },
      ]);
      const getBearerTokenFn = jest.fn().mockResolvedValue('token123');
      const getCompanyTypesFn = jest.fn().mockResolvedValue({ success: true, data: [] });
      const getCustomerTitlesFn = jest.fn().mockResolvedValue({ success: true, data: [] });

      const result = await runSync({ getBearerTokenFn, getCompanyTypesFn, getCustomerTitlesFn });

      expect(result.success).toBe(true);
      expect(result.results).toEqual([
        { country: 'fr', language: 'fr', success: true },
        { country: 'de', language: 'de', success: true },
      ]);
      expect(result.dealerResults).toEqual([]);
      expect(upsertDmlConfiguration).toHaveBeenCalledTimes(2);
    });

    it('isolates per-market failures: one failing market does not block the others', async () => {
      listEnabledMarkets.mockResolvedValue([
        { country: 'fr', language: 'fr' },
        { country: 'de', language: 'de' },
      ]);
      const getBearerTokenFn = jest.fn().mockResolvedValue('token123');
      const getCompanyTypesFn = jest.fn()
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockRejectedValueOnce(new Error('HTTP 500'));
      const getCustomerTitlesFn = jest.fn().mockResolvedValue({ success: true, data: [] });

      const result = await runSync({ getBearerTokenFn, getCompanyTypesFn, getCustomerTitlesFn });

      expect(result.success).toBe(false);
      expect(result.results).toEqual([
        { country: 'fr', language: 'fr', success: true },
        { country: 'de', language: 'de', success: false, error: 'HTTP 500' },
      ]);
      // Il mercato fallito non impedisce l'upsert del mercato riuscito.
      expect(upsertDmlConfiguration).toHaveBeenCalledTimes(1);
    });

    it('syncs all enabled dealers successfully in parallel (nessun mercato abilitato)', async () => {
      listEnabledMarkets.mockResolvedValue([]);
      listEnabledDealers.mockResolvedValue([
        { country: 'it', brand: 'FT', dealer: '0073741' },
        { country: 'fr', brand: 'AC', dealer: '0012345' },
      ]);
      const getBearerTokenFn = jest.fn().mockResolvedValue('token123');
      const getDmsSettingsFn = jest.fn().mockResolvedValue({ success: true, data: [] });

      const result = await runSync({ getBearerTokenFn, getDmsSettingsFn });

      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.dealerResults).toEqual([
        { country: 'it', brand: 'FT', dealer: '0073741', success: true },
        { country: 'fr', brand: 'AC', dealer: '0012345', success: true },
      ]);
      expect(upsertDmsSettings).toHaveBeenCalledTimes(2);
      // Stesso bearer token condiviso tra mercati e dealer.
      expect(getBearerTokenFn).toHaveBeenCalledTimes(1);
    });

    it('isolates per-dealer failures: one failing dealer does not block the others nor the markets', async () => {
      listEnabledMarkets.mockResolvedValue([{ country: 'fr', language: 'fr' }]);
      listEnabledDealers.mockResolvedValue([
        { country: 'it', brand: 'FT', dealer: '0073741' },
        { country: 'fr', brand: 'AC', dealer: '0012345' },
      ]);
      const getBearerTokenFn = jest.fn().mockResolvedValue('token123');
      const getCompanyTypesFn = jest.fn().mockResolvedValue({ success: true, data: [] });
      const getCustomerTitlesFn = jest.fn().mockResolvedValue({ success: true, data: [] });
      const getDmsSettingsFn = jest.fn()
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockRejectedValueOnce(new Error('HTTP 502'));

      const result = await runSync({
        getBearerTokenFn, getCompanyTypesFn, getCustomerTitlesFn, getDmsSettingsFn,
      });

      expect(result.success).toBe(false);
      expect(result.results).toEqual([{ country: 'fr', language: 'fr', success: true }]);
      expect(result.dealerResults).toEqual([
        { country: 'it', brand: 'FT', dealer: '0073741', success: true },
        { country: 'fr', brand: 'AC', dealer: '0012345', success: false, error: 'HTTP 502' },
      ]);
      expect(upsertDmsSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('handler', () => {
    it('delegates to runSync and returns its summary', async () => {
      listEnabledMarkets.mockResolvedValue([]);

      const result = await handler();

      expect(result).toEqual({ success: true, results: [], dealerResults: [] });
    });
  });

  describe('main (CLI)', () => {
    let logSpy;
    let errorSpy;
    let exitSpy;

    beforeEach(() => {
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      delete process.exitCode;
    });

    it('prints usage and exits 1 for an unknown command', async () => {
      process.argv = ['node', 'index.js', 'unknown-command'];
      await main();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Comando non valido'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs the sync command successfully and prints the JSON summary', async () => {
      listEnabledMarkets.mockResolvedValue([]);
      process.argv = ['node', 'index.js', 'sync'];

      await main();

      expect(logSpy).toHaveBeenCalledWith('\n=== dmlConfigSync sync ===');
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    // Le prossime due verifiche esercitano i loader lazy interni (loadGetBearerToken/
    // loadGetCompanyTypes/loadGetCustomerTitles) chiamando main() -> runSync() SENZA
    // iniettare le dipendenze DML: usano jest.resetModules() + jest.doMock "self
    // contained" (mock di '../db'/'../DmlConfigRepository'/dms/* dedicati, isolati
    // dai mock a livello di file usati nelle altre describe di sopra) per ottenere
    // un'istanza fresca del modulo che risolve i require cross-folder verso
    // dms/authService e dms/dmsService su dei mock virtuali, senza mai toccare i
    // moduli reali (che richiederebbero DMS_PING_CLIENT_ID/DML_IBM_CLIENT_ID reali).
    it('sets a non-zero exitCode when the sync command reports a failed market', async () => {
      jest.resetModules();
      jest.doMock('../db', () => ({ getPool: jest.fn().mockResolvedValue(FAKE_POOL) }));
      jest.doMock('../DmlConfigRepository', () => ({
        listEnabledMarkets: jest.fn().mockResolvedValue([{ country: 'fr', language: 'fr' }]),
        upsertDmlConfiguration: jest.fn(),
      }));
      jest.doMock('../DmsSettingsRepository', () => ({
        listEnabledDealers: jest.fn().mockResolvedValue([]),
        upsertDmsSettings: jest.fn(),
      }));
      jest.doMock(path.resolve(__dirname, '../../dms/authService'), () => ({
        getBearerToken: jest.fn().mockResolvedValue('token123'),
      }), { virtual: true });
      jest.doMock(path.resolve(__dirname, '../../dms/dmsService'), () => ({
        getCompanyTypes: jest.fn().mockRejectedValue(new Error('HTTP 500')),
        getCustomerTitles: jest.fn().mockResolvedValue({ success: true, data: [] }),
      }), { virtual: true });
      const freshModule = require('../index');
      process.argv = ['node', 'index.js', 'sync'];

      await freshModule.main();

      expect(process.exitCode).toBe(1);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reports [ERROR] and exits 1 when the sync command throws (getBearerToken failure)', async () => {
      jest.resetModules();
      jest.doMock('../db', () => ({ getPool: jest.fn().mockResolvedValue(FAKE_POOL) }));
      jest.doMock('../DmlConfigRepository', () => ({
        listEnabledMarkets: jest.fn().mockResolvedValue([{ country: 'fr', language: 'fr' }]),
        upsertDmlConfiguration: jest.fn(),
      }));
      jest.doMock('../DmsSettingsRepository', () => ({
        listEnabledDealers: jest.fn().mockResolvedValue([]),
        upsertDmsSettings: jest.fn(),
      }));
      jest.doMock(path.resolve(__dirname, '../../dms/authService'), () => ({
        getBearerToken: jest.fn().mockRejectedValue(new Error('401')),
      }), { virtual: true });
      const freshModule = require('../index');
      process.argv = ['node', 'index.js', 'sync'];

      await freshModule.main();

      expect(errorSpy).toHaveBeenCalledWith('\n[ERROR]', expect.stringContaining('getBearerToken failed'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
