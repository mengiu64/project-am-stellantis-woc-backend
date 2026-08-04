'use strict';

/**
 * Unit test per il Lambda handler isStellantisBrand.
 * Mock di shared/dbClient.js per evitare connessioni di rete reali.
 */

jest.mock('../shared/dbClient');

const { getPool } = require('../shared/dbClient');
const { handler } = require('../index');

// Contesto Lambda mock
const mockContext = { awsRequestId: 'test-request-id-123' };

// Helper per creare un evento API Gateway
function makeEvent(arCodbrand) {
  if (arCodbrand === undefined) {
    return { queryStringParameters: null };
  }
  return { queryStringParameters: { ar_codbrand: arCodbrand } };
}

// Mock del pool con query configurabile
function setupPoolMock(queryFn) {
  getPool.mockResolvedValue({ query: queryFn });
}

describe('isStellantisBrand handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.log durante i test
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  // ── Test di validazione ──────────────────────────────────────────────────

  describe('Validazione input', () => {
    test('ar_codbrand mancante (queryStringParameters null) → 400', async () => {
      const event = { queryStringParameters: null };
      const res = await handler(event, mockContext);

      expect(res.statusCode).toBe(400);
      expect(res.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand è obbligatorio');
    });

    test('ar_codbrand mancante (parametro assente) → 400', async () => {
      const event = { queryStringParameters: {} };
      const res = await handler(event, mockContext);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand è obbligatorio');
    });

    test('ar_codbrand vuoto → 400', async () => {
      const res = await handler(makeEvent(''), mockContext);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand è obbligatorio');
    });

    test('ar_codbrand solo whitespace → 400', async () => {
      const res = await handler(makeEvent('  '), mockContext);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand è obbligatorio');
    });

    test('ar_codbrand > 2 caratteri → 400', async () => {
      const res = await handler(makeEvent('ABC'), mockContext);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand deve essere di massimo 2 caratteri');
    });

    test('ar_codbrand con caratteri non alfabetici (numeri) → 400', async () => {
      const res = await handler(makeEvent('A1'), mockContext);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand deve contenere solo caratteri alfabetici');
    });

    test('ar_codbrand con caratteri speciali → 400', async () => {
      const res = await handler(makeEvent('A@'), mockContext);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand deve contenere solo caratteri alfabetici');
    });
  });

  // ── Test di lookup brand ─────────────────────────────────────────────────

  describe('Lookup brand nel database', () => {
    test('brand trovato con logo_s3_key valorizzato → 200 + isStellantisBrand: true + logoS3Key stringa', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'assets/images/logo/brand-stla/ALFAROMEO.png' }] }));

      const res = await handler(makeEvent('AR'), mockContext);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isStellantisBrand).toBe(true);
      expect(body.logoS3Key).toBe('assets/images/logo/brand-stla/ALFAROMEO.png');
    });

    test('brand trovato con logo_s3_key NULL → 200 + isStellantisBrand: true + logoS3Key: null', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: null }] }));

      const res = await handler(makeEvent('CT'), mockContext);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isStellantisBrand).toBe(true);
      expect(body.logoS3Key).toBeNull();
    });

    test('brand trovato con logo_s3_key stringa vuota → 200 + isStellantisBrand: true + logoS3Key: null', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: '' }] }));

      const res = await handler(makeEvent('AR'), mockContext);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isStellantisBrand).toBe(true);
      expect(body.logoS3Key).toBeNull();
    });

    test('brand non trovato → 200 + isStellantisBrand: false + logoS3Key assente', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [] }));

      const res = await handler(makeEvent('ZZ'), mockContext);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isStellantisBrand).toBe(false);
      expect(body).not.toHaveProperty('logoS3Key');
    });

    test('input lowercase viene convertito a uppercase nella query', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'assets/images/logo/brand-stla/ALFAROMEO.png' }] });
      setupPoolMock(mockQuery);

      await handler(makeEvent('ar'), mockContext);

      // Verifica che la query sia stata chiamata con il valore uppercase
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          values: ['AR'],
        })
      );
    });

    test('singolo carattere valido → query eseguita correttamente', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      setupPoolMock(mockQuery);

      const res = await handler(makeEvent('a'), mockContext);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.isStellantisBrand).toBe(false);
      expect(body).not.toHaveProperty('logoS3Key');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          values: ['A'],
        })
      );
    });

    test('query usa SELECT logo_s3_key (non SELECT 1)', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'assets/images/logo/brand-stla/FIAT.png' }] });
      setupPoolMock(mockQuery);

      await handler(makeEvent('FT'), mockContext);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('SELECT logo_s3_key'),
        })
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.not.stringContaining('SELECT 1'),
        })
      );
    });

    test('log strutturato include logoS3Key nel messaggio di query riuscita (brand trovato)', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'assets/images/logo/brand-stla/JEEP.png' }] }));

      await handler(makeEvent('JE'), mockContext);

      // Verifica che console.log sia stato chiamato con un JSON che include logoS3Key
      const logCalls = console.log.mock.calls.map(call => {
        try { return JSON.parse(call[0]); } catch { return null; }
      }).filter(Boolean);

      const queryLog = logCalls.find(
        log => log.operation === 'query' && log.message && log.message.includes('brand trovato')
      );
      expect(queryLog).toBeDefined();
      expect(queryLog).toHaveProperty('logoS3Key', 'assets/images/logo/brand-stla/JEEP.png');
    });

    test('log strutturato include logoS3Key: null quando logo_s3_key è NULL', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: null }] }));

      await handler(makeEvent('CT'), mockContext);

      const logCalls = console.log.mock.calls.map(call => {
        try { return JSON.parse(call[0]); } catch { return null; }
      }).filter(Boolean);

      const queryLog = logCalls.find(
        log => log.operation === 'query' && log.message && log.message.includes('brand trovato')
      );
      expect(queryLog).toBeDefined();
      expect(queryLog).toHaveProperty('logoS3Key', null);
    });
  });

  // ── Test di gestione errori ──────────────────────────────────────────────

  describe('Gestione errori', () => {
    test('errore connessione DB (getPool fallisce) → 500', async () => {
      getPool.mockRejectedValue(new Error('Connection timeout'));

      const res = await handler(makeEvent('AR'), mockContext);

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Errore interno del server');
    });

    test('errore query DB → 500', async () => {
      setupPoolMock(jest.fn().mockRejectedValue(new Error('Query timeout')));

      const res = await handler(makeEvent('AR'), mockContext);

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Errore interno del server');
    });

    test('errore Secrets Manager (via getPool) → 500', async () => {
      getPool.mockRejectedValue(new Error('SecretsManager: Access denied'));

      const res = await handler(makeEvent('FT'), mockContext);

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Errore interno del server');
      // Verifica che il messaggio d'errore interno NON sia esposto
      expect(body.message).not.toContain('SecretsManager');
    });

    test('errore 500 non espone stack trace o dettagli interni', async () => {
      getPool.mockRejectedValue(new Error('Internal error at /home/user/app/shared/dbClient.js:42'));

      const res = await handler(makeEvent('AR'), mockContext);

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Errore interno del server');
      expect(res.body).not.toContain('dbClient');
      expect(res.body).not.toContain('/home');
      expect(res.body).not.toContain('stack');
    });
  });

  // ── Test formato risposta ────────────────────────────────────────────────

  describe('Formato risposta', () => {
    test('tutte le risposte hanno statusCode, headers e body', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [] }));

      const res = await handler(makeEvent('AR'), mockContext);

      expect(res).toHaveProperty('statusCode');
      expect(res).toHaveProperty('headers');
      expect(res).toHaveProperty('body');
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(() => JSON.parse(res.body)).not.toThrow();
    });

    test('risposta errore 400 ha formato corretto', async () => {
      const res = await handler(makeEvent(''), mockContext);

      expect(typeof res.statusCode).toBe('number');
      expect(typeof res.body).toBe('string');
      expect(res.headers['Content-Type']).toBe('application/json');
    });

    test('risposta errore 500 ha formato corretto', async () => {
      getPool.mockRejectedValue(new Error('fail'));

      const res = await handler(makeEvent('AR'), mockContext);

      expect(typeof res.statusCode).toBe('number');
      expect(typeof res.body).toBe('string');
      expect(res.headers['Content-Type']).toBe('application/json');
    });
  });
});
