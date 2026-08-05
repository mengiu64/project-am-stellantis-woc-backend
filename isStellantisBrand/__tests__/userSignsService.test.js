'use strict';

/**
 * Unit test per il modulo userSignsService.js.
 * Mock di shared/dbClient.js per evitare connessioni di rete reali.
 */

jest.mock('../shared/dbClient');

const { getPool } = require('../shared/dbClient');
const {
  createUserSign,
  getUserSign,
  updateUserSign,
  deleteUserSign,
} = require('../userSignsService');

// Contesto Lambda mock — awsRequestId usato nei log strutturati
const mockAwsRequestId = 'test-request-id-123';

// Helper per configurare il mock del pool con una funzione query personalizzata
function setupPoolMock(queryFn) {
  getPool.mockResolvedValue({ query: queryFn });
}

// Helper per parsare la risposta del servizio
function parseBody(response) {
  return JSON.parse(response.body);
}

describe('userSignsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.log durante i test per evitare rumore
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createUserSign
  // ══════════════════════════════════════════════════════════════════════════

  describe('createUserSign', () => {
    test('happy path: valid input → 201 with generated ID', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 42 }],
      });
      setupPoolMock(mockQuery);

      const body = {
        dealer_login_userid: 'dealer123',
        sign_image: Buffer.from('test-image-data').toString('base64'),
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(201);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(true);
      expect(parsed.dealer_sign_id).toBe(42);
      expect(res.headers['Content-Type']).toBe('application/json');
    });

    test('missing dealer_login_userid (undefined) → 400', async () => {
      const body = {
        sign_image: Buffer.from('img').toString('base64'),
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_login_userid è obbligatorio');
    });

    test('empty dealer_login_userid (whitespace-only) → 400', async () => {
      const body = {
        dealer_login_userid: '   ',
        sign_image: Buffer.from('img').toString('base64'),
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_login_userid è obbligatorio');
    });

    test('dealer_login_userid > 50 chars → 400', async () => {
      const body = {
        dealer_login_userid: 'a'.repeat(51),
        sign_image: Buffer.from('img').toString('base64'),
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe(
        'dealer_login_userid deve essere di massimo 50 caratteri'
      );
    });

    test('missing sign_image → 400', async () => {
      const body = {
        dealer_login_userid: 'dealer123',
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('sign_image è obbligatorio');
    });

    test('empty sign_image (whitespace-only) → 400', async () => {
      const body = {
        dealer_login_userid: 'dealer123',
        sign_image: '   ',
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('sign_image è obbligatorio');
    });

    test('DB error → 500 with generic message', async () => {
      const mockQuery = jest.fn().mockRejectedValue(
        new Error('Connection refused')
      );
      setupPoolMock(mockQuery);

      const body = {
        dealer_login_userid: 'dealer123',
        sign_image: Buffer.from('img').toString('base64'),
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(500);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Errore interno del server');
      // Non deve esporre dettagli interni
      expect(res.body).not.toContain('Connection refused');
    });

    test('getPool failure → 500', async () => {
      getPool.mockRejectedValue(new Error('Secrets Manager timeout'));

      const body = {
        dealer_login_userid: 'dealer123',
        sign_image: Buffer.from('img').toString('base64'),
      };

      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(500);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Errore interno del server');
      expect(res.body).not.toContain('Secrets Manager');
    });

    test('structured log includes awsRequestId, level, operation', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 1 }],
      });
      setupPoolMock(mockQuery);

      const body = {
        dealer_login_userid: 'dealer123',
        sign_image: Buffer.from('img').toString('base64'),
      };

      await createUserSign(body, mockAwsRequestId);

      const logCalls = console.log.mock.calls
        .map((call) => {
          try { return JSON.parse(call[0]); } catch { return null; }
        })
        .filter(Boolean);

      // Deve esserci almeno un log con awsRequestId e operation
      const infoLog = logCalls.find(
        (l) => l.level === 'info' && l.operation === 'createUserSign'
      );
      expect(infoLog).toBeDefined();
      expect(infoLog.awsRequestId).toBe(mockAwsRequestId);
    });

    test('null body → 400 (dealer_login_userid mancante)', async () => {
      const res = await createUserSign(null, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_login_userid è obbligatorio');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getUserSign
  // ══════════════════════════════════════════════════════════════════════════

  describe('getUserSign', () => {
    test('happy path: existing ID → 200 with base64-encoded sign_image', async () => {
      const originalData = Buffer.from('jpeg-binary-data');
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{
          dealer_sign_id: 7,
          dealer_login_userid: 'dealer456',
          sign_image: originalData,
          created_at: '2025-01-15T10:30:00.000Z',
          updated_at: '2025-01-15T10:30:00.000Z',
        }],
      });
      setupPoolMock(mockQuery);

      const body = { dealer_sign_id: 7 };
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(true);
      expect(parsed.data.dealer_sign_id).toBe(7);
      expect(parsed.data.dealer_login_userid).toBe('dealer456');
      // Verifica che sign_image sia la codifica base64 corretta del Buffer
      expect(parsed.data.sign_image).toBe(originalData.toString('base64'));
      expect(parsed.data.created_at).toBe('2025-01-15T10:30:00.000Z');
      expect(parsed.data.updated_at).toBe('2025-01-15T10:30:00.000Z');
    });

    test('missing dealer_sign_id → 400', async () => {
      const body = {};
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id è obbligatorio');
    });

    test('null body → 400', async () => {
      const res = await getUserSign(null, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id è obbligatorio');
    });

    test('invalid dealer_sign_id (non-numeric string) → 400', async () => {
      const body = { dealer_sign_id: 'abc' };
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('invalid dealer_sign_id (negative number) → 400', async () => {
      const body = { dealer_sign_id: -5 };
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('invalid dealer_sign_id (zero) → 400', async () => {
      const body = { dealer_sign_id: 0 };
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('invalid dealer_sign_id (float) → 400', async () => {
      const body = { dealer_sign_id: 3.14 };
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('ID not found → 404', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      setupPoolMock(mockQuery);

      const body = { dealer_sign_id: 9999 };
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(404);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Record non trovato');
    });

    test('DB error → 500 with generic message', async () => {
      const mockQuery = jest.fn().mockRejectedValue(
        new Error('Query execution failed')
      );
      setupPoolMock(mockQuery);

      const body = { dealer_sign_id: 1 };
      const res = await getUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(500);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Errore interno del server');
      expect(res.body).not.toContain('Query execution failed');
    });

    test('structured log includes awsRequestId, level, operation', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{
          dealer_sign_id: 1,
          dealer_login_userid: 'd',
          sign_image: Buffer.from('x'),
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
        }],
      });
      setupPoolMock(mockQuery);

      await getUserSign({ dealer_sign_id: 1 }, mockAwsRequestId);

      const logCalls = console.log.mock.calls
        .map((call) => {
          try { return JSON.parse(call[0]); } catch { return null; }
        })
        .filter(Boolean);

      const infoLog = logCalls.find(
        (l) => l.level === 'info' && l.operation === 'getUserSign'
      );
      expect(infoLog).toBeDefined();
      expect(infoLog.awsRequestId).toBe(mockAwsRequestId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateUserSign
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateUserSign', () => {
    test('happy path: update both fields → 200', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 10 }],
      });
      setupPoolMock(mockQuery);

      const body = {
        dealer_sign_id: 10,
        dealer_login_userid: 'newDealer',
        sign_image: Buffer.from('new-image').toString('base64'),
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Record aggiornato');
    });

    test('update only dealer_login_userid → 200', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 10 }],
      });
      setupPoolMock(mockQuery);

      const body = {
        dealer_sign_id: 10,
        dealer_login_userid: 'updatedDealer',
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Record aggiornato');
    });

    test('update only sign_image → 200', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 10 }],
      });
      setupPoolMock(mockQuery);

      const body = {
        dealer_sign_id: 10,
        sign_image: Buffer.from('updated-image').toString('base64'),
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Record aggiornato');
    });

    test('missing dealer_sign_id → 400', async () => {
      const body = {
        dealer_login_userid: 'dealer123',
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id è obbligatorio');
    });

    test('invalid dealer_sign_id (non-numeric) → 400', async () => {
      const body = {
        dealer_sign_id: 'xyz',
        dealer_login_userid: 'dealer123',
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('invalid dealer_sign_id (zero) → 400', async () => {
      const body = {
        dealer_sign_id: 0,
        dealer_login_userid: 'dealer123',
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('no updatable fields → 400', async () => {
      const body = {
        dealer_sign_id: 10,
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Almeno un campo da aggiornare è richiesto');
    });

    test('dealer_login_userid > 50 chars → 400', async () => {
      const body = {
        dealer_sign_id: 10,
        dealer_login_userid: 'x'.repeat(51),
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe(
        'dealer_login_userid deve essere di massimo 50 caratteri'
      );
    });

    test('ID not found → 404', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      setupPoolMock(mockQuery);

      const body = {
        dealer_sign_id: 9999,
        dealer_login_userid: 'dealer123',
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(404);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Record non trovato');
    });

    test('DB error → 500 with generic message', async () => {
      const mockQuery = jest.fn().mockRejectedValue(
        new Error('Constraint violation')
      );
      setupPoolMock(mockQuery);

      const body = {
        dealer_sign_id: 10,
        dealer_login_userid: 'dealer123',
      };

      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(500);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Errore interno del server');
      expect(res.body).not.toContain('Constraint violation');
    });

    test('null body → 400', async () => {
      const res = await updateUserSign(null, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id è obbligatorio');
    });

    test('structured log includes awsRequestId, level, operation', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 10 }],
      });
      setupPoolMock(mockQuery);

      await updateUserSign(
        { dealer_sign_id: 10, dealer_login_userid: 'd' },
        mockAwsRequestId
      );

      const logCalls = console.log.mock.calls
        .map((call) => {
          try { return JSON.parse(call[0]); } catch { return null; }
        })
        .filter(Boolean);

      const infoLog = logCalls.find(
        (l) => l.level === 'info' && l.operation === 'updateUserSign'
      );
      expect(infoLog).toBeDefined();
      expect(infoLog.awsRequestId).toBe(mockAwsRequestId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteUserSign
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteUserSign', () => {
    test('happy path: existing ID → 200 with "Record eliminato"', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 5 }],
      });
      setupPoolMock(mockQuery);

      const body = { dealer_sign_id: 5 };
      const res = await deleteUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Record eliminato');
    });

    test('missing dealer_sign_id → 400', async () => {
      const body = {};
      const res = await deleteUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id è obbligatorio');
    });

    test('invalid dealer_sign_id (non-numeric) → 400', async () => {
      const body = { dealer_sign_id: 'delete-me' };
      const res = await deleteUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('invalid dealer_sign_id (negative) → 400', async () => {
      const body = { dealer_sign_id: -1 };
      const res = await deleteUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id deve essere un intero positivo');
    });

    test('ID not found → 404', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      setupPoolMock(mockQuery);

      const body = { dealer_sign_id: 9999 };
      const res = await deleteUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(404);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Record non trovato');
    });

    test('DB error → 500 with generic message', async () => {
      const mockQuery = jest.fn().mockRejectedValue(
        new Error('Deadlock detected')
      );
      setupPoolMock(mockQuery);

      const body = { dealer_sign_id: 1 };
      const res = await deleteUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(500);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('Errore interno del server');
      expect(res.body).not.toContain('Deadlock');
    });

    test('null body → 400', async () => {
      const res = await deleteUserSign(null, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_sign_id è obbligatorio');
    });

    test('structured log includes awsRequestId, level, operation', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ dealer_sign_id: 5 }],
      });
      setupPoolMock(mockQuery);

      await deleteUserSign({ dealer_sign_id: 5 }, mockAwsRequestId);

      const logCalls = console.log.mock.calls
        .map((call) => {
          try { return JSON.parse(call[0]); } catch { return null; }
        })
        .filter(Boolean);

      const infoLog = logCalls.find(
        (l) => l.level === 'info' && l.operation === 'deleteUserSign'
      );
      expect(infoLog).toBeDefined();
      expect(infoLog.awsRequestId).toBe(mockAwsRequestId);
    });
  });
});
