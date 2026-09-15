'use strict';

// Verifica che, in assenza di override iniettati nel costruttore, la repository
// carichi (lazy) i moduli reali di myPeople/dmlConfigSync tramite require(path.resolve(...)),
// esattamente come farebbe in produzione (Lambda con SessionFunction impacchettata
// con myPeople/ e dmlConfigSync/ come cartelle sorelle — vedi Makefile). I moduli reali
// vengono qui sostituiti con dei mock (stesso percorso relativo, stessa profondità
// di cartelle di src/repositories/myPeopleDmsSessionRepository.js rispetto alla
// root del repo) per non dipendere da AWS/Secrets Manager/rete in questo test.
jest.mock('../../../myPeople/myPeopleService', () => ({
  readUserProfiles: jest.fn().mockResolvedValue({
    Response: {
      RC: '0',
      STATUS: 'SUCCESS',
      User: {
        Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
        OICs: [{ CODE: '00007584', BRANDS: '00,77,66,57,70,83', MAIN: 'Y' }],
      },
    },
  }),
}));

jest.mock('../../../dmlConfigSync/db', () => ({
  getPool: jest.fn().mockResolvedValue({
    __fakePool: true,
    query: jest.fn().mockResolvedValue({
      rows: [
        { codbrand: '00', logo_s3_key: 'assets/images/logo/brand-stla/FIAT.png' },
        { codbrand: '83', logo_s3_key: 'assets/images/logo/brand-stla/ALFAROMEO.png' },
        { codbrand: '77', logo_s3_key: null }, // riga presente ma senza logo: deve essere scartata
      ],
    }),
  }),
}));

jest.mock('../../../dmlConfigSync/DmlConfigRepository', () => ({
  getDmlConfiguration: jest.fn().mockResolvedValue({ companyTypes: [], customerTitles: [] }),
}));

jest.mock('../../../dmlConfigSync/DmsSettingsRepository', () => ({
  getDmsSettings: jest.fn().mockResolvedValue({ success: true, data: [] }),
  registerDealer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../dbManager/db', () => ({
  getPool: jest.fn().mockResolvedValue({ __fakeDbManagerPool: true, query: jest.fn() }),
}));

jest.mock('../../../dbManager/AnagSnowflakesRepository', () => ({
  getCountryIsoCode: jest.fn().mockResolvedValue('IT'),
  getPhysicalSiteAndSincom: jest.fn().mockResolvedValue({ physicalSiteId: 'PS001', dealerNumberIdSource: '0062219', dealerArcadCode: 'DLR001' }),
}));

const { MyPeopleDmsSessionRepository } = require('../../src/repositories/myPeopleDmsSessionRepository');
const myPeopleService = require('../../../myPeople/myPeopleService');
const dmlConfigSyncDb = require('../../../dmlConfigSync/db');
const dmlConfigRepository = require('../../../dmlConfigSync/DmlConfigRepository');
const dmsSettingsRepository = require('../../../dmlConfigSync/DmsSettingsRepository');
const dbManagerDb = require('../../../dbManager/db');
const anagSnowflakesRepository = require('../../../dbManager/AnagSnowflakesRepository');

describe('MyPeopleDmsSessionRepository — lazy loading dei moduli reali (myPeople/dmlConfigSync)', () => {
  afterEach(() => jest.clearAllMocks());

  test('usa i moduli reali (myPeople/myPeopleService, dmlConfigSync/db+DmlConfigRepository+DmsSettingsRepository) quando non vengono iniettati override', async () => {
    const repository = new MyPeopleDmsSessionRepository();
    const data = await repository.getSessionData('0073741.d235');

    expect(myPeopleService.readUserProfiles).toHaveBeenCalledWith({ username: '0073741.d235' });
    expect(dmlConfigSyncDb.getPool).toHaveBeenCalledTimes(3); // loadGetDmsSettingsCache + loadGetDmlConfiguration + loadGetBrandLogos
    expect(dbManagerDb.getPool).toHaveBeenCalledTimes(2); // loadGetCountryIsoCode + loadGetPhysicalSiteAndSincom
    expect(anagSnowflakesRepository.getCountryIsoCode).toHaveBeenCalledWith(
      { __fakeDbManagerPool: true, query: expect.any(Function) },
      { market: '1000' },
    );
    expect(anagSnowflakesRepository.getPhysicalSiteAndSincom).toHaveBeenCalledWith(
      { __fakeDbManagerPool: true, query: expect.any(Function) },
      { mainSincom: '0073741', market: '1000', brand: 'FT' },
    );
    expect(dmsSettingsRepository.getDmsSettings).toHaveBeenCalledWith(
      { __fakePool: true, query: expect.any(Function) },
      { country: 'IT', brand: 'FT', dealer: '0073741' },
    );
    expect(dmsSettingsRepository.registerDealer).not.toHaveBeenCalled(); // cache-hit: nessuna registrazione necessaria
    expect(dmlConfigRepository.getDmlConfiguration).toHaveBeenCalledWith(
      { __fakePool: true, query: expect.any(Function) },
      { country: 'it', language: 'it' },
    );
    expect(data.codmarket).toBe('1000');
    expect(data.marketIso).toBe('IT');
    expect(data.sincom).toBe('0073741');
    expect(data.brandvehic_reftech).toBe('FT');
    expect(data.isdml).toBe(true);
    expect(data.companytypes).toEqual([]);
    expect(data.customertitles).toEqual([]);
    expect(data.physicalsite).toBe('PS001');
    expect(data.pdvId).toBe('DLR001');

    // loadGetBrandLogos: usa lo stesso pool (getPool) per interrogare woc.anag_brand
    // con i codici brand dedotti da OICs[].BRANDS ("00,77,66,57,70,83").
    const pool = await dmlConfigSyncDb.getPool.mock.results[0].value;
    expect(pool.query).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('woc.anag_brand'),
      values: [['00', '77', '66', '57', '70', '83']],
    }));
    expect(data.oics).toEqual([
      {
        code: '00007584',
        brands: '00,77,66,57,70,83',
        brandLogos: [
          'assets/images/logo/brand-stla/FIAT.png',
          'assets/images/logo/brand-stla/ALFAROMEO.png',
        ],
        main: 'Y',
        djcListParameter: null,
      },
    ]);
  });

  test('cache-miss su dms/settings: registra (best-effort) la combinazione country/brand/dealer', async () => {
    dmsSettingsRepository.getDmsSettings.mockResolvedValueOnce(null);

    const repository = new MyPeopleDmsSessionRepository();
    const data = await repository.getSessionData('0073741.d235');

    expect(dmsSettingsRepository.registerDealer).toHaveBeenCalledWith(
      { __fakePool: true, query: expect.any(Function) },
      { country: 'IT', brand: 'FT', dealer: '0073741' },
    );
    expect(data.isdml).toBe(false);
  });

  test('riusa i moduli già caricati (cache) su una seconda chiamata', async () => {
    const repository = new MyPeopleDmsSessionRepository();
    await repository.getSessionData('0073741.d235');
    await repository.getSessionData('0073741.d235');

    // require() viene invocato una sola volta grazie alla cache lazy interna,
    // ma la funzione risolta viene comunque chiamata ad ogni getSessionData().
    expect(myPeopleService.readUserProfiles).toHaveBeenCalledTimes(2);
  });
});
