'use strict';

jest.mock('../../../serviceClient', () => ({ callService: jest.fn() }), { virtual: true });

const { callService } = require('../../../serviceClient');
const { MyPeopleDmsSessionRepository } = require('../../src/repositories/myPeopleDmsSessionRepository');

describe('MyPeopleDmsSessionRepository — trasporto REST lazy', () => {
  let results;
  let repository;
  let errorSpy;

  beforeEach(() => {
    results = {
      readUserProfiles: {
        Response: {
          RC: '0', STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [{ CODE: '00007584', MARKET: '1000', BRANDS: '00,77,83', MAIN: 'Y' }],
          },
        },
      },
      getDmsSettings: { success: true, data: [] },
      getDmlConfiguration: { companyTypes: [], customerTitles: [] },
      registerDealer: undefined,
      getCountryIsoCode: 'IT',
      getPhysicalSiteAndPdvId: { physicalSiteId: 'PS001', dealerArcadCode: 'DLR001' },
      getBrandsByOics: [],
      getDisabledOics: [],
      getEnableSignatureByOics: [['1000|00007584', true]],
      getAddressByOics: [['00007584', { address: 'Via Roma', zipcode: '00100', city: 'Roma' }]],
      getBrandLogos: { '00': 'assets/FIAT.png', 83: 'assets/ALFAROMEO.png' },
    };
    callService.mockReset().mockImplementation(async (_, operation) => results[operation]);
    repository = new MyPeopleDmsSessionRepository();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => errorSpy.mockRestore());

  test('usa i nomi receiver e gli argomenti originali, senza pool', async () => {
    const data = await repository.getSessionData('0073741.d235');
    const expected = [
      ['mypeople', 'readUserProfiles', { args: [{ username: '0073741.d235' }] }],
      ['dmlconfigsync', 'getDmsSettings', { args: [{ country: 'IT', brand: 'FT', dealer: '0073741' }] }],
      ['dmlconfigsync', 'getDmlConfiguration', { args: [{ country: 'it', language: 'it' }] }],
      ['dbmanager', 'getCountryIsoCode', { args: [{ market: '1000' }] }],
      ['dbmanager', 'getPhysicalSiteAndPdvId', { args: [{ mainSincom: '0073741', market: '1000', brand: 'FT', oic: '00007584' }] }],
      ['dbmanager', 'getBrandsByOics', { args: [{ oics: ['00007584'] }] }],
      ['dbmanager', 'getDisabledOics', { args: [[{ market: '1000', oic: '00007584' }]] }],
      ['dbmanager', 'getEnableSignatureByOics', { args: [[{ market: '1000', oic: '00007584' }]] }],
      ['dbmanager', 'getAddressByOics', { args: [{ oics: ['00007584'] }] }],
      ['dbmanager', 'getBrandLogos', { args: [{ codes: ['00', '77', '83'] }] }],
    ];
    expect(callService.mock.calls).toEqual(expected);
    expect(data).toMatchObject({
      codmarket: '1000', marketIso: 'IT', sincom: '0073741', brandvehic_reftech: 'FT',
      isdml: true, companytypes: [], customertitles: [], physicalsite: 'PS001', pdvId: 'DLR001',
      oics: [{
        code: '00007584', market: '1000', brands: '00,77,83',
        brandLogos: ['assets/FIAT.png', 'assets/ALFAROMEO.png'],
        main: 'Y', djcListParameter: '1000_00007584', feaEnabled: true,
        address: 'Via Roma', zipcode: '00100', city: 'Roma',
      }],
    });
  });

  test('cache-miss registra il dealer prima di completare, conservando i default', async () => {
    results.getDmsSettings = null;
    let release;
    const registration = new Promise((resolve) => { release = resolve; });
    callService.mockImplementation(async (_, operation) => operation === 'registerDealer'
      ? registration : results[operation]);
    let completed = false;
    const pending = repository.getSessionData('0073741.d235').then((value) => { completed = true; return value; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    expect(callService).toHaveBeenCalledWith('dmlconfigsync', 'registerDealer', {
      args: [{ country: 'IT', brand: 'FT', dealer: '0073741' }],
    });

    release();
    expect(await pending).toMatchObject({ isdml: false, dmlcustomerupdate: null, dmldiscount: null });
  });

  test('ricostruisce Map e Set dagli array JSON del receiver', async () => {
    results.getBrandsByOics = [['00007584', ['83', '00']]];
    results.getDisabledOics = ['1000|disabled'];
    results.readUserProfiles.Response.User.OICs.push({
      CODE: 'disabled', MARKET: '1000', BRANDS: '77', MAIN: 'N',
    });
    callService.mockImplementation(async (_, operation) => {
      const value = results[operation];
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.oics).toHaveLength(1);
    expect(data.oics[0]).toMatchObject({
      code: '00007584', brands: '83,00',
      brandLogos: ['assets/ALFAROMEO.png', 'assets/FIAT.png'],
      feaEnabled: true, address: 'Via Roma', zipcode: '00100', city: 'Roma',
    });
    expect(callService).toHaveBeenCalledWith('dbmanager', 'getBrandLogos', {
      args: [{ codes: ['83', '00'] }],
    });
  });

  test('errori di registrazione restano intenzionalmente best-effort e loggati', async () => {
    results.getDmsSettings = null;
    callService.mockImplementation(async (_, operation) => {
      if (operation === 'registerDealer') throw new Error('HTTP 503');
      return results[operation];
    });
    expect(await repository.getSessionData('0073741.d235')).toMatchObject({ isdml: false });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('registrazione dealer dms/settings'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
  });

  test.each([
    ['getDmsSettings', { isdml: false, dmlcustomerupdate: null, dmldiscount: null }],
    ['getDmlConfiguration', { companytypes: [], customertitles: [] }],
    ['getCountryIsoCode', { marketIso: null }],
    ['getPhysicalSiteAndPdvId', { physicalsite: null, pdvId: null }],
    ['getBrandsByOics', { oics: [expect.objectContaining({ brands: '00,77,83' })] }],
    ['getDisabledOics', { oics: [expect.objectContaining({ code: '00007584' })] }],
    ['getEnableSignatureByOics', { oics: [expect.objectContaining({ feaEnabled: false })] }],
    ['getAddressByOics', { oics: [expect.objectContaining({ address: null, zipcode: null, city: null })] }],
    ['getBrandLogos', { oics: [expect.objectContaining({ brandLogos: [] })] }],
  ])('%s conserva degradazione intenzionale e log su rifiuto HTTP', async (failed, defaults) => {
    callService.mockImplementation(async (_, operation) => {
      if (operation === failed) throw new Error('HTTP 502');
      return results[operation];
    });
    expect(await repository.getSessionData('0073741.d235')).toMatchObject(defaults);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 502'));
    if (failed === 'getDmsSettings') {
      expect(callService.mock.calls.some(([, operation]) => operation === 'registerDealer')).toBe(false);
    }
  });

  test('errori myPeople non vengono nascosti o trasformati in sessione vuota', async () => {
    callService.mockRejectedValue(new Error('HTTP 503'));
    await expect(repository.getSessionData('0073741.d235')).rejects.toThrow('HTTP 503');
    expect(callService.mock.calls).toEqual([
      ['mypeople', 'readUserProfiles', { args: [{ username: '0073741.d235' }] }],
    ]);
  });

  test('riutilizza gli adapter lazy ma esegue le chiamate su ogni richiesta', async () => {
    await repository.getSessionData('0073741.d235');
    await repository.getSessionData('0073741.d235');
    expect(callService.mock.calls.filter(([service]) => service === 'mypeople')).toHaveLength(2);
  });
});
