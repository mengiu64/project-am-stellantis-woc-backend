'use strict';

// ─── Mock dei client fratelli (pkEper / pkDocsoa / pkMenupricing) ─────────────
// PkManager.js li richiede dinamicamente con path.resolve(__dirname, '../<sibling>/...'),
// che risolve allo stesso file assoluto raggiunto da qui con '../../<sibling>/...'.
jest.mock('../../pkEper/WsIQPckEper', () => ({ WsIQPckEper: jest.fn() }));
jest.mock('../../pkDocsoa/DocSOARestClient', () => ({ DocSOARestClient: jest.fn() }));
jest.mock('../../pkMenupricing/MenuPricingSoapClient', () => ({ MenuPricingSoapClient: jest.fn() }));

const { WsIQPckEper } = require('../../pkEper/WsIQPckEper');
const { DocSOARestClient } = require('../../pkDocsoa/DocSOARestClient');
const { MenuPricingSoapClient } = require('../../pkMenupricing/MenuPricingSoapClient');
const { PkManager } = require('../PkManager');

describe('PkManager', () => {
  let ORIGINAL_ENV;

  beforeEach(() => {
    ORIGINAL_ENV = { ...process.env };
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    console.log.mockRestore();
  });

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('reads default wsConfig from environment variables', () => {
      process.env.EPER_CODDEALER = 'DEALER1';
      process.env.EPER_CODMARKET = 'MKT1';
      process.env.DOCSOA_CODBRAND = 'BRAND1';
      process.env.DOCSOA_LANGUE = 'FR';
      process.env.DOCSOA_PAYS = 'FR';
      process.env.DOCSOA_CODEPDV = 'PDV1';
      process.env.MP_LANGUAGE_CODE = 'IT';
      process.env.MP_COUNTRY_CODE = 'IT';
      process.env.MP_DEALER_IDENTIFICATION_CODE = 'DID1';
      process.env.MP_MANUFACTURER = 'FIAT';

      const manager = new PkManager();

      expect(manager.wsConfig.eper).toMatchObject({
        coddealer: 'DEALER1',
        codmarket: 'MKT1',
        lingua: 'IT',
        ticket: null,
      });
      expect(manager.wsConfig.docsoa).toMatchObject({
        codbrand: 'BRAND1',
        ldp: '',
        langue: 'FR',
        pays: 'FR',
        codePdv: 'PDV1',
        typeInternet: null,
      });
      expect(manager.wsConfig.menupricing).toMatchObject({
        languageCode: 'IT',
        countryCode: 'IT',
        dealerIdentificationCode: 'DID1',
        manufacturer: 'FIAT',
      });
    });

    test('overrides env defaults with explicit wsConfig', () => {
      const manager = new PkManager({
        eper: { coddealer: 'OVERRIDE', lingua: 'FR' },
        docsoa: { codbrand: 'OVERRIDE-DOCSOA' },
        menupricing: { manufacturer: 'OVERRIDE-MP' },
      });

      expect(manager.wsConfig.eper.coddealer).toBe('OVERRIDE');
      expect(manager.wsConfig.eper.lingua).toBe('FR');
      expect(manager.wsConfig.docsoa.codbrand).toBe('OVERRIDE-DOCSOA');
      expect(manager.wsConfig.menupricing.manufacturer).toBe('OVERRIDE-MP');
    });
  });

  // ── getConfigPackages ─────────────────────────────────────────────────────

  describe('getConfigPackages', () => {
    test('returns static config for eper', () => {
      const manager = new PkManager();
      const result = manager.getConfigPackages('1000', 'eper');
      expect(result).toEqual({ BODY: ['7210E221'], MECHANICH: [], ACCESSORIES: [] });
    });

    test('returns static config for docsoa', () => {
      const manager = new PkManager();
      const result = manager.getConfigPackages('1000', 'docsoa');
      expect(result.ACCESSORIES).toContain('95R04A');
      expect(result.MECHANICH).toContain('42001A');
    });

    test('returns static config for menupricing', () => {
      const manager = new PkManager();
      const result = manager.getConfigPackages('1000', 'menupricing');
      expect(result).toEqual({ BODY: ['221000135012'], MECHANICH: [], ACCESSORIES: [] });
    });

    test('is case-insensitive on pkwstouse', () => {
      const manager = new PkManager();
      expect(manager.getConfigPackages('1000', 'EPER')).toEqual(manager.getConfigPackages('1000', 'eper'));
    });

    test('throws for unrecognized pkwstouse', () => {
      const manager = new PkManager();
      expect(() => manager.getConfigPackages('1000', 'unknown')).toThrow(
        'pkwstouse non riconosciuto: "unknown". Valori ammessi: eper, docsoa, menupricing'
      );
    });

    test('throws when pkwstouse is undefined', () => {
      const manager = new PkManager();
      expect(() => manager.getConfigPackages('1000', undefined)).toThrow('pkwstouse non riconosciuto');
    });
  });

  // ── getValidPackages ──────────────────────────────────────────────────────

  describe('getValidPackages', () => {
    test('eper: intersects config codes with live map', async () => {
      const getCompletePkEperList = jest.fn().mockResolvedValue({
        '7210E221': { $: { codicePosizione: 'P1' } },
        'OTHER-CODE': { $: {} },
      });
      WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'eper', 'VIN123');

      expect(getCompletePkEperList).toHaveBeenCalledWith(
        expect.objectContaining({ vin: 'VIN123' })
      );
      expect(result).toEqual({ BODY: { '7210E221': { $: { codicePosizione: 'P1' } } } });
    });

    test('eper: throws when live result contains error', async () => {
      const getCompletePkEperList = jest.fn().mockResolvedValue({
        error: { errorMessage: 'boom' },
      });
      WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList }));

      const manager = new PkManager();
      await expect(manager.getValidPackages('1000', 'eper', 'VIN123')).rejects.toThrow('eper: boom');
    });

    test('eper: returns empty object when no codes match', async () => {
      const getCompletePkEperList = jest.fn().mockResolvedValue({ 'UNMATCHED': {} });
      WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'eper', 'VIN123');
      expect(result).toEqual({});
    });

    test('menupricing: intersects config codes with live map', async () => {
      const getCompletePkMpList = jest.fn().mockResolvedValue({
        success: true,
        data: { '221000135012': { detail: 'x' } },
      });
      MenuPricingSoapClient.mockImplementation(() => ({ getCompletePkMpList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'menupricing', 'VIN123');

      expect(result).toEqual({ BODY: { '221000135012': { detail: 'x' } } });
    });

    test('menupricing: throws when result.success is false', async () => {
      const getCompletePkMpList = jest.fn().mockResolvedValue({ success: false, message: 'nope' });
      MenuPricingSoapClient.mockImplementation(() => ({ getCompletePkMpList }));

      const manager = new PkManager();
      await expect(manager.getValidPackages('1000', 'menupricing', 'VIN123'))
        .rejects.toThrow('menupricing: nope');
    });

    test('menupricing: falls back to empty object when data is missing', async () => {
      const getCompletePkMpList = jest.fn().mockResolvedValue({ success: true });
      MenuPricingSoapClient.mockImplementation(() => ({ getCompletePkMpList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'menupricing', 'VIN123');
      expect(result).toEqual({});
    });

    test('docsoa: builds live map from array data and intersects config codes', async () => {
      const getCompletePkSOAList = jest.fn().mockResolvedValue({
        success: true,
        data: [
          { code: '95R04A', label: 'Accessory 1' },
          { code: 'UNMATCHED', label: 'Ignore me' },
          { noCodeField: true },
        ],
      });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'docsoa', 'VIN123');

      expect(result).toEqual({ ACCESSORIES: { '95R04A': { code: '95R04A', label: 'Accessory 1' } } });
    });

    test('docsoa: normalizes single-object data (not array) via toArray', async () => {
      const getCompletePkSOAList = jest.fn().mockResolvedValue({
        success: true,
        data: { code: '42001A', label: 'Mechanic 1' },
      });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'docsoa', 'VIN123');

      expect(result).toEqual({ MECHANICH: { '42001A': { code: '42001A', label: 'Mechanic 1' } } });
    });

    test('docsoa: throws when result.success is false', async () => {
      const getCompletePkSOAList = jest.fn().mockResolvedValue({ success: false, message: 'ko' });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList }));

      const manager = new PkManager();
      await expect(manager.getValidPackages('1000', 'docsoa', 'VIN123'))
        .rejects.toThrow('docsoa: ko');
    });

    test('docsoa: falls back to empty array when data is missing', async () => {
      const getCompletePkSOAList = jest.fn().mockResolvedValue({ success: true });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'docsoa', 'VIN123');
      expect(result).toEqual({});
    });

    test('propagates the error thrown by getConfigPackages for unknown ws', async () => {
      const manager = new PkManager();
      await expect(manager.getValidPackages('1000', 'unknown', 'VIN123')).rejects.toThrow(
        'pkwstouse non riconosciuto'
      );
    });
  });

  // ── getValidPackagesDetail ────────────────────────────────────────────────

  describe('getValidPackagesDetail', () => {
    test('returns {} when there are no valid packages', async () => {
      const getCompletePkEperList = jest.fn().mockResolvedValue({});
      WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'eper', 'VIN123');
      expect(result).toEqual({});
    });

    test('fetches detail for each valid package code (eper)', async () => {
      const getCompletePkEperList = jest.fn().mockResolvedValue({
        '7210E221': { $: { codicePosizione: 'P1', posizioneGuida: 'G1' } },
      });
      const getPackageDetailsPR = jest.fn().mockResolvedValue({ detail: 'ok' });
      WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList, getPackageDetailsPR }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'eper', 'VIN123');

      expect(result).toEqual({ '7210E221': { detail: 'ok' } });
      expect(getPackageDetailsPR).toHaveBeenCalledWith(
        expect.objectContaining({
          VIN: 'VIN123',
          codicePacchetto: '7210E221',
          codicePosizione: 'P1',
          codicePosizioneGuida: 'G1',
        })
      );
    });

    test('keeps other results when a single code detail fetch fails', async () => {
      const getCompletePkSOAList = jest.fn().mockResolvedValue({
        success: true,
        data: [
          { code: '95R04A' },
          { code: '95R10A' },
        ],
      });
      const ibxDetailForfaitService = jest.fn()
        .mockRejectedValueOnce(new Error('detail failed'))
        .mockResolvedValueOnce({ ok: true });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList, ibxDetailForfaitService }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'docsoa', 'VF3CABHW6GT204366');

      expect(result['95R04A']).toEqual({ error: 'detail failed' });
      expect(result['95R10A']).toEqual({ ok: true });
    });

    test('fetches detail for menupricing codes', async () => {
      const getCompletePkMpList = jest.fn().mockResolvedValue({
        success: true,
        data: { '221000135012': { detail: 'x' } },
      });
      const getJobDetails = jest.fn().mockResolvedValue({ jobDetail: 'ok' });
      MenuPricingSoapClient.mockImplementation(() => ({ getCompletePkMpList, getJobDetails }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'menupricing', 'VIN123');

      expect(result).toEqual({ '221000135012': { jobDetail: 'ok' } });
      expect(getJobDetails).toHaveBeenCalledWith(
        expect.objectContaining({ vin: 'VIN123', id: '221000135012' })
      );
    });
  });

  // ── _fetchDetail (branch coverage diretto) ────────────────────────────────

  describe('_fetchDetail', () => {
    test('eper: falls back to rowData fields without $ wrapper', async () => {
      const getPackageDetailsPR = jest.fn().mockResolvedValue({ detail: 'ok' });
      WsIQPckEper.mockImplementation(() => ({ getPackageDetailsPR }));

      const manager = new PkManager();
      await manager._fetchDetail('eper', 'VIN123', '7210E221', {
        codicePosizione: 'P2',
        posizioneGuida: 'G2',
      });

      expect(getPackageDetailsPR).toHaveBeenCalledWith(
        expect.objectContaining({ codicePosizione: 'P2', codicePosizioneGuida: 'G2' })
      );
    });

    test('docsoa: builds request from VIN parts', async () => {
      const ibxDetailForfaitService = jest.fn().mockResolvedValue({ ok: true });
      DocSOARestClient.mockImplementation(() => ({ ibxDetailForfaitService }));

      const manager = new PkManager();
      await manager._fetchDetail('docsoa', 'VF3CABHW6GT204366', '95R04A', {});

      expect(ibxDetailForfaitService).toHaveBeenCalledWith(
        expect.objectContaining({
          wmi: 'VF3',
          vds: 'CABHW6',
          vis: 'GT204366',
          codeFF: '95R04A',
          mode: 'MODE_XML',
        })
      );
    });

    test('throws for unrecognized pkwstouse', async () => {
      const manager = new PkManager();
      await expect(manager._fetchDetail('unknown', 'VIN123', 'CODE', {}))
        .rejects.toThrow('pkwstouse non riconosciuto: "unknown"');
    });
  });

  // ── _fetchLiveMap (branch coverage diretto) ───────────────────────────────

  describe('_fetchLiveMap', () => {
    test('throws for unrecognized pkwstouse', async () => {
      const manager = new PkManager();
      await expect(manager._fetchLiveMap('unknown', 'VIN123'))
        .rejects.toThrow('pkwstouse non riconosciuto: "unknown"');
    });
  });
});
