'use strict';

jest.mock('../../serviceClient', () => ({ callService: jest.fn() }));
const { callService } = require('../../serviceClient');
const { PkManager } = require('../PkManager');
const { handler } = require('../index');

const VIN = 'VF3CABHW6GT204366';
const wsConfig = {
  eper: { coddealer: 'dealer', codmarket: 'market', ticket: 'ticket', lingua: 'IT' },
  docsoa: { codbrand: 'AP', ldp: '', langue: 'FR', pays: 'FR', codePdv: 'pdv', typeInternet: null },
  menupricing: {
    languageCode: 'EN', countryCode: 'GB', dealerIdentificationCode: 'dealer', manufacturer: 'OPEL',
  },
};

describe('PkManager REST contracts', () => {
  beforeEach(() => {
    callService.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['eper', 'pkeper', 'getCompletePkEperList',
      { ticket: 'ticket', lingua: 'IT', vin: VIN },
      { coddealer: 'dealer', codmarket: 'market' }, { PK: {} }, { PK: {} }],
    ['menupricing', 'pkmenupricing', 'getCompletePkMpList',
      { vin: VIN, ...wsConfig.menupricing }, {}, { success: true, data: { PK: {} } }, { PK: {} }],
    ['docsoa', 'pkdocsoa', 'getCompletePkSOAList',
      { vin: VIN, ...wsConfig.docsoa }, {}, { success: true, data: [{ refAff: 'PK' }] }, { PK: { refAff: 'PK' } }],
  ])('%s live map sends exact REST method params and constructor config',
    async (ws, service, operation, params, config, response, expected) => {
      callService.mockResolvedValue(response);
      const manager = new PkManager(wsConfig);
      expect(await manager._fetchLiveMap(ws, VIN)).toEqual(expected);
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith(service, operation, { params, config });
    });

  test('eper details preserve position params, raw domain response and safe constructor config', async () => {
    const raw = { codice: 'PK', listaRicambi: { ricambio: { codice: 'PART' } } };
    callService.mockResolvedValue(raw);
    const manager = new PkManager({
      ...wsConfig,
      eper: { ...wsConfig.eper, clientSecret: 'never-forwarded' },
    });
    const result = await manager._fetchDetail('eper', VIN, 'PK', {
      $: { codicePosizione: 'POS', posizioneGuida: 'GUIDE' },
    });
    expect(result.listaRicambi[0].COD).toBe('PART');
    expect(callService).toHaveBeenCalledWith('pkeper', 'getPackageDetailsPR', {
      params: {
        ticket: 'ticket', lingua: 'IT', VIN, codicePacchetto: 'PK',
        codicePosizione: 'POS', codicePosizioneGuida: 'GUIDE',
      },
      config: { coddealer: 'dealer', codmarket: 'market' },
    });
  });

  test('menupricing details preserve the raw success/data domain envelope for parsing', async () => {
    callService.mockResolvedValue({ success: true, data: { codice: 'PK', isFixedPrice: '1' } });
    const result = await new PkManager(wsConfig)._fetchDetail('menupricing', VIN, 'PK');
    expect(result).toMatchObject({ codice: 'PK', packageType: 'FP' });
    expect(callService).toHaveBeenCalledWith('pkmenupricing', 'getJobDetails', {
      params: { ...wsConfig.menupricing, vin: VIN, id: 'PK' }, config: {},
    });
  });

  test.each([true, false])('docsoa details preserve forfait and TP fallback params (forfait=%s)', async (forfait) => {
    callService.mockResolvedValueOnce(forfait
      ? { success: true, data: { forfait: { ref_fo: 'PK' } } }
      : { success: true, data: {} });
    callService.mockResolvedValueOnce({ success: true, data: { tp: { ref: 'TP' } } });
    const result = await new PkManager(wsConfig)._fetchDetail('docsoa', VIN, 'PK', { ref: 'TECH' });
    const commonParams = {
      wmi: VIN.substring(0, 3), vds: VIN.substring(3, 9), vis: VIN.substring(9, 17),
      langue: 'FR', pays: 'FR', marque: 'AP', paysUser: 'FR', mode: 'MODE_XML', codePdv: 'pdv',
    };
    expect(callService).toHaveBeenNthCalledWith(1, 'pkdocsoa', 'ibxDetailForfaitService', {
      params: { ...commonParams, codeFF: 'PK' }, config: {},
    });
    expect(callService).toHaveBeenCalledTimes(forfait ? 1 : 2);
    if (!forfait) {
      expect(callService).toHaveBeenNthCalledWith(2, 'pkdocsoa', 'ibxDetailtpService', {
        params: { ...commonParams, refTp: 'TECH' }, config: {},
      });
    }
    expect(result.packageType).toBe(forfait ? 'FP' : 'QE');
  });

  test('DMS sender resolution and inquiry use domain bodies without an upstream token', async () => {
    const domain = { WorkLines: [] };
    callService.mockResolvedValueOnce({
      mainSincom: 'dealer', market: '1000', brand: 'AP', language: 'EN', dealerCountryCode: 'GB',
    }).mockResolvedValueOnce(domain);
    const manager = new PkManager(wsConfig);
    manager.pkDetailList = [{ codice: 'PK', listaRicambi: [{ COD: 'PART' }], listaOperazioni: [{ COD: 'OP' }] }];
    expect(await manager.getPriceAndAvailability('DOC', 'CUSTOMER', VIN, '1000', 'user')).toBe(domain);
    expect(callService).toHaveBeenNthCalledWith(1, 'dms', 'resolveSender', {
      context: { username: 'user', vin: VIN },
      overrides: {
        mainSincom: 'dealer', market: '1000', brand: 'AP', language: 'EN', dealerCountryCode: 'GB',
      },
    });
    expect(callService).toHaveBeenNthCalledWith(2, 'dms', 'inquiry', {
      PartsInquiryHeader: { DocumentID: 'DOC', CustomerIdDms: 'CUSTOMER', MessageType: 'WL', VehicleID: VIN },
      customerAccountDmsId: null,
      workLines: [{ workLineReference: 'PK', partNumbers: ['PART'], laborOperationIds: ['OP'] }],
      sender: {
        dealerNumberId: 'dealer', dealerNumberIdSource: 'dealer', dealerCountryCode: 'GB',
        languageCode: 'EN', physicalSiteId: 'pdv', brand: 'AP', market: '1000', serviceId: 'user',
      },
    });
  });

  test('remote configuration failure propagates unchanged', async () => {
    const error = new Error('dbmanager HTTP 503');
    callService.mockRejectedValue(error);
    await expect(new PkManager().getConfigPackages('eper')).rejects.toBe(error);
  });

  test.each(['eper', 'docsoa', 'menupricing'])('%s remote list failures propagate', async (ws) => {
    const error = new Error('REST transport unavailable');
    callService.mockRejectedValue(error);
    await expect(new PkManager(wsConfig)._fetchLiveMap(ws, VIN)).rejects.toBe(error);
  });

  test('remote detail failures remain per-package errors and other tasks complete', async () => {
    const manager = new PkManager(wsConfig);
    jest.spyOn(manager, 'getValidPackages').mockResolvedValue({ BODY: {
      BAD: { category: 'BODY' }, GOOD: { category: 'BODY' },
    } });
    callService.mockRejectedValueOnce(new Error('HTTP 504')).mockResolvedValueOnce({ codice: 'GOOD' });
    const result = await manager.getValidPackagesDetail('1000', 'eper', VIN);
    expect(result.BAD).toEqual({ error: 'HTTP 504', category: 'BODY' });
    expect(result.GOOD.codice).toBe('GOOD');
    expect(manager.pkDetailList).toHaveLength(2);
  });

  test('REST detail tasks obey the existing concurrency limit and retain order', async () => {
    const manager = new PkManager(wsConfig);
    const codes = ['P1', 'P2', 'P3', 'P4'];
    jest.spyOn(manager, 'getValidPackages').mockResolvedValue({
      BODY: Object.fromEntries(codes.map((code) => [code, { category: 'BODY' }])),
    });
    let active = 0;
    let maximum = 0;
    callService.mockImplementation(async (_service, _operation, { params }) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { codice: params.codicePacchetto };
    });
    const result = await manager.getValidPackagesDetail('1000', 'eper', VIN);
    expect(Object.keys(result)).toEqual(codes);
    expect(maximum).toBeLessThanOrEqual(Number(process.env.PK_DETAIL_FETCH_CONCURRENCY) || 1);
  });

  test('remote DMS failure in getPkList preserves packages and dmlWarning', async () => {
    const manager = new PkManager(wsConfig);
    jest.spyOn(manager, 'getValidPackagesDetail').mockImplementation(async () => {
      manager.pkDetailList = [{ codice: 'PK' }];
    });
    callService.mockResolvedValueOnce('eper').mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('DMS HTTP 502'));
    const result = await manager.getPkList('AP', 'DOC', 'CUSTOMER', VIN);
    expect(callService).toHaveBeenNthCalledWith(1, 'dbmanager', 'getPkwstouse', {
      args: [{ codmarket: '1000', codbrand: 'AP' }],
    });
    expect(result[0].codice).toBe('PK');
    expect(manager.dmlWarning).toBe('DMS HTTP 502');
  });

  test.each([
    [{ authorizer: { sub: 'authenticated' } }, 'authenticated'],
    [{ authorizer: {} }, null],
    [{ authorizer: null }, null],
    [{}, 'body-user'],
    [undefined, 'body-user'],
  ])('handler never falls back to body identity with an authorizer (%j)', async (requestContext, expectedUsername) => {
    const detail = jest.spyOn(PkManager.prototype, 'getValidPackagesDetail').mockResolvedValue({});
    const price = jest.spyOn(PkManager.prototype, 'getPriceAndAvailability').mockResolvedValue({});
    const result = await handler({
      action: 'getPriceAndAvailability',
      requestContext,
      body: { username: 'body-user', VIN, market: '1000', pkwstouse: 'eper', documentId: 'DOC', customerId: 'CUSTOMER' },
    });
    expect(result.statusCode).toBe(200);
    expect(detail).toHaveBeenCalled();
    expect(price).toHaveBeenCalledWith('DOC', 'CUSTOMER', VIN, '1000', expectedUsername);
    expect(callService).not.toHaveBeenCalled();
  });
});
