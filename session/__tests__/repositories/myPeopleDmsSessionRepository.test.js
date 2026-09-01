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

function buildRepository(overrides = {}) {
  return new MyPeopleDmsSessionRepository({
    readUserProfilesFn: jest.fn().mockResolvedValue(MYPEOPLE_SUCCESS_RESPONSE),
    getBearerTokenFn: jest.fn().mockResolvedValue('***TOKEN***'),
    getDmsSettingsFn: jest.fn().mockResolvedValue(DMS_SETTINGS_RESPONSE),
    getDmlConfigurationFn: jest.fn().mockResolvedValue(DML_CONFIGURATION_RESPONSE),
    ...overrides,
  });
}

describe('MyPeopleDmsSessionRepository', () => {
  test('mappa correttamente myPeople + dms/settings sulla forma storica del session data', async () => {
    const readUserProfilesFn = jest.fn().mockResolvedValue(MYPEOPLE_SUCCESS_RESPONSE);
    const getBearerTokenFn = jest.fn().mockResolvedValue('***TOKEN***');
    const getDmsSettingsFn = jest.fn().mockResolvedValue(DMS_SETTINGS_RESPONSE);
    const getDmlConfigurationFn = jest.fn().mockResolvedValue(DML_CONFIGURATION_RESPONSE);
    const repository = buildRepository({
      readUserProfilesFn,
      getBearerTokenFn,
      getDmsSettingsFn,
      getDmlConfigurationFn,
    });

    const data = await repository.getSessionData('0073741.d235');

    expect(readUserProfilesFn).toHaveBeenCalledWith({ username: '0073741.d235' });
    expect(getBearerTokenFn).toHaveBeenCalledTimes(1);
    expect(getDmsSettingsFn).toHaveBeenCalledWith('***TOKEN***', {
      country: 'it',
      brand: 'FT',
      dealer: '0073741',
    });
    expect(getDmlConfigurationFn).toHaveBeenCalledWith({ country: 'it', language: 'it' });

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
        { market: '1000', code: '00010925', state: 'ACTIVE', brands: '30,31,33,43', main: 'N' },
        { market: '1000', code: '00007584', state: 'ACTIVE', brands: '00,77,66,57,70,83', main: 'Y' },
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

  test('propaga un errore avvolto quando getBearerToken fallisce', async () => {
    const repository = buildRepository({
      getBearerTokenFn: jest.fn().mockRejectedValue(new Error('token expired')),
    });

    await expect(repository.getSessionData('0073741.d235'))
      .rejects.toThrow('[session] dms/settings failed: token expired');
  });

  test('propaga un errore avvolto quando dms/settings fallisce', async () => {
    const repository = buildRepository({
      getDmsSettingsFn: jest.fn().mockRejectedValue(new Error('HTTP 502')),
    });

    await expect(repository.getSessionData('0073741.d235'))
      .rejects.toThrow('[session] dms/settings failed: HTTP 502');
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
      getDmsSettingsFn: jest.fn().mockResolvedValue({
        success: true,
        data: [{ key: 'accountCustomerUpdate', value: 'TRUE', format: 'boolean' }],
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.dmlcustomerupdate).toBe(true);
  });

  test('dmldiscount viene letto da una key contenente "discount" (case-insensitive) quando presente', async () => {
    const repository = buildRepository({
      getDmsSettingsFn: jest.fn().mockResolvedValue({
        success: true,
        data: [{ key: 'discountAuthorization', value: '15', format: 'number' }],
      }),
    });

    const data = await repository.getSessionData('0073741.d235');
    expect(data.dmldiscount).toBe(15);
  });

  test('isdml è false quando dms/settings risponde success=false', async () => {
    const repository = buildRepository({
      getDmsSettingsFn: jest.fn().mockResolvedValue({ success: false, data: [] }),
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
        type: 'AFTERSALES',
        main: 'Y',
      },
    ]);
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
