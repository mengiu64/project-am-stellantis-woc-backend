'use strict';

/**
 * Property-based test (fast-check) per la validazione di ar_codbrand nell'handler
 * isStellantisBrand. Complementa __tests__/index.test.js (basato su esempi puntuali)
 * verificando le stesse regole di validazione su un ampio spazio di input generati.
 */

const fc = require('fast-check');

jest.mock('../shared/dbClient');
jest.mock('../userSignsService');

const { getPool } = require('../shared/dbClient');
const { handler } = require('../index');

const mockContext = { awsRequestId: 'property-test-request-id' };

const ALPHA_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
const NON_ALPHA_CHARS = '0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?/'.split('');

function makeEvent(arCodbrand) {
  return { action: 'isStellantisBrand', body: { ar_codbrand: arCodbrand } };
}

describe('isStellantisBrand handler — property-based (fast-check)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    getPool.mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }) });
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('qualunque stringa di 1-2 caratteri solo alfabetici è sempre accettata (200) e la query usa sempre il valore uppercase', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.constantFrom(...ALPHA_CHARS), { minLength: 1, maxLength: 2 })
          .map((chars) => chars.join('')),
        async (arCodbrand) => {
          const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
          getPool.mockResolvedValue({ query: mockQuery });

          const res = await handler(makeEvent(arCodbrand), mockContext);

          expect(res.statusCode).toBe(200);
          const body = JSON.parse(res.body);
          expect(body.success).toBe(true);
          expect(typeof body.isStellantisBrand).toBe('boolean');
          expect(mockQuery).toHaveBeenCalledWith(
            expect.objectContaining({ values: [arCodbrand.toUpperCase()] }),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test('qualunque stringa non vuota (dopo trim) più lunga di 2 caratteri restituisce sempre 400 "massimo 2 caratteri"', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 3, maxLength: 20 }).filter((s) => s.trim() !== ''),
        async (arCodbrand) => {
          const res = await handler(makeEvent(arCodbrand), mockContext);

          expect(res.statusCode).toBe(400);
          const body = JSON.parse(res.body);
          expect(body.success).toBe(false);
          expect(body.message).toBe('ar_codbrand deve essere di massimo 2 caratteri');
        },
      ),
      { numRuns: 100 },
    );
  });

  test('qualunque stringa di 1-2 caratteri con almeno un carattere non alfabetico restituisce sempre 400 "solo caratteri alfabetici"', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...NON_ALPHA_CHARS),
        fc.option(fc.constantFrom(...ALPHA_CHARS), { nil: undefined }),
        async (nonAlphaChar, maybeAlphaChar) => {
          const arCodbrand = maybeAlphaChar ? `${nonAlphaChar}${maybeAlphaChar}` : nonAlphaChar;
          // Se il risultato è tutto whitespace (es. " "), il ramo intercettato è
          // quello di "obbligatorio", non quello alfabetico: escludo questo caso.
          fc.pre(arCodbrand.trim() !== '');

          const res = await handler(makeEvent(arCodbrand), mockContext);

          expect(res.statusCode).toBe(400);
          const body = JSON.parse(res.body);
          expect(body.success).toBe(false);
          expect(body.message).toBe('ar_codbrand deve contenere solo caratteri alfabetici');
        },
      ),
      { numRuns: 100 },
    );
  });

  test('qualunque stringa vuota o solo whitespace restituisce sempre 400 "obbligatorio"', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 5 })
          .map((chars) => chars.join('')),
        async (arCodbrand) => {
          const res = await handler(makeEvent(arCodbrand), mockContext);

          expect(res.statusCode).toBe(400);
          const body = JSON.parse(res.body);
          expect(body.success).toBe(false);
          expect(body.message).toBe('ar_codbrand è obbligatorio');
        },
      ),
      { numRuns: 50 },
    );
  });
});
