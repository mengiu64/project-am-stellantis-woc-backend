'use strict';

// ─── Mock dei client fratelli (pkEper / pkDocsoa / pkMenupricing) ─────────────
// PkManager.js li richiede dinamicamente con path.resolve(__dirname, '../<sibling>/...'),
// che risolve allo stesso file assoluto raggiunto da qui con '../../<sibling>/...'.
jest.mock('../../pkEper/WsIQPckEper', () => ({ WsIQPckEper: jest.fn() }));
jest.mock('../../pkDocsoa/DocSOARestClient', () => ({ DocSOARestClient: jest.fn() }));
jest.mock('../../pkMenupricing/MenuPricingSoapClient', () => ({ MenuPricingSoapClient: jest.fn() }));
jest.mock('../../dms/authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../../dms/dmsService', () => ({ postDmsInquiry: jest.fn() }));
// dbManager (usato da getPkList per risolvere pkwstouse da HQ_PKCONFIG via
// dbManager.getPkwstouse(pool, { codmarket, codbrand })), stesso pattern dei
// mock sopra: PkManager.js lo richiede con path.resolve(__dirname, '../dbManager/...').
jest.mock('../../dbManager/db', () => ({ getPool: jest.fn() }));
jest.mock('../../dbManager/PkConfigRepository', () => ({ getPkwstouse: jest.fn() }));

const { WsIQPckEper } = require('../../pkEper/WsIQPckEper');
const { DocSOARestClient } = require('../../pkDocsoa/DocSOARestClient');
const { MenuPricingSoapClient } = require('../../pkMenupricing/MenuPricingSoapClient');
const { getBearerToken } = require('../../dms/authService');
const { postDmsInquiry } = require('../../dms/dmsService');
const { getPool } = require('../../dbManager/db');
const { getPkwstouse } = require('../../dbManager/PkConfigRepository');
const { PkManager } = require('../PkManager');

describe('PkManager', () => {
  let ORIGINAL_ENV;

  beforeEach(() => {
    ORIGINAL_ENV = { ...process.env };
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // Nei test di getPkList il primo argomento è ormai "codbrand", non più
    // "pkwstouse": per non dover riscrivere ogni asserzione esistente (che si
    // aspetta getValidPackagesDetail chiamato con 'eper'/'docsoa'/'menupricing'),
    // il mock di dbManager.getPkwstouse ritorna semplicemente il codbrand
    // ricevuto, così i valori storici usati nei test ('eper', 'docsoa',
    // 'menupricing') continuano a fluire invariati come pkwstouse risolto.
    getPool.mockResolvedValue({});
    getPkwstouse.mockImplementation(async (pool, { codbrand }) => codbrand);
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
      delete process.env.DOCSOA_LDP; // isola dal valore reale eventualmente presente in .env
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
      expect(result).toEqual({ BODY: ['7210E221', '7015A041'], MECHANICH: [], ACCESSORIES: [] });
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
      expect(result).toEqual({
        BODY: [
          '221000135012',
          '054065105278',
          '054065305427',
          '054065505280',
          '054065705406',
          '054065905276',
          '054066105400'
        ],
        MECHANICH: [],
        ACCESSORIES: [],
      });
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
      expect(result).toEqual({ BODY: { '7210E221': { $: { codicePosizione: 'P1' }, category: 'BODY' } } });
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

      expect(result).toEqual({ BODY: { '221000135012': { detail: 'x', category: 'BODY' } } });
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

      expect(result).toEqual({ ACCESSORIES: { '95R04A': { code: '95R04A', label: 'Accessory 1', category: 'ACCESSORIES' } } });
    });

    test('docsoa: builds live map using refAff field (real DocSOA response shape)', async () => {
      const getCompletePkSOAList = jest.fn().mockResolvedValue({
        success: true,
        data: [
          { refAff: '95R04A', label: 'Accessory 1' },
          { refAff: 'UNMATCHED', label: 'Ignore me' },
        ],
      });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'docsoa', 'VIN123');

      expect(result).toEqual({ ACCESSORIES: { '95R04A': { refAff: '95R04A', label: 'Accessory 1', category: 'ACCESSORIES' } } });
    });

    test('docsoa: normalizes single-object data (not array) via toArray', async () => {
      const getCompletePkSOAList = jest.fn().mockResolvedValue({
        success: true,
        data: { code: '42001A', label: 'Mechanic 1' },
      });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList }));

      const manager = new PkManager();
      const result = await manager.getValidPackages('1000', 'docsoa', 'VIN123');

      expect(result).toEqual({ MECHANICH: { '42001A': { code: '42001A', label: 'Mechanic 1', category: 'MECHANICH' } } });
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
      const getPackageDetailsPR = jest.fn().mockResolvedValue({
        codice: '7210E221',
        descrizione: 'Pacchetto test',
        listaOperazioni: { operazione: [{ codice: 'OP1', descrizione: 'Op uno', tempo: '1.5' }] },
        listaRicambi: { ricambio: [{ posizione: '1', codice: 'SP1', descrizione: 'Ricambio uno', quantita: '2', prezzo: '10' }] },
      });
      WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList, getPackageDetailsPR }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'eper', 'VIN123');

      expect(result).toEqual({
        '7210E221': {
          codice: '7210E221',
          descrizione: 'Pacchetto test',
          isFixedPrice: '0',
          packageType: 'QE',
          category: 'BODY',
          listaOperazioni: [
            { TYPE: 'OP', POSIZIONE: '', COD: 'OP1', DESCR: 'Op uno', AV_LOCAL: 0, SCONTO: 0, TIME: '1.5', QTY: '', PRICE: '', CODSIGI: '' },
          ],
          listaRicambi: [
            { TYPE: 'SP', POSIZIONE: '1', COD: 'SP1', DESCR: 'Ricambio uno', AV_LOCAL: 0, SCONTO: 0, TIME: '', QTY: '2', PRICE: '10', CODSIGI: '' },
          ],
        },
      });
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
        .mockResolvedValueOnce({
          data: {
            forfait: {
              ref_fo: '95R10A',
              lib: 'Forfait test',
              prix: 100,
              niveau: '1',
              tp: { details: {} },
            },
          },
        });
      DocSOARestClient.mockImplementation(() => ({ getCompletePkSOAList, ibxDetailForfaitService }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'docsoa', 'VF3CABHW6GT204366');

      expect(result['95R04A']).toEqual({ error: 'detail failed', category: 'ACCESSORIES' });
      expect(result['95R10A']).toMatchObject({
        result: true,
        codice: '95R10A',
        descrizione: 'Forfait test',
        pkPrice: 100,
        isFixedPrice: '1',
        packageType: 'FP',
      });
    });

    test('fetches detail for menupricing codes', async () => {
      const getCompletePkMpList = jest.fn().mockResolvedValue({
        success: true,
        data: { '221000135012': { detail: 'x' } },
      });
      const getJobDetails = jest.fn().mockResolvedValue({
        success: true,
        data: {
          codice: '221000135012',
          descrizione: 'Job test',
          pkPrice: 50,
          isFixedPrice: '0',
          listaOperazioni: [],
          listaRicambi: [],
        },
      });
      MenuPricingSoapClient.mockImplementation(() => ({ getCompletePkMpList, getJobDetails }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'menupricing', 'VIN123');

      expect(result).toEqual({
        '221000135012': {
          result: true,
          codice: '221000135012',
          descrizione: 'Job test',
          pkPrice: 50,
          isFixedPrice: '0',
          packageType: 'QE',
          listaOperazioni: [],
          listaRicambi: [],
          category: 'BODY',
        },
      });
      expect(getJobDetails).toHaveBeenCalledWith(
        expect.objectContaining({ vin: 'VIN123', id: '221000135012' })
      );
    });

    test('falls back to String(err) when a rejected detail has no .message', async () => {
      const getCompletePkEperList = jest.fn().mockResolvedValue({
        '7210E221': { codicePosizione: 'P1' },
      });
      const getPackageDetailsPR = jest.fn().mockRejectedValue('plain string failure');
      WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList, getPackageDetailsPR }));

      const manager = new PkManager();
      const result = await manager.getValidPackagesDetail('1000', 'eper', 'VIN123');

      expect(result['7210E221']).toEqual({ error: 'plain string failure', category: 'BODY' });
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

    test('docsoa: builds request from VIN parts and uses forfait when found', async () => {
      const ibxDetailForfaitService = jest.fn().mockResolvedValue({ data: { forfait: { ref_fo: '95R04A' } } });
      const ibxDetailtpService      = jest.fn();
      DocSOARestClient.mockImplementation(() => ({ ibxDetailForfaitService, ibxDetailtpService }));

      const manager = new PkManager();
      const result  = await manager._fetchDetail('docsoa', 'VF3CABHW6GT204366', '95R04A', {});

      expect(ibxDetailForfaitService).toHaveBeenCalledWith(
        expect.objectContaining({
          wmi: 'VF3',
          vds: 'CABHW6',
          vis: 'GT204366',
          codeFF: '95R04A',
          mode: 'MODE_XML',
        })
      );
      expect(ibxDetailtpService).not.toHaveBeenCalled();
      expect(result.isFixedPrice).toBe('1');
      expect(result.packageType).toBe('FP');
    });

    test('docsoa: falls back to ibxDetailtpService (isFixedPrice 0) when forfait is not found', async () => {
      const ibxDetailForfaitService = jest.fn().mockResolvedValue({ data: null, message: 'Empty resultat' });
      const ibxDetailtpService      = jest.fn().mockResolvedValue({ data: { tp: { ref: '95R04A' } } });
      DocSOARestClient.mockImplementation(() => ({ ibxDetailForfaitService, ibxDetailtpService }));

      const manager = new PkManager();
      const result  = await manager._fetchDetail('docsoa', 'VF3CABHW6GT204366', '95R04A', {});

      expect(ibxDetailtpService).toHaveBeenCalledWith(
        expect.objectContaining({
          wmi: 'VF3',
          vds: 'CABHW6',
          vis: 'GT204366',
          refTp: '95R04A',
          mode: 'MODE_XML',
        })
      );
      expect(result.isFixedPrice).toBe('0');
      expect(result.packageType).toBe('QE');
    });

    test('docsoa: uses rowData.ref (not the refAff-based code) as refTp for ibxDetailtpService', async () => {
      // I nodi "doc" di ibxParametrageService espongono sia refAff (usato come chiave
      // di mappatura in buildDocsoaMap, qui il "code") sia ref (il riferimento tecnico
      // richiesto da ibxDetailtpService): vanno usati per scopi diversi.
      const ibxDetailForfaitService = jest.fn().mockResolvedValue({ data: null, message: 'Empty resultat' });
      const ibxDetailtpService      = jest.fn().mockResolvedValue({ data: { tp: { ref: 'TP-REF-999' } } });
      DocSOARestClient.mockImplementation(() => ({ ibxDetailForfaitService, ibxDetailtpService }));

      const manager  = new PkManager();
      const rowData  = { refAff: '95R04A', ref: 'TP-REF-999' };
      const result   = await manager._fetchDetail('docsoa', 'VF3CABHW6GT204366', '95R04A', rowData);

      expect(ibxDetailtpService).toHaveBeenCalledWith(
        expect.objectContaining({ refTp: 'TP-REF-999' })
      );
      expect(result.isFixedPrice).toBe('0');
    });

    test('docsoa: falls back to code as refTp when rowData.ref is missing', async () => {
      const ibxDetailForfaitService = jest.fn().mockResolvedValue({ data: null, message: 'Empty resultat' });
      const ibxDetailtpService      = jest.fn().mockResolvedValue({ data: { tp: { ref: '95R04A' } } });
      DocSOARestClient.mockImplementation(() => ({ ibxDetailForfaitService, ibxDetailtpService }));

      const manager = new PkManager();
      await manager._fetchDetail('docsoa', 'VF3CABHW6GT204366', '95R04A', { codice: '95R04A' });

      expect(ibxDetailtpService).toHaveBeenCalledWith(
        expect.objectContaining({ refTp: '95R04A' })
      );
    });

    test('throws for unrecognized pkwstouse', async () => {
      const manager = new PkManager();
      await expect(manager._fetchDetail('unknown', 'VIN123', 'CODE', {}))
        .rejects.toThrow('pkwstouse non riconosciuto: "unknown"');
    });

    test('throws when pkwstouse is undefined (?? fallback branch)', async () => {
      const manager = new PkManager();
      await expect(manager._fetchDetail(undefined, 'VIN123', 'CODE', {}))
        .rejects.toThrow('pkwstouse non riconosciuto: "undefined"');
    });

    test('eper: falls back to empty string when neither $ wrapper nor plain fields are present', async () => {
      const getPackageDetailsPR = jest.fn().mockResolvedValue({ detail: 'ok' });
      WsIQPckEper.mockImplementation(() => ({ getPackageDetailsPR }));

      const manager = new PkManager();
      await manager._fetchDetail('eper', 'VIN123', '7210E221', {});

      expect(getPackageDetailsPR).toHaveBeenCalledWith(
        expect.objectContaining({ codicePosizione: '', codicePosizioneGuida: '' })
      );
    });
  });

  // ── _fetchLiveMap (branch coverage diretto) ───────────────────────────────

  describe('_fetchLiveMap', () => {
    test('throws for unrecognized pkwstouse', async () => {
      const manager = new PkManager();
      await expect(manager._fetchLiveMap('unknown', 'VIN123'))
        .rejects.toThrow('pkwstouse non riconosciuto: "unknown"');
    });

    test('throws when pkwstouse is undefined (?? fallback branch)', async () => {
      const manager = new PkManager();
      await expect(manager._fetchLiveMap(undefined, 'VIN123'))
        .rejects.toThrow('pkwstouse non riconosciuto: "undefined"');
    });
  });

  // ── parseEperRes ───────────────────────────────────────────────────────────

  describe('parseEperRes', () => {
    test('normalizes operazioni, ricambi e materiali in un unico contratto', () => {
      const manager = new PkManager();
      const result = manager.parseEperRes({
        codice: 'PK1',
        descrizione: 'Pacchetto uno',
        listaOperazioni: { operazione: { codice: 'OP1', descrizione: 'Op uno', tempo: '1.0' } },
        listaRicambi: { ricambio: { posizione: '1', codice: 'SP1', descrizione: 'Ricambio uno', quantita: '1', prezzo: '5' } },
        listaMateriali: { materiale: { codice: 'MAT1', descrizione: 'Materiale uno', quantita: '3', codSigi: 'SIGI1' } },
      });

      expect(result.codice).toBe('PK1');
      expect(result.descrizione).toBe('Pacchetto uno');
      expect(result.isFixedPrice).toBe('0');
      expect(result.packageType).toBe('QE');
      expect(result.listaOperazioni).toEqual([
        { TYPE: 'OP', POSIZIONE: '', COD: 'OP1', DESCR: 'Op uno', AV_LOCAL: 0, SCONTO: 0, TIME: '1.0', QTY: '', PRICE: '', CODSIGI: '' },
      ]);
      expect(result.listaRicambi).toEqual([
        { TYPE: 'SP', POSIZIONE: '1', COD: 'SP1', DESCR: 'Ricambio uno', AV_LOCAL: 0, SCONTO: 0, TIME: '', QTY: '1', PRICE: '5', CODSIGI: '' },
        { TYPE: 'SP', POSIZIONE: '', COD: 'MAT1', DESCR: 'Materiale uno', AV_LOCAL: 0, SCONTO: 0, TIME: '', QTY: '3', PRICE: '0', CODSIGI: 'SIGI1' },
      ]);
    });

    test('throws when pkRes contains an error node', () => {
      const manager = new PkManager();
      expect(() => manager.parseEperRes({ error: { errorMessage: 'boom' } })).toThrow('boom');
    });

    test('throws default message when error node has no errorMessage', () => {
      const manager = new PkManager();
      expect(() => manager.parseEperRes({ error: {} })).toThrow('eper: errore sconosciuto');
    });
  });

  // ── parseMenupricingRes ────────────────────────────────────────────────────

  describe('parseMenupricingRes', () => {
    test('keeps AV_LOCAL/SCONTO, strips AV_DISTRIGO/AV_CENTRAL and applies defaults', () => {
      const manager = new PkManager();
      const result = manager.parseMenupricingRes({
        success: true,
        data: {
          codice: 'MP1',
          descrizione: 'Job uno',
          listaOperazioni: [{ COD: 'OP1', AV_LOCAL: 1, SCONTO: 5, AV_DISTRIGO: 2, AV_CENTRAL: 3 }],
          listaRicambi: [{ COD: 'SP1', AV_LOCAL: 1, SCONTO: 5, AV_DISTRIGO: 2, AV_CENTRAL: 3 }],
        },
      });

      expect(result.result).toBe(true);
      expect(result.codice).toBe('MP1');
      expect(result.pkPrice).toBe(0);
      expect(result.isFixedPrice).toBe('0');
      expect(result.packageType).toBe('QE');
      expect(result.listaOperazioni).toEqual([{ COD: 'OP1', AV_LOCAL: 1, SCONTO: 5 }]);
      expect(result.listaRicambi).toEqual([{ COD: 'SP1', AV_LOCAL: 1, SCONTO: 5 }]);
    });

    test('throws when success is false', () => {
      const manager = new PkManager();
      expect(() => manager.parseMenupricingRes({ success: false, message: 'boom' })).toThrow('boom');
    });

    test('throws default message when success is false and message is missing', () => {
      const manager = new PkManager();
      expect(() => manager.parseMenupricingRes({ success: false })).toThrow('menupricing: errore sconosciuto');
    });
  });

  // ── parseDocSoaRes ─────────────────────────────────────────────────────────

  describe('parseDocSoaRes', () => {
    test('parses a forfait with mo/pr singoli', () => {
      const manager = new PkManager();
      const result = manager.parseDocSoaRes({
        data: {
          forfait: {
            ref_fo: 'FO1',
            lib: 'Forfait uno',
            prix: 42,
            niveau: '1',
            tp: {
              details: {
                mos: { mo: { ref: 'MO1', lib_trad: 'Mo uno', moappl: { temps: '1.0' } } },
                prs: { enspr: { ref: 'GRP1', pr: { ref: 'PR1', lib_trad: 'Pr uno', selected: 'true', prappl: { quantite: '2' } } } },
              },
            },
          },
        },
      }, true);

      expect(result.result).toBe(true);
      expect(result.codice).toBe('FO1');
      expect(result.descrizione).toBe('Forfait uno');
      expect(result.pkPrice).toBe(42);
      expect(result.isFixedPrice).toBe('1');
      expect(result.packageType).toBe('FP');
      expect(result.listaOperazioni).toHaveLength(1);
      expect(result.listaOperazioni[0]).toMatchObject({ TYPE: 'OP', COD: 'MO1' });
      expect(result.listaRicambi).toHaveLength(1);
      expect(result.listaRicambi[0]).toMatchObject({ TYPE: 'SP', COD: 'PR1' });
    });

    test('parses a singolo tp (isForfait=false) senza mo/pr', () => {
      const manager = new PkManager();
      const result = manager.parseDocSoaRes({
        data: { tp: { ref: 'TP1', titre_trad: 'Tp uno', details: {} } },
      }, false);

      expect(result.result).toBe(true);
      expect(result.codice).toBe('TP1');
      expect(result.descrizione).toBe('Tp uno');
      expect(result.pkPrice).toBe(0);
      expect(result.isFixedPrice).toBe('0');
      expect(result.packageType).toBe('QE');
      expect(result.listaOperazioni).toBeUndefined();
      expect(result.listaRicambi).toBeUndefined();
    });

    test('parses array di mo, gruppi enspr con ricambi alternativi e ricambi generici', () => {
      const manager = new PkManager();
      const result = manager.parseDocSoaRes({
        data: {
          forfait: {
            ref_fo: 'FO2',
            lib: 'Forfait due',
            prix: 10,
            niveau: '2',
            tp: {
              details: {
                mos: {
                  mo: [
                    { ref: 'MO1', lib_trad: 'Mo uno', moappl: { temps: '1.0' } },
                    { ref: 'MO2', lib_trad: 'Mo due', moappl: { temps: '2.0' } },
                  ],
                },
                prs: {
                  enspr: [
                    { pr: { ref: 'PR1', lib_trad: 'Pr uno', selected: 'true', prappl: { quantite: '1' } } },
                    { pr: [
                      { ref: 'PR2', lib_trad: 'Pr due alt1', selected: 'true', prappl: { quantite: '1' } },
                      { ref: 'PR3', lib_trad: 'Pr due alt2', selected: 'false', prappl: { quantite: '1' } },
                    ] },
                  ],
                },
                pgs: {
                  enspg: [
                    { pg: { ref: 'PG1', lib_trad: 'Pg uno', selected: '1', pgappl: { quantite: '1' } } },
                  ],
                },
              },
            },
          },
        },
      }, true);

      expect(result.listaOperazioni).toHaveLength(2);
      expect(result.listaOperazioni.map((o) => o.COD)).toEqual(['MO1', 'MO2']);

      // 1 pr singolo + 2 alternativi (stessa posizione) + 1 ricambio generico
      expect(result.listaRicambi).toHaveLength(4);
      expect(result.listaRicambi.map((r) => r.COD)).toEqual(['PR1', 'PR2', 'PR3', 'PG1']);
      expect(result.listaRicambi[1].POSIZIONE).toBe(result.listaRicambi[2].POSIZIONE);
    });

    test('parses ricambi generici come pg singolo quando listaRicambi è assente', () => {
      const manager = new PkManager();
      const result = manager.parseDocSoaRes({
        data: {
          forfait: {
            ref_fo: 'FO3',
            lib: 'Forfait tre',
            prix: 0,
            niveau: '1',
            tp: {
              details: {
                pgs: { enspg: { ref: 'ENSPG1', pg: { ref: 'PG1', lib_trad: 'Pg uno', pgappl: { quantite: '1' } } } },
              },
            },
          },
        },
      }, true);

      expect(result.listaRicambi).toHaveLength(1);
      expect(result.listaRicambi[0]).toMatchObject({ TYPE: 'SP', COD: 'PG1' });
    });

    test('parses enspr singolo record con più pr (array) senza ref sul singolo pr', () => {
      const manager = new PkManager();
      const result = manager.parseDocSoaRes({
        data: {
          forfait: {
            ref_fo: 'FO4',
            lib: 'Forfait quattro',
            prix: 0,
            niveau: '1',
            tp: {
              details: {
                prs: {
                  enspr: {
                    ref: 'ENSPR1',
                    pr: [
                      { ref: 'PR1', lib_trad: 'Pr uno', selected: 'true', prappl: { quantite: '1' } },
                      { ref: 'PR2', lib_trad: 'Pr due', selected: 'false', prappl: { quantite: '2' } },
                    ],
                  },
                },
              },
            },
          },
        },
      }, true);

      expect(result.listaRicambi).toHaveLength(2);
      expect(result.listaRicambi.map((r) => r.COD)).toEqual(['PR1', 'PR2']);
    });

    test('skips enspr group entries without pr (continue branch)', () => {
      const manager = new PkManager();
      const result = manager.parseDocSoaRes({
        data: {
          forfait: {
            ref_fo: 'FO6',
            lib: 'Forfait sei',
            prix: 0,
            niveau: '1',
            tp: {
              details: {
                prs: {
                  enspr: [
                    {}, // gruppo senza pr => continue
                    { pr: { ref: 'PR1', lib_trad: 'Pr uno', selected: 'true', prappl: { quantite: '1' } } },
                  ],
                },
              },
            },
          },
        },
      }, true);

      expect(result.listaRicambi).toHaveLength(1);
      expect(result.listaRicambi[0]).toMatchObject({ COD: 'PR1' });
    });

    test('skips ricambi generici block when pgs.enspg is entirely absent', () => {
      const manager = new PkManager();
      const result = manager.parseDocSoaRes({
        data: {
          forfait: {
            ref_fo: 'FO7',
            lib: 'Forfait sette',
            prix: 0,
            niveau: '1',
            tp: { details: { pgs: {} } },
          },
        },
      }, true);

      expect(result.listaRicambi).toEqual([]);
    });
  });

  // ── getPriceAndAvailability ────────────────────────────────────────────────

  describe('getPriceAndAvailability', () => {
    test('builds simplified workLines from pkDetailList and posts the DML inquiry', async () => {
      const manager = new PkManager();
      manager.pkDetailList = [
        {
          codice: 'PK1',
          listaOperazioni: [{ COD: 'OP1' }],
          listaRicambi: [{ COD: 'SP1' }],
        },
      ];

      getBearerToken.mockResolvedValue('TOKEN123');
      postDmsInquiry.mockResolvedValue({ success: true });

      const result = await manager.getPriceAndAvailability('DOC1', 'CUST1', 'VIN123');

      expect(result).toEqual({ success: true });
      expect(getBearerToken).toHaveBeenCalled();
      expect(postDmsInquiry).toHaveBeenCalledWith('TOKEN123', expect.objectContaining({
        PartsInquiryHeader: expect.objectContaining({
          DocumentID: 'DOC1',
          CustomerIdDms: 'CUST1',
          MessageType: 'WL',
          VehicleID: 'VIN123',
        }),
        customerAccountDmsId: null,
        workLines: [
          {
            workLineReference: 'PK1',
            partNumbers: ['SP1'],
            laborOperationIds: ['OP1'],
          },
        ],
      }));
    });

    test('uses padded index as workLineReference when codice is missing', async () => {
      const manager = new PkManager();
      manager.pkDetailList = [{ listaOperazioni: [], listaRicambi: [] }];

      getBearerToken.mockResolvedValue('TOKEN123');
      postDmsInquiry.mockResolvedValue({ success: true });

      await manager.getPriceAndAvailability('DOC1', 'CUST1', 'VIN123');

      expect(postDmsInquiry).toHaveBeenCalledWith('TOKEN123', expect.objectContaining({
        workLines: [expect.objectContaining({ workLineReference: '001' })],
      }));
    });

    test('does not build ApplicationArea itself: the envelope is left to the dms lambda', async () => {
      const manager = new PkManager();
      manager.pkDetailList = [{ listaOperazioni: [], listaRicambi: [] }];

      getBearerToken.mockResolvedValue('TOKEN123');
      postDmsInquiry.mockResolvedValue({ success: true });

      await manager.getPriceAndAvailability('DOC1', 'CUST1', 'VIN123');

      const [, body] = postDmsInquiry.mock.calls[0];
      expect(body.ApplicationArea).toBeUndefined();
    });

    test('does not build the nested DML WorkLines structure itself: that is left to the dms lambda', async () => {
      const manager = new PkManager();
      manager.pkDetailList = [{ codice: 'PK1', listaOperazioni: [{ COD: 'OP1' }], listaRicambi: [{ COD: 'SP1' }] }];

      getBearerToken.mockResolvedValue('TOKEN123');
      postDmsInquiry.mockResolvedValue({ success: true });

      await manager.getPriceAndAvailability('DOC1', 'CUST1', 'VIN123');

      const [, body] = postDmsInquiry.mock.calls[0];
      expect(body.WorkLines).toBeUndefined();
    });

    test('builds a dynamic sender from wsConfig (dealer/brand/mercato reali) instead of the static dms env defaults', async () => {
      const manager = new PkManager({
        eper: { coddealer: 'EPER-DEALER' },
        docsoa: { codbrand: 'FT', pays: 'IT', langue: 'it', codePdv: 'SITE001' },
        menupricing: { dealerIdentificationCode: 'MP-DEALER', countryCode: 'IT', languageCode: 'it-IT' },
      });
      manager.pkDetailList = [{ listaOperazioni: [], listaRicambi: [] }];

      getBearerToken.mockResolvedValue('TOKEN123');
      postDmsInquiry.mockResolvedValue({ success: true });

      await manager.getPriceAndAvailability('DOC1', 'CUST1', 'VIN123');

      const [, body] = postDmsInquiry.mock.calls[0];
      expect(body.sender).toEqual({
        dealerNumberId: 'MP-DEALER',
        dealerNumberIdSource: 'MP-DEALER',
        dealerCountryCode: 'IT',
        languageCode: 'it-IT',
        physicalSiteId: 'SITE001',
        brand: 'FT',
      });
    });

    test('sender falls back to eper.coddealer/docsoa fields when menupricing overrides are absent', async () => {
      const manager = new PkManager({
        eper: { coddealer: 'EPER-DEALER' },
        docsoa: { codbrand: 'AP', pays: 'DE', langue: 'de', codePdv: 'SITE002' },
        menupricing: { dealerIdentificationCode: undefined, countryCode: undefined, languageCode: undefined },
      });
      manager.pkDetailList = [{ listaOperazioni: [], listaRicambi: [] }];

      getBearerToken.mockResolvedValue('TOKEN123');
      postDmsInquiry.mockResolvedValue({ success: true });

      await manager.getPriceAndAvailability('DOC1', 'CUST1', 'VIN123');

      const [, body] = postDmsInquiry.mock.calls[0];
      expect(body.sender).toEqual({
        dealerNumberId: 'EPER-DEALER',
        dealerNumberIdSource: 'EPER-DEALER',
        dealerCountryCode: 'DE',
        languageCode: 'de',
        physicalSiteId: 'SITE002',
        brand: 'AP',
      });
    });
  });

  // ── getPkList ──────────────────────────────────────────────────────────────

  describe('getPkList', () => {
    test('resolves pkwstouse via dbManager.getPkwstouse(pool, { codmarket, codbrand }) before fetching the detail', async () => {
      const manager = new PkManager();
      getPkwstouse.mockResolvedValue('menupricing'); // diverso da codbrand, per provare che il valore risolto è quello realmente usato

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [];
        return {};
      });
      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({});

      await manager.getPkList('FIAT', 'DOC1', 'CUST1', 'VIN123', '1000');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(getPkwstouse).toHaveBeenCalledWith({}, { codmarket: '1000', codbrand: 'FIAT' });
      expect(manager.getValidPackagesDetail).toHaveBeenCalledWith('1000', 'menupricing', 'VIN123');
    });

    test('orchestrates detail => price/availability => merges AV_LOCAL/PRICE/SCONTO into pkDetailList', async () => {
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [
          {
            codice: 'PK1',
            listaOperazioni: [{ TYPE: 'OP', COD: 'OP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 }],
            listaRicambi: [
              { TYPE: 'SP', COD: 'SP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 },
              { TYPE: 'SP', COD: 'SP-NOTFOUND', PRICE: '', AV_LOCAL: 0, SCONTO: 0 },
            ],
          },
        ];
        return {};
      });

      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({
        WorkLines: [
          {
            WorkLineReference: 'PK1',
            PartsItem: [
              { PartNumber: 'SP1', OriginalPriceExclVAT: 12.5, DiscountPercentage: 10, BinLocation: [{ QuantityAvailable: 3 }] },
            ],
            LaborItems: [
              { LaborOperationID: 'OP1', OriginalPriceExclVAT: 45, DiscountPercentage: 5, QuantityAvailable: 1 },
            ],
          },
        ],
      });

      const result = await manager.getPkList('eper', 'DOC1', 'CUST1', 'VIN123', '1000');

      expect(manager.getValidPackagesDetail).toHaveBeenCalledWith('1000', 'eper', 'VIN123');
      expect(manager.getPriceAndAvailability).toHaveBeenCalledWith('DOC1', 'CUST1', 'VIN123');

      const [pkDetail] = result;
      expect(pkDetail.listaRicambi[0]).toMatchObject({ COD: 'SP1', AV_LOCAL: 3, PRICE: 12.5, SCONTO: 10 });
      // codice non trovato tra le PartsItem => resta invariato
      expect(pkDetail.listaRicambi[1]).toMatchObject({ COD: 'SP-NOTFOUND', AV_LOCAL: 0, PRICE: '', SCONTO: 0 });
      expect(pkDetail.listaOperazioni[0]).toMatchObject({ COD: 'OP1', AV_LOCAL: 1, PRICE: 45, SCONTO: 5 });
      expect(result).toBe(manager.pkDetailList);
    });

    test('leaves pkDetailList untouched when no WorkLines are returned', async () => {
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [
          { codice: 'PK1', listaOperazioni: [{ TYPE: 'OP', COD: 'OP1' }], listaRicambi: [{ TYPE: 'SP', COD: 'SP1' }] },
        ];
        return {};
      });
      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({ success: false, message: 'boom' });

      const result = await manager.getPkList('eper', 'DOC1', 'CUST1', 'VIN123');

      expect(result[0].listaOperazioni[0]).toEqual({ TYPE: 'OP', COD: 'OP1' });
      expect(result[0].listaRicambi[0]).toEqual({ TYPE: 'SP', COD: 'SP1' });
    });

    test('skips rows without PartNumber/LaborOperationID and rows with non-matching TYPE', async () => {
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [
          {
            codice: 'PK1',
            // TYPE non corrispondente => la condizione row?.TYPE === 'SP'/'OP' è falsa
            listaRicambi: [{ TYPE: 'OP', COD: 'SP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 }],
            listaOperazioni: [{ TYPE: 'SP', COD: 'OP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 }],
          },
        ];
        return {};
      });

      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({
        WorkLines: [
          {
            WorkLineReference: 'PK1',
            // riga senza PartNumber => continue
            PartsItem: [{ OriginalPriceExclVAT: 1 }, { PartNumber: 'SP1', OriginalPriceExclVAT: 12.5 }],
            // riga senza LaborOperationID => continue
            LaborItems: [{ OriginalPriceExclVAT: 2 }, { LaborOperationID: 'OP1', OriginalPriceExclVAT: 45 }],
          },
        ],
      });

      const result = await manager.getPkList('eper', 'DOC1', 'CUST1', 'VIN123');

      // TYPE non corrisponde => nessun arricchimento applicato
      expect(result[0].listaRicambi[0]).toEqual({ TYPE: 'OP', COD: 'SP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 });
      expect(result[0].listaOperazioni[0]).toEqual({ TYPE: 'SP', COD: 'OP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 });
    });

    test('does not bleed AV_LOCAL/PRICE/SCONTO between different packages sharing the same COD', async () => {
      // Regressione: due pacchetti diversi (PK1/PK2) condividono lo stesso
      // ricambio SP1 con disponibilità/prezzo differenti nella rispettiva
      // WorkLine (matchata per WorkLineReference == codice pacchetto). Prima
      // della fix, una mappa globale PartNumber → dati sovrascriveva il
      // valore per SP1 usando l'ultima WorkLine processata, "bleedando" lo
      // stesso valore (sbagliato, e non deterministico rispetto all'ordine
      // delle WorkLines) su entrambi i pacchetti.
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [
          { codice: 'PK1', listaOperazioni: [], listaRicambi: [{ TYPE: 'SP', COD: 'SP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 }] },
          { codice: 'PK2', listaOperazioni: [], listaRicambi: [{ TYPE: 'SP', COD: 'SP1', PRICE: '', AV_LOCAL: 0, SCONTO: 0 }] },
        ];
        return {};
      });

      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({
        WorkLines: [
          { WorkLineReference: 'PK1', PartsItem: [{ PartNumber: 'SP1', OriginalPriceExclVAT: 10, DiscountPercentage: 0, BinLocation: [{ QuantityAvailable: 1 }] }] },
          { WorkLineReference: 'PK2', PartsItem: [{ PartNumber: 'SP1', OriginalPriceExclVAT: 99, DiscountPercentage: 20, BinLocation: [{ QuantityAvailable: 5 }] }] },
        ],
      });

      const result = await manager.getPkList('eper', 'DOC1', 'CUST1', 'VIN123');

      expect(result[0].listaRicambi[0]).toMatchObject({ AV_LOCAL: 1, PRICE: 10, SCONTO: 0 });
      expect(result[1].listaRicambi[0]).toMatchObject({ AV_LOCAL: 5, PRICE: 99, SCONTO: 20 });
    });

    test('overrides wsConfig.menupricing.dealerIdentificationCode when provided', async () => {
      process.env.MP_DEALER_IDENTIFICATION_CODE = 'DID-ENV';
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        // Verifica che l'override sia già applicato PRIMA della valorizzazione
        // del dettaglio pacchetti, dato che _fetchLiveMap/_fetchDetail leggono
        // this.wsConfig.menupricing internamente.
        expect(manager.wsConfig.menupricing.dealerIdentificationCode).toBe('DID-OVERRIDE');
        manager.pkDetailList = [];
        return {};
      });
      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({});

      await manager.getPkList('menupricing', 'DOC1', 'CUST1', 'VIN123', '1000', 'DID-OVERRIDE');

      expect(manager.wsConfig.menupricing.dealerIdentificationCode).toBe('DID-OVERRIDE');
    });

    test('keeps the default wsConfig.menupricing.dealerIdentificationCode when not provided', async () => {
      process.env.MP_DEALER_IDENTIFICATION_CODE = 'DID-ENV';
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [];
        return {};
      });
      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({});

      await manager.getPkList('menupricing', 'DOC1', 'CUST1', 'VIN123', '1000');

      expect(manager.wsConfig.menupricing.dealerIdentificationCode).toBe('DID-ENV');
    });

    // Regressione: le 3 fonti (eper/docsoa/menupricing) devono produrre lo
    // stesso set di chiavi in getPkList, anche quando i rispettivi parse*Res
    // omettono dei campi (es. DocSOA non valorizza affatto codice/descrizione/
    // listaOperazioni/listaRicambi quando né il forfait né la tp vengono trovati).
    test('normalizes every package to the same shape regardless of pkwstouse (docsoa not-found case)', async () => {
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        // Simula l'output "vuoto" di parseDocSoaRes quando né forfait né tp
        // vengono trovati: codice/descrizione/listaOperazioni/listaRicambi sono
        // undefined (non presenti sull'oggetto).
        manager.pkDetailList = [
          { result: true, pkPrice: 0, niveau: null, isFixedPrice: '0', packageType: 'QE', category: 'ACCESSORIES' },
        ];
        return {};
      });
      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({});

      const result = await manager.getPkList('docsoa', 'DOC1', 'CUST1', 'VIN123');

      expect(result).toEqual([
        {
          result: true,
          codice: null,
          descrizione: null,
          pkPrice: 0,
          isFixedPrice: '0',
          packageType: 'QE',
          niveau: null,
          listaOperazioni: [],
          listaRicambi: [],
          category: 'ACCESSORIES',
        },
      ]);
    });

    test('normalizes an eper package (no niveau/pkPrice/result natively) to the same shape', async () => {
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [
          {
            codice: '7210E221',
            descrizione: 'Pacchetto test',
            isFixedPrice: '0',
            packageType: 'QE',
            listaOperazioni: [{ TYPE: 'OP', COD: 'OP1' }],
            listaRicambi: [{ TYPE: 'SP', COD: 'SP1' }],
            category: 'BODY',
          },
        ];
        return {};
      });
      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({});

      const result = await manager.getPkList('eper', 'DOC1', 'CUST1', 'VIN123');

      expect(Object.keys(result[0])).toEqual([
        'result', 'codice', 'descrizione', 'pkPrice', 'isFixedPrice',
        'packageType', 'niveau', 'listaOperazioni', 'listaRicambi', 'category',
      ]);
      expect(result[0]).toMatchObject({ result: true, codice: '7210E221', pkPrice: 0, niveau: null });
    });

    test('leaves single-package fetch errors ({ error, category }) untouched by normalization', async () => {
      const manager = new PkManager();

      jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
        manager.pkDetailList = [{ error: 'detail failed', category: 'ACCESSORIES' }];
        return {};
      });
      jest.spyOn(manager, 'getPriceAndAvailability').mockResolvedValue({});

      const result = await manager.getPkList('docsoa', 'DOC1', 'CUST1', 'VIN123');

      expect(result).toEqual([{ error: 'detail failed', category: 'ACCESSORIES' }]);
    });
  });
});
