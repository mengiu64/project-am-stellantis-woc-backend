'use strict';

// Test unitari per il modulo authService.js
// Verifica la logica di cache del token PingFederate (su DynamoDB) e la gestione degli errori.

jest.mock('../httpClient');
jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    auth: {
      url: 'https://idfed.mpsa.com:443/as/token.oauth2',
      grantType: 'client_credentials',
      scope: 'prd:asv',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
    srp: { baseUrl: '', basePath: '', clientId: '', clientSecret: '' },
    otaDefaults: { includeOtaHistoryData: 'true', locale: 'en_US' },
  }),
}));
const mockGetCacheItem = jest.fn();
const mockSetCacheItem = jest.fn();
jest.mock('../dynamoCache', () => ({
  getCacheItem: (...args) => mockGetCacheItem(...args),
  setCacheItem: (...args) => mockSetCacheItem(...args),
}));

const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');

describe('authService – getBearerToken', () => {
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockSetCacheItem.mockImplementation((key, value) => Promise.resolve(value));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // --- Requirement 2.3, 2.4: Cache hit — token valido restituito senza chiamata HTTP ---
  describe('cache hit – token valido', () => {
    it('restituisce il token dalla cache senza chiamare httpsRequest', async () => {
      mockGetCacheItem.mockResolvedValue({
        access_token: 'cached-token-abc',
        scope: 'prd:asv',
        client_id: 'test-client-id',
      });

      const token = await getBearerToken();

      expect(token).toBe('cached-token-abc');
      expect(httpsRequest).not.toHaveBeenCalled();
      expect(mockSetCacheItem).not.toHaveBeenCalled();
    });

    it('logga che il token in cache è valido', async () => {
      mockGetCacheItem.mockResolvedValue({
        access_token: 'cached-token-xyz',
        scope: 'prd:asv',
        client_id: 'test-client-id',
      });

      await getBearerToken();

      expect(consoleLogSpy).toHaveBeenCalledWith('[auth] Token in cache valido');
    });

    it('richiede un nuovo token quando lo scope in cache non corrisponde a quello configurato', async () => {
      mockGetCacheItem.mockResolvedValue({
        access_token: 'stale-wrong-scope-token',
        scope: 'prd:dgt',
        client_id: 'test-client-id',
      });
      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'new-scoped-token', expires_in: 3600 },
      });

      const token = await getBearerToken();

      expect(token).toBe('new-scoped-token');
      expect(httpsRequest).toHaveBeenCalledTimes(1);
    });

    it('richiede un nuovo token quando il cache non contiene scope/client_id (voce legacy)', async () => {
      mockGetCacheItem.mockResolvedValue({ access_token: 'legacy-cached-token' });
      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'new-scoped-token', expires_in: 3600 },
      });

      const token = await getBearerToken();

      expect(token).toBe('new-scoped-token');
      expect(httpsRequest).toHaveBeenCalledTimes(1);
    });
  });

  // --- Requirement 2.5: Cache miss — token scaduto forza nuova richiesta ---
  describe('cache miss – token scaduto', () => {
    it('richiede un nuovo token quando il cache è scaduto (getCacheItem restituisce null)', async () => {
      // DynamoDB (via dynamoCache.getCacheItem) restituisce null quando l'item è scaduto
      mockGetCacheItem.mockResolvedValue(null);

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'new-token-123', expires_in: 7200 },
      });

      const token = await getBearerToken();

      expect(token).toBe('new-token-123');
      expect(httpsRequest).toHaveBeenCalledTimes(1);
      expect(mockSetCacheItem).toHaveBeenCalledTimes(1);
    });

    it('logga il POST verso PingFederate e il nuovo token ottenuto', async () => {
      mockGetCacheItem.mockResolvedValue(null);

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'brand-new-token', expires_in: 3600 },
      });

      await getBearerToken();

      // Verifica log POST verso PingFederate
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[auth] POST https://idfed.mpsa.com:443/as/token.oauth2'
      );
      // Verifica log nuovo token ottenuto in italiano
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[auth\] Nuovo token ottenuto \(expires_in: 3600s\) — salvato in cache/)
      );
    });
  });

  // --- Requirement 2.5: Cache miss — nessun item in cache forza nuova richiesta ---
  describe('cache miss – nessun item in cache', () => {
    it('richiede un nuovo token quando getCacheItem restituisce null', async () => {
      mockGetCacheItem.mockResolvedValue(null);

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'token-after-miss', expires_in: 3600 },
      });

      const token = await getBearerToken();

      expect(token).toBe('token-after-miss');
      expect(httpsRequest).toHaveBeenCalledTimes(1);
      expect(mockSetCacheItem).toHaveBeenCalledTimes(1);
    });
  });

  // --- Requirement 2.6: Errore su risposta PingFederate non-200 ---
  describe('errore – risposta PingFederate non-200', () => {
    it('lancia errore con messaggio formattato per HTTP 401', async () => {
      mockGetCacheItem.mockResolvedValue(null);

      httpsRequest.mockResolvedValue({
        statusCode: 401,
        headers: {},
        body: { error: 'invalid_client', error_description: 'Client authentication failed' },
      });

      await expect(getBearerToken()).rejects.toThrow(
        '[auth] Richiesta token fallita: HTTP 401 - {"error":"invalid_client","error_description":"Client authentication failed"}'
      );
    });

    it('lancia errore con messaggio formattato per HTTP 500', async () => {
      mockGetCacheItem.mockResolvedValue(null);

      httpsRequest.mockResolvedValue({
        statusCode: 500,
        headers: {},
        body: { error: 'server_error' },
      });

      await expect(getBearerToken()).rejects.toThrow(
        '[auth] Richiesta token fallita: HTTP 500 - {"error":"server_error"}'
      );
    });
  });

  // --- Requirement 2.7: Errore su risposta senza access_token ---
  describe('errore – risposta senza access_token', () => {
    it('lancia errore quando la risposta 200 non contiene access_token', async () => {
      mockGetCacheItem.mockResolvedValue(null);

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { token_type: 'Bearer', expires_in: 3600 },
      });

      await expect(getBearerToken()).rejects.toThrow(
        '[auth] Nessun access_token nella risposta'
      );
    });
  });

  // --- Requirement 2.2: Scrittura cache dopo nuovo token ---
  describe('scrittura cache', () => {
    it('scrive il token in cache con la chiave, lo scope, il client_id e il ttl corretti', async () => {
      mockGetCacheItem.mockResolvedValue(null);

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'write-test-token', expires_in: 7200 },
      });

      await getBearerToken();

      expect(mockSetCacheItem).toHaveBeenCalledTimes(1);
      const [key, value, ttlSeconds] = mockSetCacheItem.mock.calls[0];
      expect(key).toBe('srpv360ota:authtoken');
      expect(value.access_token).toBe('write-test-token');
      expect(value.scope).toBe('prd:asv');
      expect(value.client_id).toBe('test-client-id');
      // ttl = expires_in - margine di sicurezza di 30s
      expect(ttlSeconds).toBe(7200 - 30);
    });
  });
});
