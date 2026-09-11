'use strict';

jest.mock('../src/dynamoCache', () => ({ getCacheItem: jest.fn(), setCacheItem: jest.fn() }));
jest.mock('../src/repositoryFactory');

const { getCacheItem, setCacheItem } = require('../src/dynamoCache');
const { buildMyPeopleDmsRepository } = require('../src/repositoryFactory');
const { getCachedSessionContext } = require('../src/sessionContextCache');

const CACHE_KEY = 'session:context:dealer1.d001';

describe('sessionContextCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SESSION_CONTEXT_CACHE_TTL_MS;
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  test('returns {} without calling myPeople when username is missing', async () => {
    expect(await getCachedSessionContext()).toEqual({});
    expect(await getCachedSessionContext('')).toEqual({});
    expect(buildMyPeopleDmsRepository).not.toHaveBeenCalled();
  });

  test('cache miss: resolves via getSessionDataFn override, maps only the Sender-relevant fields, and writes the cache', async () => {
    getCacheItem.mockResolvedValue(null);
    const getSessionDataFn = jest.fn().mockResolvedValue({
      username: 'dealer1.d001',
      sincom: '0062230',
      codmarket: '10102',
      marketIso: 'IT',
      language: 'it',
      brandvehic_reftech: 'FT', // non deve più finire nel risultato (v. v360Service::getCachedBrand)
    });

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(getSessionDataFn).toHaveBeenCalledWith('dealer1.d001');
    expect(result).toEqual({
      mainSincom: '0062230',
      market: '10102',
      dealerCountryCode: 'IT',
      language: 'it',
    });
    expect(setCacheItem).toHaveBeenCalledTimes(1);
    const [cacheKey, sessionData, ttlSeconds] = setCacheItem.mock.calls[0];
    expect(cacheKey).toBe(CACHE_KEY);
    expect(sessionData.sincom).toBe('0062230');
    expect(ttlSeconds).toBe(300); // default 5 minuti, in secondi
  });

  test('cache hit: reads from DynamoDB and does not call getSessionDataFn', async () => {
    getCacheItem.mockResolvedValue({ sincom: '0062230', codmarket: '10102', marketIso: 'IT', language: 'it' });
    const getSessionDataFn = jest.fn();

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(getCacheItem).toHaveBeenCalledWith(CACHE_KEY);
    expect(getSessionDataFn).not.toHaveBeenCalled();
    expect(result).toEqual({ mainSincom: '0062230', market: '10102', dealerCountryCode: 'IT', language: 'it' });
  });

  test('cache expired/missing: re-resolves via getSessionDataFn (expiry is enforced by dynamoCache itself)', async () => {
    getCacheItem.mockResolvedValue(null);
    const getSessionDataFn = jest.fn().mockResolvedValue({ sincom: '0062230' });

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(getSessionDataFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mainSincom: '0062230' });
  });

  test('respects a custom ttlMs override when writing the cache', async () => {
    getCacheItem.mockResolvedValue(null);
    const getSessionDataFn = jest.fn().mockResolvedValue({ sincom: '0062230' });

    await getCachedSessionContext('dealer1.d001', { getSessionDataFn, ttlMs: 2000 });

    const [, , ttlSeconds] = setCacheItem.mock.calls[0];
    expect(ttlSeconds).toBe(2); // 2000ms -> 2s
  });

  test('respects SESSION_CONTEXT_CACHE_TTL_MS env var when ttlMs override is not provided', async () => {
    process.env.SESSION_CONTEXT_CACHE_TTL_MS = '3000';
    getCacheItem.mockResolvedValue(null);
    const getSessionDataFn = jest.fn().mockResolvedValue({ sincom: '0062230' });

    await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    const [, , ttlSeconds] = setCacheItem.mock.calls[0];
    expect(ttlSeconds).toBe(3); // 3000ms -> 3s
  });

  test('is best-effort: swallows cache write failures and still returns the resolved fields', async () => {
    getCacheItem.mockResolvedValue(null);
    setCacheItem.mockResolvedValue(undefined); // dynamoCache è già best-effort internamente
    const getSessionDataFn = jest.fn().mockResolvedValue({ sincom: '0062230' });

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(result).toEqual({ mainSincom: '0062230' });
  });

  test('is best-effort: returns {} and logs a warning when getSessionDataFn rejects', async () => {
    getCacheItem.mockResolvedValue(null);
    const getSessionDataFn = jest.fn().mockRejectedValue(new Error('myPeople unreachable'));

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(result).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile risolvere i dati di sessione per "dealer1.d001"'));
  });

  test('uses buildMyPeopleDmsRepository().getSessionData by default when getSessionDataFn is not overridden', async () => {
    getCacheItem.mockResolvedValue(null);
    const getSessionData = jest.fn().mockResolvedValue({ sincom: '0062230' });
    buildMyPeopleDmsRepository.mockReturnValue({ getSessionData });

    const result = await getCachedSessionContext('dealer1.d001');

    expect(buildMyPeopleDmsRepository).toHaveBeenCalledTimes(1);
    expect(getSessionData).toHaveBeenCalledWith('dealer1.d001');
    expect(result).toEqual({ mainSincom: '0062230' });
  });

  test('uses the raw username (no sanitization needed for a DynamoDB partition key) as the cache key', async () => {
    getCacheItem.mockResolvedValue(null);
    const getSessionDataFn = jest.fn().mockResolvedValue({});

    await getCachedSessionContext('weird/../user name!', { getSessionDataFn });

    expect(getCacheItem).toHaveBeenCalledWith('session:context:weird/../user name!');
  });
});
