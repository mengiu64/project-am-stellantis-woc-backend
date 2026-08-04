'use strict';

// Test unitari per il modulo otaService.js
// Verifica la validazione del VIN, l'applicazione dei default, la costruzione della richiesta upstream
// e la gestione delle risposte (successo e errore).

jest.mock('../httpClient');
jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    auth: {
      url: 'https://idfed.mpsa.com:443/as/token.oauth2',
      grantType: 'client_credentials',
      scope: 'prd:asv',
      clientId: 'ping-id',
      clientSecret: 'ping-secret',
    },
    srp: {
      baseUrl: 'https://emea-aws.api.stellantis.com',
      basePath: '/ps-prod/extra/asv360/vehicle/v1',
      clientId: 'ibm-client-id',
      clientSecret: 'ibm-client-secret',
    },
    otaDefaults: { includeOtaHistoryData: 'true', locale: 'en_US' },
  }),
}));

const { httpsRequest } = require('../httpClient');
const { otaCompatibility } = require('../otaService');

describe('otaService – otaCompatibility', () => {
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // --- Requirement 5.1, 5.2: Validazione VIN ---
  describe('validazione VIN', () => {
    it('lancia errore quando params è un oggetto vuoto (vin assente)', async () => {
      await expect(otaCompatibility('token', {})).rejects.toThrow(
        '[srpV360Ota] vin is required for otaCompatibility'
      );
    });

    it('lancia errore quando vin è stringa vuota', async () => {
      await expect(otaCompatibility('token', { vin: '' })).rejects.toThrow(
        '[srpV360Ota] vin is required for otaCompatibility'
      );
    });

    it('lancia errore quando vin è null', async () => {
      await expect(otaCompatibility('token', { vin: null })).rejects.toThrow(
        '[srpV360Ota] vin is required for otaCompatibility'
      );
    });

    it('lancia errore quando vin è undefined', async () => {
      await expect(otaCompatibility('token', { vin: undefined })).rejects.toThrow(
        '[srpV360Ota] vin is required for otaCompatibility'
      );
    });

    it('non chiama httpsRequest se il VIN è mancante', async () => {
      try { await otaCompatibility('token', {}); } catch { /* atteso */ }
      expect(httpsRequest).not.toHaveBeenCalled();
    });
  });

  // --- Requirement 5.3, 5.4: Parametri di default ---
  describe('parametri di default', () => {
    it('applica includeOtaHistoryData=true e locale=en_US quando non forniti', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { otaCompatible: true } });

      await otaCompatibility('my-token', { vin: 'VR3UPHPX5P4347291' });

      const [options, bodyStr] = httpsRequest.mock.calls[0];
      const body = JSON.parse(bodyStr);
      expect(body.includeOtaHistoryData).toBe('true');
      expect(body.locale).toBe('en_US');
    });

    it('usa i valori custom quando includeOtaHistoryData e locale sono forniti', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { result: 'ok' } });

      await otaCompatibility('my-token', {
        vin: 'VR3UPHPX5P4347291',
        includeOtaHistoryData: 'true',
        locale: 'fr_FR',
      });

      const [options, bodyStr] = httpsRequest.mock.calls[0];
      const body = JSON.parse(bodyStr);
      expect(body.includeOtaHistoryData).toBe('true');
      expect(body.locale).toBe('fr_FR');
    });

    it('invia il VIN nel body della richiesta', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      await otaCompatibility('my-token', { vin: 'ZACNJAC55PJK61998' });

      const [options, bodyStr] = httpsRequest.mock.calls[0];
      const body = JSON.parse(bodyStr);
      expect(body.vin).toBe('ZACNJAC55PJK61998');
    });
  });

  // --- Requirement 5.7: Risposta upstream 200 restituita invariata ---
  describe('risposta upstream successo', () => {
    it('restituisce il body della risposta upstream invariato con HTTP 200', async () => {
      const upstreamBody = { otaCompatible: true, count: 3, campaigns: [{ id: 'c1' }] };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: upstreamBody });

      const result = await otaCompatibility('bearer-xyz', { vin: 'VR3UPHPX5P4347291' });

      expect(result).toEqual(upstreamBody);
    });

    it('non trasforma campi della risposta upstream', async () => {
      const upstreamBody = { otaCompatible: false, count: 0 };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: upstreamBody });

      const result = await otaCompatibility('token-abc', { vin: 'VR7EDYHT3RN562639' });

      expect(result).toBe(upstreamBody); // stessa referenza, non una copia
    });
  });

  // --- Requirement 5.8: Errore su risposta upstream non-200 ---
  describe('errore – risposta upstream non-200', () => {
    it('lancia errore formattato per HTTP 500', async () => {
      httpsRequest.mockResolvedValue({
        statusCode: 500,
        headers: {},
        body: { error: 'fail' },
      });

      await expect(
        otaCompatibility('token', { vin: 'VR3UPHPX5P4347291' })
      ).rejects.toThrow(
        '[srpV360Ota] otaCompatibility fallita: HTTP 500 - {"error":"fail"}'
      );
    });

    it('lancia errore formattato per HTTP 401', async () => {
      httpsRequest.mockResolvedValue({
        statusCode: 401,
        headers: {},
        body: { error: 'unauthorized', message: 'Invalid token' },
      });

      await expect(
        otaCompatibility('expired-token', { vin: 'VR3UPHPX5P4347291' })
      ).rejects.toThrow(
        '[srpV360Ota] otaCompatibility fallita: HTTP 401 - {"error":"unauthorized","message":"Invalid token"}'
      );
    });

    it('lancia errore formattato per HTTP 404', async () => {
      httpsRequest.mockResolvedValue({
        statusCode: 404,
        headers: {},
        body: { message: 'Not Found' },
      });

      await expect(
        otaCompatibility('token', { vin: 'INVALID_VIN_12345' })
      ).rejects.toThrow(
        '[srpV360Ota] otaCompatibility fallita: HTTP 404 - {"message":"Not Found"}'
      );
    });
  });

  // --- Requirement 5.5: Header richiesti nella richiesta upstream ---
  describe('header della richiesta upstream', () => {
    it('include tutti gli header richiesti', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      await otaCompatibility('bearer-token-123', { vin: 'VR3UPHPX5P4347291' });

      const [options] = httpsRequest.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['Accept']).toBe('application/json');
      expect(options.headers['X-IBM-Client-Id']).toBe('ibm-client-id');
      expect(options.headers['X-IBM-Client-Secret']).toBe('ibm-client-secret');
      expect(options.headers['Authorization']).toBe('Bearer bearer-token-123');
      expect(options.headers['x-trace-id']).toBeDefined();
    });

    it('x-trace-id è composto da 16 caratteri esadecimali', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      await otaCompatibility('token', { vin: 'VR3UPHPX5P4347291' });

      const [options] = httpsRequest.mock.calls[0];
      expect(options.headers['x-trace-id']).toMatch(/^[0-9a-f]{16}$/);
    });

    it('x-trace-id è diverso ad ogni invocazione', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      await otaCompatibility('token', { vin: 'VR3UPHPX5P4347291' });
      await otaCompatibility('token', { vin: 'VR3UPHPX5P4347291' });

      const traceId1 = httpsRequest.mock.calls[0][0].headers['x-trace-id'];
      const traceId2 = httpsRequest.mock.calls[1][0].headers['x-trace-id'];
      expect(traceId1).not.toBe(traceId2);
    });
  });

  // --- Requirement 5.5, 5.6: Costruzione URL ---
  describe('costruzione URL upstream', () => {
    it('usa hostname e path corretti dalla configurazione', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      await otaCompatibility('token', { vin: 'VR3UPHPX5P4347291' });

      const [options] = httpsRequest.mock.calls[0];
      expect(options.hostname).toBe('emea-aws.api.stellantis.com');
      expect(options.path).toBe('/ps-prod/extra/asv360/vehicle/v1/otaCompatibility');
      expect(options.method).toBe('POST');
    });
  });
});
