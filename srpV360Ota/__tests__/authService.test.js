'use strict';

// Test unitari per il modulo authService.js
// Verifica la logica di cache del token PingFederate e la gestione degli errori.

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
jest.mock('fs');

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../authService');

describe('authService – getBearerToken', () => {
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // --- Requirement 2.3, 2.4: Cache hit — token valido restituito senza chiamata HTTP ---
  describe('cache hit – token valido', () => {
    it('restituisce il token dalla cache senza chiamare httpsRequest', async () => {
      // Token che scade tra 120 secondi (ben oltre il buffer di 30s)
      const expiresAt = Date.now() + 120_000;
      const cachedData = JSON.stringify({
        access_token: 'cached-token-abc',
        expires_at: expiresAt,
        scope: 'prd:asv',
        client_id: 'test-client-id',
      });

      fs.readFileSync.mockReturnValue(cachedData);

      const token = await getBearerToken();

      expect(token).toBe('cached-token-abc');
      expect(httpsRequest).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('logga in italiano che il token in cache è valido', async () => {
      const expiresAt = Date.now() + 90_000;
      const cachedData = JSON.stringify({
        access_token: 'cached-token-xyz',
        expires_at: expiresAt,
        scope: 'prd:asv',
        client_id: 'test-client-id',
      });

      fs.readFileSync.mockReturnValue(cachedData);

      await getBearerToken();

      // Verifica che il messaggio di log contenga il testo italiano atteso
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[auth\] Token in cache valido \(scade tra \d+s\)/)
      );
    });

    it('richiede un nuovo token quando lo scope in cache non corrisponde a quello configurato', async () => {
      const expiresAt = Date.now() + 120_000;
      const cachedData = JSON.stringify({
        access_token: 'stale-wrong-scope-token',
        expires_at: expiresAt,
        scope: 'prd:dgt',
        client_id: 'test-client-id',
      });
      fs.readFileSync.mockReturnValue(cachedData);
      fs.writeFileSync.mockImplementation(() => {});
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
      const expiresAt = Date.now() + 120_000;
      const cachedData = JSON.stringify({ access_token: 'legacy-cached-token', expires_at: expiresAt });
      fs.readFileSync.mockReturnValue(cachedData);
      fs.writeFileSync.mockImplementation(() => {});
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
    it('richiede un nuovo token quando il cache è scaduto (oltre buffer 30s)', async () => {
      // Token scaduto: expires_at è nel passato
      const expiredData = JSON.stringify({ access_token: 'old-token', expires_at: Date.now() - 1000 });
      fs.readFileSync.mockReturnValue(expiredData);

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'new-token-123', expires_in: 7200 },
      });

      const token = await getBearerToken();

      expect(token).toBe('new-token-123');
      expect(httpsRequest).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('richiede un nuovo token quando mancano meno di 30s alla scadenza', async () => {
      // Token che scade tra 20 secondi (dentro il buffer di 30s → considerato scaduto)
      const almostExpired = JSON.stringify({ access_token: 'almost-expired', expires_at: Date.now() + 20_000 });
      fs.readFileSync.mockReturnValue(almostExpired);

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'fresh-token', expires_in: 3600 },
      });

      const token = await getBearerToken();

      expect(token).toBe('fresh-token');
      expect(httpsRequest).toHaveBeenCalledTimes(1);
    });

    it('logga il POST verso PingFederate e il nuovo token ottenuto', async () => {
      const expiredData = JSON.stringify({ access_token: 'old', expires_at: Date.now() - 5000 });
      fs.readFileSync.mockReturnValue(expiredData);

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

  // --- Requirement 2.5: Cache miss — file assente forza nuova richiesta ---
  describe('cache miss – file cache assente', () => {
    it('richiede un nuovo token quando readFileSync lancia un errore', async () => {
      // Simula file non trovato
      fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });

      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'token-after-miss', expires_in: 3600 },
      });

      const token = await getBearerToken();

      expect(token).toBe('token-after-miss');
      expect(httpsRequest).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });
  });

  // --- Requirement 2.6: Errore su risposta PingFederate non-200 ---
  describe('errore – risposta PingFederate non-200', () => {
    it('lancia errore con messaggio formattato per HTTP 401', async () => {
      fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

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
      fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

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
      fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

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
    it('scrive il token nel file di cache con expires_at calcolato', async () => {
      fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      const beforeMs = Date.now();
      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { access_token: 'write-test-token', expires_in: 7200 },
      });

      await getBearerToken();

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [filePath, content] = fs.writeFileSync.mock.calls[0];
      // Verifica che il percorso contenga .token.cache.json
      expect(filePath).toMatch(/\.token\.cache\.json$/);
      // Verifica il contenuto scritto
      const written = JSON.parse(content);
      expect(written.access_token).toBe('write-test-token');
      // expires_at deve essere circa now + 7200*1000
      const afterMs = Date.now();
      expect(written.expires_at).toBeGreaterThanOrEqual(beforeMs + 7200_000);
      expect(written.expires_at).toBeLessThanOrEqual(afterMs + 7200_000);
      expect(written.scope).toBe('prd:asv');
      expect(written.client_id).toBe('test-client-id');
    });
  });
});
