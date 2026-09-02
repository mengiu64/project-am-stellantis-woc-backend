'use strict';

const { MyPeopleDmsSessionRepository } = require('../../src/repositories/myPeopleDmsSessionRepository');
const { SessionNotFoundError } = require('../../src/errors');

const MYPEOPLE_SUCCESS_RESPONSE = {
  Response: {
    RC: '0',
    STATUS: 'SUCCESS',
    User: {
      Attributes: {
        USERNAME: '0073741.d235',
        MARKETCODE: '1000',
        NATION: 'I',
        FIRSTNAME: 'GUIDO',
        LASTNAME: 'FANTINI',
        STATUS: 'ACTIVE',
        LANGUAGE: '1040',
        EMAIL: 'guido.fantini@example.com',
        USERTYPE: 'DEALER',
        MAINSINCOM: '0073741',
        NATIONiso2: 'IT',
        NATIONiso3: 'ITA',
        NATIONisoN: '380',
      },
      Applications: [],
      OICs: [
        { MARKET: '1000', CODE: '00010925', STATE: 'ACTIVE', BRANDS: '30,31,33,43', MAIN: 'N' },
        { MARKET: '1000', CODE: '00007584', STATE: 'ACTIVE', BRANDS: '00,77,66,57,70,83', MAIN: 'Y' },
      ],
    },
  },
};

const DMS_SETTINGS_RESPONSE = {
  success: true,
  data: [
    { key: 'customerCreation', value: 'TRUE', format: 'boolean' },
    { key: 'dmsVersion', value: '14.00.03', format: 'string' },
    { key: 'accountCustomerUpdate', value: 'TRUE', format: 'boolean' },
    { key: 'knownCustomerUpdate', value: 'FALSE', format: 'boolean' },
  ],
};

// Esempio di risultato reale di dmlConfigSync/DmlConfigRepository::getDmlConfiguration
// (cache popolata una volta al giorno dalla lambda dmlConfigSync a partire dalle
// risposte di dms/getCompanyTypes / dms/getCustomerTitles).
const DML_CONFIGURATION_RESPONSE = {
  companyTypes: [
    { code: 'FR001', country: 'FR', language_code: 'fr', description: 'Particulier' },
    { code: 'FR002', country: 'FR', language_code: 'fr', description: 'Société' },
  ],
  customerTitles: [
    { code: 'FR001', country: 'FR', language_code: 'fr', description: 'Mme' },
    { code: 'FR002', country: 'FR', language_code: 'fr', description: 'Mlle' },
    { code: 'FR003', country: 'FR', language_code: 'fr', description: 'Mr et Mme' },
    { code: 'FR004', country: 'FR', language_code: 'fr', description: 'Mr' },
    { code: 'FR005', country: 'FR', language_code: 'fr', description: 'Mr et Mme' },
    { code: 'FR006', country: 'FR', language_code: 'fr', description: 'Lady' },
    { code: 'FR007', country: 'FR', language_code: 'fr', description: 'Miss' },
    { code: 'FR008', country: 'FR', language_code: 'fr', description: 'Ing' },
  ],
};

// Esempio di risultato reale della query woc.anag_brand (codbrand -> logo_s3_key),
// usata per arricchire ogni oic con l'array brandLogos.
const BRAND_LOGOS_BY_CODE = {
  30: 'assets/images/logo/brand-stla/CITROEN.png',
  31: 'assets/images/logo/brand-stla/PEUGEOT.png',
  33: 'assets/images/logo/brand-stla/OPEL.png',
  '00': 'assets/images/logo/brand-stla/FIAT.png',
  83: 'assets/images/logo/brand-stla/ALFAROMEO.png',
};

function buildRepository(overrides = {}) {
  return new MyPeopleDmsSessionRepository({
    readUserProfilesFn: jest.fn().mockResolvedValue(MYPEOPLE_SUCCESS_RESPONSE),
    getDmsSettingsCacheFn: jest.fn().mockResolvedValue(DMS_SETTINGS_RESPONSE),
    registerDmsSettingsDealerFn: jest.fn().mockResolvedValue(undefined),
    getDmlConfigurationFn: jest.fn().mockResolvedValue(DML_CONFIGURATION_RESPONSE),
    getBrandLogosFn: jest.fn().mockResolvedValue(BRAND_LOGOS_BY_CODE),
    ...overrides,
  });
}

describe('MyPeopleDmsSessionRepository', () => {
  test('mappa correttamente myPeople + cache dms/settings sulla forma storica del session data', async () => {
    const readUserProfilesFn = jest.fn().mockResolvedValue(MYPEOPLE_SUCCESS_RESPONSE);
    const getDmsSettingsCacheFn = jest.fn().mockResolvedValue(DMS_SETTINGS_RESPONSE);
    const registerDmsSettingsDealerFn = jest.fn().mockResolvedValue(undefined);
    const getDmlConfigurationFn = jest.fn().mockResolvedValue(DML_CONFIGURATION_RESPONSE);
    const getBrandLogosFn = jest.fn().mockResolvedValue(BRAND_LOGOS_BY_CODE);
    const repository = buildRepository({
      readUserProfilesFn,
      getDmsSettingsCacheFn,
      registerDmsSettingsDealerFn,
      getDmlConfigurationFn,
      getBrandLogosFn,
    });

    const data = await repository.getSessionData('0073741.d235');

    expect(readUserProfilesFn).toHaveBeenCalledWith({ username: '0073741.d235' });
    expect(getDmsSettingsCacheFn).toHaveBeenCalledWith({
      country: 'it',
      brand: 'FT',
      dealer: '0073741',
    });
    expect(registerDmsSettingsDealerFn).not.toHaveBeenCalled(); // cache-hit: nessuna registrazione necessaria
    expect(getDmlConfigurationFn).toHaveBeenCalledWith({ country: 'it', language: 'it' });
    expect(getBrandLogosFn).toHaveBeenCalledWith({
      codes: ['30', '31', '33', '43', '00', '77', '66', '57', '70', '83'],
    });

    expect(data).toEqual({
      codmarket: '1000',
      oic: '00007584',
      sincom: '0073741',
      firstname: 'GUIDO',
      lastname: 'FANTINI',
      profile: null,
      physicalsite: null,
      pdvId: null,
      sessionbrand: '00',
      inmandate: null,
      language: 'it',
      locale: 'it_IT',
      isdml: true,
      dmlcustomerupdate: false, // knownCustomerUpdate ha priorità su accountCustomerUpdate
      dmldiscount: null,
      brandvehic_genome: null,
      brandvehic_reftech: 'FT',
      brandvehic_fca: '00',
      pkwstouse: null,
      vat: null,
      usertype: 'DEALER',
      interiorcarwash: null,
      exteriorcarwash: null,
      partpref_old: null,
      partpref_original: null,
      partpref_returned: null,
      partpref_circularec: null,
      pcydealer1: null,
      pcydealer2: null,
      pcydealer3: null,
      pcystellantis1: null,
      pcystellantis2: null,
      pcystellantis3: null,
      maxdiscountperc: null,
      maxdiscountval: null,
      oics: [
        {
          market: '1000',
          code: '00010925',
          state: 'ACTIVE',
          brands: '30,31,33,43',
          brandLogos: [
            'assets/images/logo/brand-stla/CITROEN.png',
            'assets/images/logo/brand-stla/PEUGEOT.png',
            'assets/images/logo/brand-stla/OPEL.png',
          ],
          main: 'N',
        },
        {
          market: '1000',
          code: '00007584',
          state: 'ACTIVE',
          brands: '00,77,66,57,70,83',
          brandLogos: [
            'assets/images/logo/brand-stla/FIAT.png',
            'assets/images/logo/brand-stla/ALFAROMEO.png',
          ],
          main: 'Y',
        },
      ],
      applications: [],
      companytypes: DML_CONFIGURATION_RESPONSE.companyTypes,
      customertitles: DML_CONFIGURATION_RESPONSE.customerTitles,
    });
  });

  test('lancia errore se username è mancante, senza chiamare alcun servizio', async () => {
    const readUserProfilesFn = jest.fn();
    const repository = buildRepository({ readUserProfilesFn });

    await expect(repository.getSessionData()).rejects.toThrow('[session] username is required');
    expect(readUserProfilesFn).not.toHaveBeenCalled();
  });

  test('lancia SessionNotFoundError quando myPeople risponde RC diverso da "0"', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: { RC: '1', STATUS: 'ERROR' },
      }),
    });

    await expect(repository.getSessionData('unknown.user')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  test('lancia SessionNotFoundError quando manca Response.User', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({ Response: { RC: '0', STATUS: 'SUCCESS' } }),
    });

    await expect(repository.getSessionData('unknown.user')).rejects.toThrow(SessionNotFoundError);
  });

  test('usa il primo OIC come fallback quando nessuno ha MAIN="Y"', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [{ CODE: '00010925', BRANDS: '30,31,33,43', MAIN: 'N' }],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.oic).toBe('00010925');
    expect(data.sessionbrand).toBe('30');
    expect(data.brandvehic_reftech).toBe('AC');
  });

  test('gestisce assenza di OICs (nessun brand/oic ricavabile)', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.oic).toBeNull();
    expect(data.sessionbrand).toBeNull();
    expect(data.brandvehic_reftech).toBeNull();
    expect(data.brandvehic_fca).toBeNull();
  });

  test('brandvehic_reftech è null per un codice brand non presente nella tabella di transcodifica', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [{ CODE: '00010925', BRANDS: '99', MAIN: 'Y' }],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.brandvehic_fca).toBe('99');
    expect(data.brandvehic_reftech).toBeNull();
  });

  test('cache-miss su dms/settings: ritorna i default e registra (await) la combinazione, senza mai fallire la sessione', async () => {
    const registerDmsSettingsDealerFn = jest.fn().mockResolvedValue(undefined);
    const repository = buildRepository({
      getDmsSettingsCacheFn: jest.fn().mockResolvedValue(null),
      registerDmsSettingsDealerFn,
    });

    const data = await repository.getSessionData('0073741.d235');

    expect(data.isdml).toBe(false);
    expect(data.dmlcustomerupdate).toBeNull();
    expect(data.dmldiscount).toBeNull();
    expect(registerDmsSettingsDealerFn).toHaveBeenCalledWith({ country: 'it', brand: 'FT', dealer: '0073741' });
  });

  test('non propaga (mai) errori di lettura della cache dms/settings: isdml diventa false (fallback ai default)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const repository = buildRepository({
      getDmsSettingsCacheFn: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    });

    const data = await repository.getSessionData('0073741.d235');

    expect(data.isdml).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('connect ECONNREFUSED'));
    errorSpy.mockRestore();
  });

  test('un errore di registrazione del dealer (cache-miss) non fa fallire la sessione', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const repository = buildRepository({
      getDmsSettingsCacheFn: jest.fn().mockResolvedValue(null),
      registerDmsSettingsDealerFn: jest.fn().mockRejectedValue(new Error('duplicate key')),
    });

    const data = await repository.getSessionData('0073741.d235');

    expect(data.isdml).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate key'));
    errorSpy.mockRestore();
  });

  test('dms/settings non viene interrogato (né registrato) quando manca country/brand/dealer', async () => {
    const getDmsSettingsCacheFn = jest.fn();
    const registerDmsSettingsDealerFn = jest.fn();
    const repository = buildRepository({
      getDmsSettingsCacheFn,
      registerDmsSettingsDealerFn,
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', USERTYPE: 'DEALER' }, // MAINSINCOM/NATIONiso2 assenti
            OICs: [{ CODE: '00010925', MAIN: 'Y' }], // nessun BRANDS -> brandReftech null
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');

    expect(getDmsSettingsCacheFn).not.toHaveBeenCalled();
    expect(registerDmsSettingsDealerFn).not.toHaveBeenCalled();
    expect(data.isdml).toBe(false);
  });

  test('non propaga (mai) errori di lettura della cache dml/configurations: companytypes/customertitles diventano []', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const repository = buildRepository({
      getDmlConfigurationFn: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    });

    const data = await repository.getSessionData('0073741.d235');

    expect(data.companytypes).toEqual([]);
    expect(data.customertitles).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('connect ECONNREFUSED'));
    errorSpy.mockRestore();
  });

  test('companytypes/customertitles chiamano con country/language derivati da NATIONiso2', async () => {
    const getDmlConfigurationFn = jest.fn().mockResolvedValue(DML_CONFIGURATION_RESPONSE);
    const repository = buildRepository({ getDmlConfigurationFn });

    const data = await repository.getSessionData('0073741.d235');

    expect(getDmlConfigurationFn).toHaveBeenCalledWith({ country: 'it', language: 'it' });
    expect(data.companytypes).toEqual(DML_CONFIGURATION_RESPONSE.companyTypes);
    expect(data.customertitles).toEqual(DML_CONFIGURATION_RESPONSE.customerTitles);
  });

  test('companytypes/customertitles sono array vuoti quando la cache non contiene ancora un array valido', async () => {
    const repository = buildRepository({
      getDmlConfigurationFn: jest.fn().mockResolvedValue({ companyTypes: null, customerTitles: undefined }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.companytypes).toEqual([]);
    expect(data.customertitles).toEqual([]);
  });

  test('companytypes/customertitles sono [] e la cache non viene interrogata quando NATIONiso2 è assente', async () => {
    const getDmlConfigurationFn = jest.fn();
    const repository = buildRepository({
      getDmlConfigurationFn,
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', USERTYPE: 'DEALER' },
            OICs: [{ CODE: '00010925', BRANDS: '00', MAIN: 'Y' }],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(getDmlConfigurationFn).not.toHaveBeenCalled();
    expect(data.companytypes).toEqual([]);
    expect(data.customertitles).toEqual([]);
  });

  test('dmlcustomerupdate ricade su accountCustomerUpdate quando knownCustomerUpdate è assente', async () => {
    const repository = buildRepository({
      getDmsSettingsCacheFn: jest.fn().mockResolvedValue({
        success: true,
        data: [{ key: 'accountCustomerUpdate', value: 'TRUE', format: 'boolean' }],
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.dmlcustomerupdate).toBe(true);
  });

  test('dmldiscount viene letto da una key contenente "discount" (case-insensitive) quando presente', async () => {
    const repository = buildRepository({
      getDmsSettingsCacheFn: jest.fn().mockResolvedValue({
        success: true,
        data: [{ key: 'discountAuthorization', value: '15', format: 'number' }],
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.dmldiscount).toBe(15);
  });

  test('isdml è false quando dms/settings risponde success=false', async () => {
    const repository = buildRepository({
      getDmsSettingsCacheFn: jest.fn().mockResolvedValue({ success: false, data: [] }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.isdml).toBe(false);
  });

  test('campi derivati da attributes assenti restano null (MARKETCODE, NATIONiso2, USERTYPE, MAINSINCOM)', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: {},
            OICs: [{ BRANDS: '00', MAIN: 'Y' }],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.codmarket).toBeNull();
    expect(data.oic).toBeNull();
    expect(data.sincom).toBeNull();
    expect(data.language).toBeNull();
    expect(data.locale).toBeNull();
    expect(data.usertype).toBeNull();
  });

  test('oics riporta l\'intero blocco OICs di myPeople con tutte le chiavi in minuscolo', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [
              {
                MARKET: '1000',
                CODE: '00010925',
                STATE: 'ACTIVE',
                DESCRIPTION: 'BRANDINI SPA',
                CITY: 'BAGNO A RIPOLI',
                ADDRESS: "VIA LUNGO L'EMA, 19/21/23",
                ZIPCODE: '50012',
                BRANDS: '30,31,33,43',
                TYPE: 'AFTERSALES',
                MAIN: 'N',
              },
              {
                MARKET: '1000',
                CODE: '00007584',
                STATE: 'ACTIVE',
                DESCRIPTION: 'BRANDINI S.P.A.',
                CITY: 'GROSSETO',
                ADDRESS: 'VIA AMBRA 41-45',
                ZIPCODE: '58100',
                BRANDS: '00,77,66,57,70,83',
                TYPE: 'AFTERSALES',
                MAIN: 'Y',
              },
            ],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.oics).toEqual([
      {
        market: '1000',
        code: '00010925',
        state: 'ACTIVE',
        description: 'BRANDINI SPA',
        city: 'BAGNO A RIPOLI',
        address: "VIA LUNGO L'EMA, 19/21/23",
        zipcode: '50012',
        brands: '30,31,33,43',
        brandLogos: [
          'assets/images/logo/brand-stla/CITROEN.png',
          'assets/images/logo/brand-stla/PEUGEOT.png',
          'assets/images/logo/brand-stla/OPEL.png',
        ],
        type: 'AFTERSALES',
        main: 'N',
      },
      {
        market: '1000',
        code: '00007584',
        state: 'ACTIVE',
        description: 'BRANDINI S.P.A.',
        city: 'GROSSETO',
        address: 'VIA AMBRA 41-45',
        zipcode: '58100',
        brands: '00,77,66,57,70,83',
        brandLogos: [
          'assets/images/logo/brand-stla/FIAT.png',
          'assets/images/logo/brand-stla/ALFAROMEO.png',
        ],
        type: 'AFTERSALES',
        main: 'Y',
      },
    ]);
    // brandLogos deve comparire subito dopo brands, non in coda all'oggetto.
    expect(Object.keys(data.oics[0]).indexOf('brandLogos')).toBe(
      Object.keys(data.oics[0]).indexOf('brands') + 1,
    );
  });

  test('oics è un array vuoto quando myPeople non restituisce alcun OIC', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.oics).toEqual([]);
  });

  test('oic senza campo brands riceve comunque brandLogos come array vuoto', async () => {
    const getBrandLogosFn = jest.fn().mockResolvedValue(BRAND_LOGOS_BY_CODE);
    const repository = buildRepository({
      getBrandLogosFn,
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [{ MARKET: '1000', CODE: '00010925', STATE: 'ACTIVE', MAIN: 'N' }],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.oics).toEqual([
      { market: '1000', code: '00010925', state: 'ACTIVE', brandLogos: [], main: 'N' },
    ]);
    // Nessun codice brand da risolvere: non deve nemmeno interrogare il DB.
    expect(getBrandLogosFn).not.toHaveBeenCalled();
  });

  test('brandLogos scarta i codici brand senza logo noto e non fallisce se la query DB fallisce', async () => {
    const getBrandLogosFn = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const repository = buildRepository({
      getBrandLogosFn,
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [{ MARKET: '1000', CODE: '00010925', STATE: 'ACTIVE', BRANDS: '30,99', MAIN: 'N' }],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.oics).toEqual([
      { market: '1000', code: '00010925', state: 'ACTIVE', brands: '30,99', brandLogos: [], main: 'N' },
    ]);
    expect(getBrandLogosFn).toHaveBeenCalledWith({ codes: ['30', '99'] });
  });

  test('applications riporta l\'intero blocco Applications di myPeople con tutte le chiavi in minuscolo', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            Applications: [
              { APPLICATION: 'IT.ESERVICE.LINK', PROFILE: 'GARAGE CHIEF', STATUS: 'ACTIVE', MARKET: '1000' },
              { APPLICATION: 'wiADV.DL', PROFILE: 'Service Manager', STATUS: 'ACTIVE', MARKET: '1000' },
            ],
            OICs: [],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.applications).toEqual([
      { application: 'IT.ESERVICE.LINK', profile: 'GARAGE CHIEF', status: 'ACTIVE', market: '1000' },
      { application: 'wiADV.DL', profile: 'Service Manager', status: 'ACTIVE', market: '1000' },
    ]);
  });

  test('profile è valorizzato con il PROFILE dell\'Application con APPLICATION="wiADV.DL"', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            Applications: [
              { APPLICATION: 'IT.ESERVICE.LINK', PROFILE: 'GARAGE CHIEF', STATUS: 'ACTIVE', MARKET: '1000' },
              { APPLICATION: 'wiADV.DL', PROFILE: 'Service Manager', STATUS: 'ACTIVE', MARKET: '1000' },
            ],
            OICs: [],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.profile).toBe('Service Manager');
  });

  test('profile è null quando myPeople non restituisce alcuna Application con APPLICATION="wiADV.DL"', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            Applications: [
              { APPLICATION: 'IT.ESERVICE.LINK', PROFILE: 'GARAGE CHIEF', STATUS: 'ACTIVE', MARKET: '1000' },
            ],
            OICs: [],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.profile).toBeNull();
  });

  test('applications è un array vuoto quando myPeople non restituisce alcuna Application', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            Applications: [],
            OICs: [],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.applications).toEqual([]);
  });

  test('applications è un array vuoto quando myPeople non restituisce affatto il blocco Applications', async () => {
    const repository = buildRepository({
      readUserProfilesFn: jest.fn().mockResolvedValue({
        Response: {
          RC: '0',
          STATUS: 'SUCCESS',
          User: {
            Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
            OICs: [],
          },
        },
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.applications).toEqual([]);
  });
});
