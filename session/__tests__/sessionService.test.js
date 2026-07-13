'use strict';

const { getSessionData, createProvider } = require('../src/service/sessionService');
const StaticSessionProvider = require('../src/providers/staticSessionProvider');
const { getSessionDataForMarket: defaultSessionDatabyMarket } = require('../src/data/sessionDataByMarket');

describe('sessionService', () => {
  const EXPECTED_KEYS = [
    'codmarket',
    'oic',
    'sincom',
    'physicalsite',
    'pdvId',
    'sessionbrand',
    'inmandate',
    'language',
    'isdml',
    'dmlcustomerupdate',
    'dmldiscount',
    'brandvehic_genome',
    'brandvehic_reftech',
    'brandvehic_fca',
    'pkwstouse',
    'vat',
    'usertype',
    'interiorcarwash',
    'exteriorcarwash',
    'partpref_old',
    'partpref_original',
    'partpref_returned',
    'partpref_circularec',
    'pcydealer1',
    'pcydealer2',
    'pcydealer3',
    'pcystellantis1',
    'pcystellantis2',
    'pcystellantis3',
    'maxdiscountperc',
    'maxdiscountval',
  ];

  afterEach(() => {
    delete process.env.SESSION_DATA_SOURCE;
    jest.resetModules();
  });

  it('createProvider ritorna uno StaticSessionProvider di default', () => {
    const provider = createProvider();
    expect(provider).toBeInstanceOf(StaticSessionProvider);
  });

  it('getSessionData ritorna tutte le chiavi attese', async () => {
    const data = await getSessionData();
    EXPECTED_KEYS.forEach((key) => {
      expect(data).toHaveProperty(key);
    });
  });

  it('getSessionData ritorna i valori predefiniti quando non sono passati criteri', async () => {
    const data = await getSessionData();
    expect(data).toEqual(defaultSessionDatabyMarket());
  });

  it('getSessionData permette override dei valori tramite criteria (provider static)', async () => {
    const data = await getSessionData({ codmarket: 'FR', maxdiscountperc: 10 });
    expect(data.codmarket).toBe('FR');
    expect(data.maxdiscountperc).toBe(10);
    // gli altri campi restano quelli predefiniti
    expect(data.oic).toBe(defaultSessionDatabyMarket().oic);
  });

  it('con SESSION_DATA_SOURCE=db usa DbSessionProvider e propaga l\'errore "non implementato"', async () => {
    process.env.SESSION_DATA_SOURCE = 'db';
    jest.resetModules();
    // Richiedere di nuovo i moduli dopo aver impostato la env var
    // eslint-disable-next-line global-require
    const { getSessionData: getSessionDataDb } = require('../src/service/sessionService');
    await expect(getSessionDataDb({ pdvId: 'PDV000456' })).rejects.toThrow(
      /non ancora implementato/
    );
  });
});
