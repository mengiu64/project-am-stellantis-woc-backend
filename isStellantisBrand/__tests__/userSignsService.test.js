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
    });

    test('missing dealer_login_userid → 400', async () => {
      const body = { sign_image: Buffer.from('img').toString('base64') };
      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe('dealer_login_userid è obbligatorio');
    });

    test('empty dealer_login_userid (whitespace-only) → 400', async () => {
      const body = { dealer_login_userid: '   ', sign_image: Buffer.from('img').toString('base64') };
      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });

    test('dealer_login_userid > 50 chars → 400', async () => {
      const body = { dealer_login_userid: 'a'.repeat(51), sign_image: Buffer.from('img').toString('base64') };
      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid deve essere di massimo 50 caratteri');
    });

    test('missing sign_image → 400', async () => {
      const body = { dealer_login_userid: 'dealer123' };
      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('sign_image è obbligatorio');
    });

    test('duplicate dealer_login_userid → 409', async () => {
      const err = new Error('duplicate key');
      err.code = '23505';
      setupPoolMock(jest.fn().mockRejectedValue(err));

      const body = { dealer_login_userid: 'dealer123', sign_image: Buffer.from('img').toString('base64') };
      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(409);
      expect(parseBody(res).message).toBe('Esiste già una firma per questo dealer_login_userid');
    });

    test('DB error → 500', async () => {
      setupPoolMock(jest.fn().mockRejectedValue(new Error('Connection refused')));

      const body = { dealer_login_userid: 'dealer123', sign_image: Buffer.from('img').toString('base64') };
      const res = await createUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(500);
      expect(parseBody(res).message).toBe('Errore interno del server');
      expect(res.body).not.toContain('Connection refused');
    });

    test('null body → 400', async () => {
      const res = await createUserSign(null, mockAwsRequestId);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getUserSign — lookup per dealer_login_userid
  // ══════════════════════════════════════════════════════════════════════════

  describe('getUserSign', () => {
    test('happy path: existing userid → 200 with base64 sign_image', async () => {
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

      const res = await getUserSign({ dealer_login_userid: 'dealer456' }, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      const parsed = parseBody(res);
      expect(parsed.success).toBe(true);
      expect(parsed.data.dealer_login_userid).toBe('dealer456');
      expect(parsed.data.sign_image).toBe(originalData.toString('base64'));
      expect(parsed.data.dealer_sign_id).toBe(7);
    });

    test('missing dealer_login_userid → 400', async () => {
      const res = await getUserSign({}, mockAwsRequestId);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });

    test('null body → 400', async () => {
      const res = await getUserSign(null, mockAwsRequestId);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });

    test('empty dealer_login_userid → 400', async () => {
      const res = await getUserSign({ dealer_login_userid: '  ' }, mockAwsRequestId);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });

    test('not found → 404', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [] }));

      const res = await getUserSign({ dealer_login_userid: 'nonexistent' }, mockAwsRequestId);
      expect(res.statusCode).toBe(404);
      expect(parseBody(res).message).toBe('Record non trovato');
    });

    test('DB error → 500', async () => {
      setupPoolMock(jest.fn().mockRejectedValue(new Error('Query failed')));

      const res = await getUserSign({ dealer_login_userid: 'dealer123' }, mockAwsRequestId);
      expect(res.statusCode).toBe(500);
      expect(parseBody(res).message).toBe('Errore interno del server');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateUserSign — lookup per dealer_login_userid, aggiorna sign_image
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateUserSign', () => {
    test('happy path: update sign_image → 200', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ dealer_sign_id: 10 }] }));

      const body = {
        dealer_login_userid: 'dealer123',
        sign_image: Buffer.from('new-image').toString('base64'),
      };
      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      expect(parseBody(res).message).toBe('Record aggiornato');
    });

    test('missing dealer_login_userid → 400', async () => {
      const body = { sign_image: Buffer.from('img').toString('base64') };
      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });

    test('missing sign_image → 400', async () => {
      const body = { dealer_login_userid: 'dealer123' };
      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('sign_image è obbligatorio');
    });

    test('not found → 404', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [] }));

      const body = { dealer_login_userid: 'nonexistent', sign_image: Buffer.from('img').toString('base64') };
      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(404);
      expect(parseBody(res).message).toBe('Record non trovato');
    });

    test('DB error → 500', async () => {
      setupPoolMock(jest.fn().mockRejectedValue(new Error('Constraint violation')));

      const body = { dealer_login_userid: 'dealer123', sign_image: Buffer.from('img').toString('base64') };
      const res = await updateUserSign(body, mockAwsRequestId);

      expect(res.statusCode).toBe(500);
      expect(parseBody(res).message).toBe('Errore interno del server');
    });

    test('null body → 400', async () => {
      const res = await updateUserSign(null, mockAwsRequestId);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteUserSign — lookup per dealer_login_userid
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteUserSign', () => {
    test('happy path: existing userid → 200 "Record eliminato"', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ dealer_sign_id: 5 }] }));

      const res = await deleteUserSign({ dealer_login_userid: 'dealer123' }, mockAwsRequestId);

      expect(res.statusCode).toBe(200);
      expect(parseBody(res).message).toBe('Record eliminato');
    });

    test('missing dealer_login_userid → 400', async () => {
      const res = await deleteUserSign({}, mockAwsRequestId);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });

    test('not found → 404', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [] }));

      const res = await deleteUserSign({ dealer_login_userid: 'nonexistent' }, mockAwsRequestId);
      expect(res.statusCode).toBe(404);
      expect(parseBody(res).message).toBe('Record non trovato');
    });

    test('DB error → 500', async () => {
      setupPoolMock(jest.fn().mockRejectedValue(new Error('Deadlock')));

      const res = await deleteUserSign({ dealer_login_userid: 'dealer123' }, mockAwsRequestId);
      expect(res.statusCode).toBe(500);
      expect(parseBody(res).message).toBe('Errore interno del server');
    });

    test('null body → 400', async () => {
      const res = await deleteUserSign(null, mockAwsRequestId);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe('dealer_login_userid è obbligatorio');
    });
  });
});
