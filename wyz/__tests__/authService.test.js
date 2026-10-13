'use strict';

const mockHttps = jest.fn();
const mockGetCache = jest.fn();
const mockSetCache = jest.fn();
jest.mock('../httpClient', () => ({ httpsRequest: (...a) => mockHttps(...a) }));
jest.mock('../dynamoCache', () => ({
  getCacheItem: (...a) => mockGetCache(...a),
  setCacheItem: (...a) => mockSetCache(...a),
}));
jest.mock('../config', () => ({
  getConfig: async () => ({
    auth: {
      url: 'https://iam.wyz.test/realms/STA/protocol/openid-connect/token',
      grantType: 'client_credentials',
      clientId: 'wi-advisor',
      clientSecret: 'shh',
    },
    timeoutMs: 1000,
  }),
}));

const { getBearerToken, invalidateToken } = require('../authService');

describe('authService (wyz)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('restituisce il token in cache se il client_id coincide', async () => {
    mockGetCache.mockResolvedValue({ access_token: 'cached', client_id: 'wi-advisor' });
    await expect(getBearerToken()).resolves.toBe('cached');
    expect(mockHttps).not.toHaveBeenCalled();
  });

  it('ignora il token in cache emesso per un altro client_id', async () => {
    mockGetCache.mockResolvedValue({ access_token: 'old', client_id: 'other' });
    mockHttps.mockResolvedValue({ statusCode: 200, body: { access_token: 'new', expires_in: 300 } });
    await expect(getBearerToken()).resolves.toBe('new');
  });

  it('ignora una cache senza access_token', async () => {
    mockGetCache.mockResolvedValue({});
    mockHttps.mockResolvedValue({ statusCode: 200, body: { access_token: 'new' } });
    await expect(getBearerToken()).resolves.toBe('new');
  });

  it('richiede un nuovo token con client_credentials e lo salva in cache con buffer', async () => {
    mockGetCache.mockResolvedValue(null);
    mockHttps.mockResolvedValue({ statusCode: 200, body: { access_token: 'tok', expires_in: 300 } });

    await expect(getBearerToken()).resolves.toBe('tok');

    const [options, body] = mockHttps.mock.calls[0];
    expect(options).toMatchObject({
      hostname: 'iam.wyz.test', port: 443, method: 'POST', timeout: 1000,
      path: '/realms/STA/protocol/openid-connect/token',
    });
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=wi-advisor');
    expect(mockSetCache).toHaveBeenCalledWith('wyz:authtoken', { access_token: 'tok', client_id: 'wi-advisor' }, 270);
  });

  it('usa expires_in di default (300s) se assente', async () => {
    mockGetCache.mockResolvedValue(null);
    mockHttps.mockResolvedValue({ statusCode: 200, body: { access_token: 'tok' } });
    await getBearerToken();
    expect(mockSetCache.mock.calls[0][2]).toBe(270);
  });

  it('non va sotto zero come TTL', async () => {
    mockGetCache.mockResolvedValue(null);
    mockHttps.mockResolvedValue({ statusCode: 200, body: { access_token: 'tok', expires_in: 10 } });
    await getBearerToken();
    expect(mockSetCache.mock.calls[0][2]).toBe(0);
  });

  it('lancia errore (senza esporre il body) se l\'IAM risponde con status non 200', async () => {
    mockGetCache.mockResolvedValue(null);
    mockHttps.mockResolvedValue({ statusCode: 401, body: { error: 'invalid_client' } });
    await expect(getBearerToken()).rejects.toThrow('HTTP 401');
  });

  it('lancia errore se manca access_token', async () => {
    mockGetCache.mockResolvedValue(null);
    mockHttps.mockResolvedValue({ statusCode: 200, body: {} });
    await expect(getBearerToken()).rejects.toThrow('Nessun access_token');
  });

  it('lancia errore se la risposta non ha body', async () => {
    mockGetCache.mockResolvedValue(null);
    mockHttps.mockResolvedValue({ statusCode: 200, body: null });
    await expect(getBearerToken()).rejects.toThrow('Nessun access_token');
  });

  it('invalidateToken scrive un item già scaduto', async () => {
    await invalidateToken();
    expect(mockSetCache).toHaveBeenCalledWith('wyz:authtoken', null, 0);
  });
});
