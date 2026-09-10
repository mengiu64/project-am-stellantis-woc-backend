'use strict';

jest.mock('fs');
jest.mock('../src/repositoryFactory');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildMyPeopleDmsRepository } = require('../src/repositoryFactory');
const { getCachedSessionContext } = require('../src/sessionContextCache');

const CACHE_FILE = path.join(os.tmpdir(), 'session-context-dealer1.d001.json');

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
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
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
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content, encoding] = fs.writeFileSync.mock.calls[0];
    expect(filePath).toBe(CACHE_FILE);
    expect(encoding).toBe('utf8');
    const persisted = JSON.parse(content);
    expect(typeof persisted.cachedAt).toBe('number');
    expect(persisted.sessionData.sincom).toBe('0062230');
  });

  test('cache hit: reads a fresh /tmp cache file and does not call getSessionDataFn', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({
      cachedAt: Date.now(),
      sessionData: { sincom: '0062230', codmarket: '10102', marketIso: 'IT', language: 'it' },
    }));
    const getSessionDataFn = jest.fn();

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(fs.readFileSync).toHaveBeenCalledWith(CACHE_FILE, 'utf8');
    expect(getSessionDataFn).not.toHaveBeenCalled();
    expect(result).toEqual({ mainSincom: '0062230', market: '10102', dealerCountryCode: 'IT', language: 'it' });
  });

  test('cache expired (older than TTL): ignores the stale cache and re-resolves via getSessionDataFn', async () => {
    const staleCachedAt = Date.now() - (6 * 60 * 1000); // 6 minuti fa, oltre il TTL di default (5 min)
    fs.readFileSync.mockReturnValue(JSON.stringify({
      cachedAt: staleCachedAt,
      sessionData: { sincom: 'STALE' },
    }));
    const getSessionDataFn = jest.fn().mockResolvedValue({ sincom: '0062230' });

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(getSessionDataFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mainSincom: '0062230' });
  });

  test('respects a custom ttlMs override', async () => {
    const cachedAt = Date.now() - 1000; // 1 secondo fa
    fs.readFileSync.mockReturnValue(JSON.stringify({ cachedAt, sessionData: { sincom: '0062230' } }));
    const getSessionDataFn = jest.fn();

    // TTL di 500ms: la cache di 1s fa deve essere considerata scaduta
    await getCachedSessionContext('dealer1.d001', { getSessionDataFn, ttlMs: 500 });
    expect(getSessionDataFn).toHaveBeenCalledTimes(1);
  });

  test('respects SESSION_CONTEXT_CACHE_TTL_MS env var when ttlMs override is not provided', async () => {
    process.env.SESSION_CONTEXT_CACHE_TTL_MS = '500';
    const cachedAt = Date.now() - 1000;
    fs.readFileSync.mockReturnValue(JSON.stringify({ cachedAt, sessionData: { sincom: '0062230' } }));
    const getSessionDataFn = jest.fn();

    await getCachedSessionContext('dealer1.d001', { getSessionDataFn });
    expect(getSessionDataFn).toHaveBeenCalledTimes(1);
  });

  test('ignores an unreadable/corrupted cache file and falls back to getSessionDataFn', async () => {
    fs.readFileSync.mockReturnValue('not-json{{{');
    const getSessionDataFn = jest.fn().mockResolvedValue({ sincom: '0062230' });

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(getSessionDataFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mainSincom: '0062230' });
  });

  test('is best-effort: swallows writeFileSync errors and still returns the resolved fields', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
    const getSessionDataFn = jest.fn().mockResolvedValue({ sincom: '0062230' });

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(result).toEqual({ mainSincom: '0062230' });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile salvare la cache di sessione'));
  });

  test('is best-effort: returns {} and logs a warning when getSessionDataFn rejects', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const getSessionDataFn = jest.fn().mockRejectedValue(new Error('myPeople unreachable'));

    const result = await getCachedSessionContext('dealer1.d001', { getSessionDataFn });

    expect(result).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile risolvere i dati di sessione per "dealer1.d001"'));
  });

  test('uses buildMyPeopleDmsRepository().getSessionData by default when getSessionDataFn is not overridden', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const getSessionData = jest.fn().mockResolvedValue({ sincom: '0062230' });
    buildMyPeopleDmsRepository.mockReturnValue({ getSessionData });

    const result = await getCachedSessionContext('dealer1.d001');

    expect(buildMyPeopleDmsRepository).toHaveBeenCalledTimes(1);
    expect(getSessionData).toHaveBeenCalledWith('dealer1.d001');
    expect(result).toEqual({ mainSincom: '0062230' });
  });

  test('sanitizes the username used for the cache file name', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const getSessionDataFn = jest.fn().mockResolvedValue({});

    await getCachedSessionContext('weird/../user name!', { getSessionDataFn });

    const [filePath] = fs.readFileSync.mock.calls[0];
    expect(filePath).not.toMatch(/[/\\]\.\./);
    expect(path.basename(filePath)).toMatch(/^session-context-[a-zA-Z0-9._-]+\.json$/);
  });
});
