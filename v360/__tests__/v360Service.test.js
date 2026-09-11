'use strict';

jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:asv',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
  asv: {
    baseUrl: 'https://api.v360.test',
    basePath: '/ps-prod/extra/asv360/vehicle/v1',
    clientId: 'asv-client-id',
    clientSecret: 'asv-client-secret',
  },
  getDetailsDefaults: {
    countryCode: 'FR',
    languageCode: 'fr',
    clientId: 'a8bf933a532cc85570a68d9bec7f44c4',
    offering: 'Vehicle Description, campaign, warranty',
  },
  otaCompatibilityDefaults: {
    includeOtaHistoryData: 'true',
    locale: 'en_EN',
  },
}));
jest.mock('../httpClient');
jest.mock('../authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../s3ConfigRepository', () => ({
  S3ConfigRepository: jest.fn().mockImplementation(() => ({
    getBrandOwners: jest.fn().mockResolvedValue(require('../../config/brandowner.json')),
    getEnergyTypes: jest.fn().mockResolvedValue(require('../../config/energytype.json')),
  })),
}));
jest.mock('../dynamoCache', () => ({
  getCacheItem: jest.fn(),
  setCacheItem: jest.fn((key, value) => Promise.resolve(value)),
}));

const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');
const { getCacheItem, setCacheItem } = require('../dynamoCache');
const { otaCompatibility, getDetails, getDetailsWithCache, getCachedBrand } = require('../v360Service');

describe('v360Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
  });

  // ── otaCompatibility ─────────────────────────────────────────────────────────

  test('throws if vin is missing for otaCompatibility', async () => {
    await expect(otaCompatibility('token', {})).rejects.toThrow('[v360] vin is required for otaCompatibility');
  });

  test('calls httpsRequest with POST method and correct path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { compatible: true } });

    await otaCompatibility('token', { vin: 'VIN123' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.path).toContain('/otaCompatibility');
    expect(options.hostname).toBe('api.v360.test');
  });

  test('sends vin in request body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN123' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.vin).toBe('VIN123');
  });

  test('includes optional params in request body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN123', includeOtaHistoryData: 'true', locale: 'fr_FR' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.includeOtaHistoryData).toBe('true');
    expect(body.locale).toBe('fr_FR');
  });

  test('does not include undefined optional params in body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN123' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body).toHaveProperty('includeOtaHistoryData');
    expect(body).toHaveProperty('locale');
  });

  test('falls back to config defaults when includeOtaHistoryData/locale are not provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN123' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.includeOtaHistoryData).toBe('true');
    expect(body.locale).toBe('en_EN');
  });

  test('includes IBM client credentials in headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('my-bearer-token', { vin: 'VIN1' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['X-IBM-Client-Id']).toBe('asv-client-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('asv-client-secret');
    expect(options.headers.Authorization).toBe('Bearer my-bearer-token');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  test('returns response body on success', async () => {
    const expectedBody = { vin: 'VIN123', compatible: true, otaHistory: [] };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await otaCompatibility('token', { vin: 'VIN123' });
    expect(result).toEqual(expectedBody);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 422, headers: {}, body: { error: 'invalid vin' } });

    await expect(otaCompatibility('token', { vin: 'BADVIN' }))
      .rejects.toThrow('[v360] otaCompatibility failed: HTTP 422');
  });

  test('includes x-trace-id header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await otaCompatibility('token', { vin: 'VIN1' });

    const [options] = httpsRequest.mock.calls[0];
    expect(typeof options.headers['x-trace-id']).toBe('string');
    expect(options.headers['x-trace-id'].length).toBeGreaterThan(0);
  });

  // ── getDetails ───────────────────────────────────────────────────────────────

  test('throws if vin is missing for getDetails', async () => {
    await expect(getDetails('token', {})).rejects.toThrow('[v360] vin is required for getdetails');
  });

  test('calls httpsRequest with POST method and correct path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', { vin: 'VIN456' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.path).toContain('/getdetails');
  });

  test('defaults searchType to "vin" when not provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', { vin: 'VIN456' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.searchType).toBe('vin');
    expect(body.vin).toBe('VIN456');
  });

  test('includes optional params in request body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', {
      vin: 'VIN456',
      countryCode: 'FR',
      clientId: 'client1',
      offering: 'Vehicle Description, campaign, warranty',
      languageCode: 'fr',
    });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.countryCode).toBe('FR');
    expect(body.clientId).toBe('client1');
    expect(body.offering).toBe('Vehicle Description, campaign, warranty');
    expect(body.languageCode).toBe('fr');
  });

  test('falls back to config defaults when optional params are not provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDetails('token', { vin: 'VIN456' });

    const [, bodyStr] = httpsRequest.mock.calls[0];
    const body = JSON.parse(bodyStr);
    expect(body.countryCode).toBe('FR');
    expect(body.clientId).toBe('a8bf933a532cc85570a68d9bec7f44c4');
    expect(body.offering).toBe('Vehicle Description, campaign, warranty');
    expect(body.languageCode).toBe('fr');
  });

  test('returns response body on success', async () => {
    const expectedBody = { vin: 'VIN456', details: { model: 'Peugeot 3008' } };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });
    expect(result).toEqual(expectedBody);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: { error: 'server error' } });

    await expect(getDetails('token', { vin: 'VIN456' }))
      .rejects.toThrow('[v360] getdetails failed: HTTP 500');
  });

  test('inserts externalHexColor:null right before externalColor in data', async () => {
    const expectedBody = {
      statusCode: 200,
      success: true,
      data: {
        vin: 'VIN456',
        internalColor: 'NOIR',
        externalColor: 'KTV NOIR PERLA NERA',
        tireSize: [],
      },
      message: 'ok',
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(Object.keys(result.data)).toEqual([
      'vin', 'internalColor', 'externalHexColor', 'externalColor', 'tireSize',
    ]);
    expect(result.data.externalHexColor).toBeNull();
  });

  test('appends externalHexColor:null when data has no externalColor key', async () => {
    const expectedBody = { statusCode: 200, success: true, data: { vin: 'VIN456' } };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(Object.keys(result.data)).toEqual(['vin', 'externalHexColor']);
    expect(result.data.externalHexColor).toBeNull();
  });

  test('does not fail when response body has no data property', async () => {
    const expectedBody = { statusCode: 200, success: false, message: 'not found' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(result).toEqual(expectedBody);
  });

  test('sets energyTypeDesignation when brand owner is XP and salesCode matches an energy type code', async () => {
    const expectedBody = {
      statusCode: 200,
      data: {
        brandCode: 'AC',
        salesCode: 'D4E01CD, DA301CD, DCD06CD, DAF01CD',
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(result.data.energyTypeDesignation).toBe('diesel');
  });

  test('does not set energyTypeDesignation when brandCode is not found in brandowner registry', async () => {
    const expectedBody = {
      statusCode: 200,
      data: {
        brandCode: 'ZZ',
        salesCode: 'DCD06CD',
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(result.data.energyTypeDesignation).toBeUndefined();
  });

  test('does not set energyTypeDesignation when owner is not XP', async () => {
    const expectedBody = {
      statusCode: 200,
      data: {
        brandCode: 'AR',
        salesCode: 'DCD06CD',
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(result.data.energyTypeDesignation).toBeUndefined();
  });

  test('does not set energyTypeDesignation when owner is XP but salesCode is missing', async () => {
    const expectedBody = {
      statusCode: 200,
      data: {
        brandCode: 'AC',
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(result.data.energyTypeDesignation).toBeUndefined();
  });

  test('does not set energyTypeDesignation when owner is XP but salesCode has no matching energy type code', async () => {
    const expectedBody = {
      statusCode: 200,
      data: {
        brandCode: 'AC',
        salesCode: 'ZZZ00CD, YYY00CD',
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDetails('token', { vin: 'VIN456' });

    expect(result.data.energyTypeDesignation).toBeUndefined();
  });

  // ── getDetailsWithCache ──────────────────────────────────────────────────────
  // Cache DynamoDB per-vin (tabella TmpCacheTable, TTL allineato alla durata
  // della sessione utente), best-effort: un errore di scrittura non deve mai
  // bloccare la risposta (v. dynamoCache.js).

  describe('getDetailsWithCache', () => {
    test('throws if vin is missing', async () => {
      await expect(getDetailsWithCache('token', {})).rejects.toThrow('[v360] vin is required for getdetails');
    });

    test('cache miss: calls getDetails (ASV360) and saves the response to the DynamoDB cache', async () => {
      const expectedBody = { statusCode: 200, data: { vin: 'VIN456', brandCode: 'FT' } };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });
      getCacheItem.mockResolvedValue(null);

      const result = await getDetailsWithCache('token', { vin: 'VIN456' });

      expect(httpsRequest).toHaveBeenCalledTimes(1);
      expect(setCacheItem).toHaveBeenCalledTimes(1);
      const [cacheKey, value, ttlSeconds] = setCacheItem.mock.calls[0];
      expect(cacheKey).toBe('v360:getdetails:VIN456');
      expect(value).toEqual(expectedBody);
      expect(ttlSeconds).toBeGreaterThan(0);
      expect(result).toEqual(expectedBody);
    });

    test('cache hit: reads the DynamoDB cache for the vin and does not call ASV360', async () => {
      const cachedBody = { statusCode: 200, data: { vin: 'VIN456', brandCode: 'FT' } };
      getCacheItem.mockResolvedValue(cachedBody);

      const result = await getDetailsWithCache('token', { vin: 'VIN456' });

      expect(getCacheItem).toHaveBeenCalledWith('v360:getdetails:VIN456');
      expect(httpsRequest).not.toHaveBeenCalled();
      expect(setCacheItem).not.toHaveBeenCalled();
      expect(result).toEqual(cachedBody);
    });

    test('still returns the response even if writing to the cache fails', async () => {
      const expectedBody = { statusCode: 200, data: { vin: 'VIN456', brandCode: 'FT' } };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });
      getCacheItem.mockResolvedValue(null);
      setCacheItem.mockResolvedValue(expectedBody); // dynamoCache.js gestisce internamente eventuali errori di scrittura (mai propagati)

      await expect(getDetailsWithCache('token', { vin: 'VIN456' })).resolves.toEqual(expectedBody);
    });
  });

  // ── getCachedBrand ───────────────────────────────────────────────────────────

  describe('getCachedBrand', () => {
    test('returns null when vin is missing', async () => {
      expect(await getCachedBrand()).toBeNull();
      expect(await getCachedBrand('')).toBeNull();
      expect(getBearerToken).not.toHaveBeenCalled();
    });

    test('resolves data.brandCode from getDetailsWithCache (cache miss -> ASV360)', async () => {
      getBearerToken.mockResolvedValue('V360-TOKEN');
      getCacheItem.mockResolvedValue(null);
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { data: { brandCode: 'FT' } } });

      const brand = await getCachedBrand('VIN456');

      expect(getBearerToken).toHaveBeenCalledTimes(1);
      expect(brand).toBe('FT');
    });

    test('resolves data.brandCode from cache (cache hit, no ASV360 call needed)', async () => {
      getBearerToken.mockResolvedValue('V360-TOKEN');
      getCacheItem.mockResolvedValue({ data: { brandCode: 'AR' } });

      const brand = await getCachedBrand('VIN456');

      expect(httpsRequest).not.toHaveBeenCalled();
      expect(brand).toBe('AR');
    });

    test('returns null (best-effort) when the response has no data.brandCode', async () => {
      getBearerToken.mockResolvedValue('V360-TOKEN');
      getCacheItem.mockResolvedValue(null);
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { data: {} } });

      expect(await getCachedBrand('VIN456')).toBeNull();
    });

    test('returns null (best-effort) and logs a warning when ASV360/PingFederate fails', async () => {
      getBearerToken.mockRejectedValue(new Error('PingFederate unreachable'));

      const brand = await getCachedBrand('VIN456');

      expect(brand).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile risolvere il brand per vin="VIN456"'));
    });
  });
});

