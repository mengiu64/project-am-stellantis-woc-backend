'use strict';

// Test unitari per il modulo index.js (handler Lambda)
// Verifica il routing delle azioni, la risoluzione dell'evento (diretto e API Gateway proxy),
// la gestione degli errori (400 vs 502) e il formato delle risposte.

jest.mock('../authService', () => ({
  getBearerToken: jest.fn().mockResolvedValue('mock-bearer-token'),
}));
jest.mock('../otaService', () => ({
  otaCompatibility: jest.fn(),
}));
jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    auth: { url: '', grantType: '', scope: '', clientId: '', clientSecret: '' },
    srp: { baseUrl: '', basePath: '', clientId: '', clientSecret: '' },
    otaDefaults: { includeOtaHistoryData: 'true', locale: 'en_US' },
  }),
}));

const { handler } = require('../index');
const { otaCompatibility } = require('../otaService');

describe('index.js – handler Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Requirement 4.2: Risoluzione azione da invocazione diretta ---
  describe('formato invocazione diretta', () => {
    it('risolve action e body da evento diretto { action, body }', async () => {
      const mockResult = { otaCompatible: true, count: 1 };
      otaCompatibility.mockResolvedValue(mockResult);

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'ABC' } });

      expect(response.statusCode).toBe(200);
      expect(otaCompatibility).toHaveBeenCalledWith('mock-bearer-token', { vin: 'ABC' });
    });

    it('parsa il body stringa JSON in invocazione diretta', async () => {
      otaCompatibility.mockResolvedValue({ ok: true });

      await handler({ action: 'otaCompatibility', body: '{"vin":"XYZ123"}' });

      expect(otaCompatibility).toHaveBeenCalledWith('mock-bearer-token', { vin: 'XYZ123' });
    });
  });

  // --- Requirement 4.2: Risoluzione azione da API Gateway proxy ---
  describe('formato API Gateway proxy integration', () => {
    it('risolve action dall\'ultimo segmento del path', async () => {
      otaCompatibility.mockResolvedValue({ otaCompatible: false });

      const event = {
        path: '/api/v360/otaCompatibility',
        body: '{"vin":"VR3UPHPX5P4347291"}',
        httpMethod: 'POST',
      };
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(otaCompatibility).toHaveBeenCalledWith('mock-bearer-token', { vin: 'VR3UPHPX5P4347291' });
    });

    it('unisce queryStringParameters nel body', async () => {
      otaCompatibility.mockResolvedValue({ merged: true });

      const event = {
        path: '/api/v360/otaCompatibility',
        body: '{"vin":"VIN123"}',
        queryStringParameters: { locale: 'fr_FR' },
        httpMethod: 'POST',
      };
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      // queryStringParameters vengono unite con il body; il body ha precedenza per campi duplicati
      expect(otaCompatibility).toHaveBeenCalledWith('mock-bearer-token', { locale: 'fr_FR', vin: 'VIN123' });
    });
  });

  // --- Requirement 4.5: Azione valida restituisce HTTP 200 ---
  describe('azione otaCompatibility – successo', () => {
    it('restituisce HTTP 200 con il risultato del servizio', async () => {
      const mockData = { otaCompatible: true, count: 3, campaigns: [] };
      otaCompatibility.mockResolvedValue(mockData);

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'VIN1' } });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockData);
    });
  });

  // --- Requirement 4.3, 4.4: Azione sconosciuta restituisce HTTP 400 ---
  describe('azione sconosciuta – HTTP 400', () => {
    it('restituisce HTTP 400 per azione non valida', async () => {
      const response = await handler({ action: 'invalid' });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Azione sconosciuta: "invalid"');
      expect(body.message).toContain('Azioni valide: otaCompatibility');
    });

    it('restituisce HTTP 400 quando action è undefined (evento vuoto)', async () => {
      const response = await handler({});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Azione sconosciuta');
    });

    it('non invoca otaService per azione sconosciuta', async () => {
      await handler({ action: 'nonExistent' });

      expect(otaCompatibility).not.toHaveBeenCalled();
    });
  });

  // --- Requirement 4.6: Errore "is required" restituisce HTTP 400 ---
  describe('errore con "is required" – HTTP 400', () => {
    it('restituisce HTTP 400 quando l\'errore contiene "is required"', async () => {
      otaCompatibility.mockRejectedValue(
        new Error('[srpV360Ota] vin is required for otaCompatibility')
      );

      const response = await handler({ action: 'otaCompatibility', body: {} });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('[srpV360Ota] vin is required for otaCompatibility');
    });
  });

  // --- Requirement 4.7: Altri errori restituiscono HTTP 502 ---
  describe('altri errori – HTTP 502', () => {
    it('restituisce HTTP 502 per errori di upstream (non "is required")', async () => {
      otaCompatibility.mockRejectedValue(
        new Error('[srpV360Ota] otaCompatibility fallita: HTTP 500 - {"error":"fail"}')
      );

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'VIN1' } });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('otaCompatibility fallita');
    });

    it('restituisce HTTP 502 per errori di rete', async () => {
      otaCompatibility.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'VIN2' } });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('connect ECONNREFUSED');
    });
  });

  // --- Requirement 4.8: Tutte le risposte hanno Content-Type: application/json ---
  describe('header Content-Type su tutte le risposte', () => {
    it('risposta di successo ha Content-Type: application/json', async () => {
      otaCompatibility.mockResolvedValue({ ok: true });

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'VIN' } });

      expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('risposta errore 400 (azione sconosciuta) ha Content-Type: application/json', async () => {
      const response = await handler({ action: 'unknown' });

      expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('risposta errore 400 (is required) ha Content-Type: application/json', async () => {
      otaCompatibility.mockRejectedValue(new Error('vin is required'));

      const response = await handler({ action: 'otaCompatibility', body: {} });

      expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('risposta errore 502 ha Content-Type: application/json', async () => {
      otaCompatibility.mockRejectedValue(new Error('network timeout'));

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'V' } });

      expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
    });
  });

  // --- Requirement 4.8: Body è sempre JSON valido ---
  describe('body è sempre una stringa JSON valida', () => {
    it('risposta di successo contiene body JSON parsabile', async () => {
      otaCompatibility.mockResolvedValue({ data: [1, 2, 3] });

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'VIN' } });

      expect(() => JSON.parse(response.body)).not.toThrow();
    });

    it('risposta errore 400 contiene body JSON parsabile', async () => {
      const response = await handler({ action: 'badAction' });

      expect(() => JSON.parse(response.body)).not.toThrow();
    });

    it('risposta errore 502 contiene body JSON parsabile', async () => {
      otaCompatibility.mockRejectedValue(new Error('something failed'));

      const response = await handler({ action: 'otaCompatibility', body: { vin: 'V' } });

      expect(() => JSON.parse(response.body)).not.toThrow();
    });
  });
});
