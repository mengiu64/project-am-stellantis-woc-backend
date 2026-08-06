'use strict';

/**
 * Property-based tests (fast-check) per la feature brand-logo-url.
 * Validano le proprietà di correttezza definite nel design document.
 *
 * Validates: Requirements 2.4, 5.1
 */

const fc = require('fast-check');

jest.mock('../shared/dbClient');
jest.mock('../userSignsService');

const { getPool } = require('../shared/dbClient');
const { handler } = require('../index');

const mockContext = { awsRequestId: 'pbt-logo-request-id' };

function makeEvent(arCodbrand) {
  return { action: 'isStellantisBrand', body: { ar_codbrand: arCodbrand } };
}

// Feature: brand-logo-url, Property 3: Error sanitization

describe('Property 3: Error sanitization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('per qualunque messaggio di errore (SQL, stack trace, nomi tabelle), la risposta HTTP non contiene mai il messaggio originale', async () => {
    // Fixed response body that the handler always returns on error
    const FIXED_ERROR_BODY = '{"success":false,"message":"Errore interno del server"}';

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter(
          (s) => s.trim().length > 0 && !FIXED_ERROR_BODY.includes(s),
        ),
        async (errorMessage) => {
          getPool.mockResolvedValue({
            query: jest.fn().mockRejectedValue(new Error(errorMessage)),
          });

          const res = await handler(makeEvent('AR'), mockContext);

          expect(res.statusCode).toBe(500);
          const body = JSON.parse(res.body);
          expect(body.success).toBe(false);
          expect(body.message).toBe('Errore interno del server');
          // The original error message must never appear in the response body
          expect(res.body).not.toContain(errorMessage);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: brand-logo-url, Property 4: Response always valid JSON

describe('Property 4: Response always valid JSON', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('per qualunque input (valido, invalido, vuoto), JSON.parse(response.body) non lancia mai eccezioni', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.string({ minLength: 0, maxLength: 10 }), { nil: undefined }),
        async (arCodbrand) => {
          // Mock DB to sometimes succeed, sometimes fail
          getPool.mockResolvedValue({
            query: jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'test.png' }] }),
          });

          const event = arCodbrand !== undefined
            ? { action: 'isStellantisBrand', body: { ar_codbrand: arCodbrand } }
            : { action: 'isStellantisBrand', body: {} };

          const res = await handler(event, mockContext);
          
          // The body must ALWAYS be valid JSON
          expect(() => JSON.parse(res.body)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  test('anche in caso di errore DB, JSON.parse(response.body) non lancia mai eccezioni', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[a-zA-Z]{1,2}$/.test(s)),
        async (arCodbrand) => {
          getPool.mockResolvedValue({
            query: jest.fn().mockRejectedValue(new Error('DB error')),
          });

          const event = { action: 'isStellantisBrand', body: { ar_codbrand: arCodbrand } };
          const res = await handler(event, mockContext);
          
          expect(() => JSON.parse(res.body)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: brand-logo-url, Property 2: Brand not found omits logoS3Key

describe('Property 2: Brand not found omits logoS3Key', () => {
  const ALPHA_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('per qualunque ar_codbrand valido (1-2 lettere) con DB 0 righe, logoS3Key non è presente nella risposta', async () => {
    /**
     * Validates: Requirements 3.3, 4.3, 6.2
     *
     * Per qualunque brand code valido (1-2 caratteri alfabetici) che NON esiste
     * nel database (query restituisce 0 righe), la risposta deve contenere
     * success: true, isStellantisBrand: false, e il campo logoS3Key NON deve
     * essere presente nel body JSON.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...ALPHA_CHARS), { minLength: 1, maxLength: 2 }).map(chars => chars.join('')),
        async (arCodbrand) => {
          getPool.mockResolvedValue({
            query: jest.fn().mockResolvedValue({ rows: [] }),
          });

          const res = await handler(makeEvent(arCodbrand), mockContext);

          expect(res.statusCode).toBe(200);
          const body = JSON.parse(res.body);
          expect(body.success).toBe(true);
          expect(body.isStellantisBrand).toBe(false);
          expect(body).not.toHaveProperty('logoS3Key');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: brand-logo-url, Property 5: Structured logging with context

describe('Property 5: Structured logging with context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('per qualunque richiesta valida con risultati DB variabili, ogni console.log produce JSON valido con awsRequestId e include logoS3Key nel log di successo', async () => {
    const ALPHA_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
    
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...ALPHA_CHARS), { minLength: 1, maxLength: 2 }).map(chars => chars.join('')),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
        async (arCodbrand, logoValue) => {
          console.log.mockClear();

          const dbResult = logoValue !== null 
            ? { rows: [{ logo_s3_key: logoValue }] }
            : { rows: [{ logo_s3_key: null }] };

          getPool.mockResolvedValue({
            query: jest.fn().mockResolvedValue(dbResult),
          });

          const event = { action: 'isStellantisBrand', body: { ar_codbrand: arCodbrand } };
          await handler(event, { awsRequestId: 'pbt-logging-test' });

          // Verify ALL console.log calls produce valid JSON with awsRequestId
          const logCalls = console.log.mock.calls;
          for (const call of logCalls) {
            const parsed = JSON.parse(call[0]); // must not throw
            expect(parsed).toHaveProperty('awsRequestId', 'pbt-logging-test');
          }

          // Find the query success log and verify it includes logoS3Key
          const parsedLogs = logCalls.map(c => JSON.parse(c[0]));
          const queryLog = parsedLogs.find(
            log => log.operation === 'query' && log.message && log.message.includes('brand trovato')
          );
          expect(queryLog).toBeDefined();
          
          const expectedLogoS3Key = logoValue && logoValue.trim() !== '' ? logoValue : null;
          expect(queryLog).toHaveProperty('logoS3Key', expectedLogoS3Key);
        },
      ),
      { numRuns: 100 },
    );
  });
});
