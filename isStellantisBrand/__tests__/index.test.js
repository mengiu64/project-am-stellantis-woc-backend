'use strict';

/**
 * Unit test per il Lambda handler isStellantisBrand.
 * Mock di shared/dbClient.js per evitare connessioni di rete reali.
 */

jest.mock('../shared/dbClient');
jest.mock('../userSignsService');

const { getPool } = require('../shared/dbClient');
const { handler } = require('../index');

// Contesto Lambda mock
const mockContext = { awsRequestId: 'test-request-id-123' };

// Helper per creare un evento con invocazione diretta (azione isStellantisBrand)
function makeEvent(arCodbrand) {
  if (arCodbrand === undefined) {
    return { action: 'isStellantisBrand', body: {} };
  }
  return { action: 'isStellantisBrand', body: { ar_codbrand: arCodbrand } };
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
    test('ar_codbrand mancante (body vuoto) → 400', async () => {
      const event = { action: 'isStellantisBrand', body: {} };
      const res = await handler(event, mockContext);

      expect(res.statusCode).toBe(400);
      expect(res.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('ar_codbrand è obbligatorio');
    });

    test('ar_codbrand mancante (parametro assente nel body) → 400', async () => {
      const event = { action: 'isStellantisBrand', body: {} };
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

  // ── Test inMandate / oicsBrands ──────────────────────────────────────────

  describe('Verifica inMandate rispetto a oicsBrands', () => {
    // Helper per creare un evento con ar_codbrand e oicsBrands opzionale
    function makeEventWithOicsBrands(arCodbrand, oicsBrands) {
      return { action: 'isStellantisBrand', body: { ar_codbrand: arCodbrand, oicsBrands } };
    }

    test('codbrand presente in oicsBrands (CSV) → inMandate: true', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'logo.png', codbrand: 'FI' }] }));

      const res = await handler(makeEventWithOicsBrands('FT', 'AR,FI,JE'), mockContext);

      const body = JSON.parse(res.body);
      expect(body.isStellantisBrand).toBe(true);
      expect(body.inMandate).toBe(true);
    });

    test('codbrand assente da oicsBrands (CSV) → inMandate: false', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'logo.png', codbrand: 'ZZ' }] }));

      const res = await handler(makeEventWithOicsBrands('FT', 'AR,FI,JE'), mockContext);

      const body = JSON.parse(res.body);
      expect(body.isStellantisBrand).toBe(true);
      expect(body.inMandate).toBe(false);
    });

    test('oicsBrands con spazi attorno ai valori → confronto effettuato dopo trim', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'logo.png', codbrand: 'FI' }] }));

      const res = await handler(makeEventWithOicsBrands('FT', ' AR , FI , JE '), mockContext);

      const body = JSON.parse(res.body);
      expect(body.inMandate).toBe(true);
    });

    test('oicsBrands assente → inMandate: false', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'logo.png', codbrand: 'FI' }] }));

      const res = await handler(makeEvent('FT'), mockContext);

      const body = JSON.parse(res.body);
      expect(body.isStellantisBrand).toBe(true);
      expect(body.inMandate).toBe(false);
    });

    test('query include ora anche la colonna codbrand', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'logo.png', codbrand: 'FI' }] });
      setupPoolMock(mockQuery);

      await handler(makeEventWithOicsBrands('FT', 'FI'), mockContext);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('SELECT logo_s3_key,codbrand'),
        })
      );
    });

    test('brand non trovato → inMandate non presente nella response', async () => {
      setupPoolMock(jest.fn().mockResolvedValue({ rows: [] }));

      const res = await handler(makeEventWithOicsBrands('ZZ', 'AR,FI,JE'), mockContext);

      const body = JSON.parse(res.body);
      expect(body.isStellantisBrand).toBe(false);
      expect(body).not.toHaveProperty('inMandate');
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


// ═══════════════════════════════════════════════════════════════════════════════
// Test per il routing multi-azione (resolveActionAndBody + dispatch)
// ═══════════════════════════════════════════════════════════════════════════════

const userSignsService = require('../userSignsService');

describe('Multi-action routing — resolveActionAndBody', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('direct invocation format { action, body } resolves correctly', async () => {
    // Il formato di invocazione diretta deve usare il campo action e body così com'è
    const mockQuery = jest.fn().mockResolvedValue({ rows: [{ logo_s3_key: 'test.png' }] });
    getPool.mockResolvedValue({ query: mockQuery });

    const event = { action: 'isStellantisBrand', body: { ar_codbrand: 'AR' } };
    const res = await handler(event, mockContext);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isStellantisBrand).toBe(true);
  });

  test('API Gateway proxy format resolves action from last path segment', async () => {
    // Il formato API Gateway proxy usa l'ultimo segmento del path come azione
    const mockResponse = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { dealer_sign_id: 1 } }),
    };
    userSignsService.getUserSign.mockResolvedValue(mockResponse);

    const event = {
      path: '/isStellantisBrand/getUserSign',
      body: JSON.stringify({ dealer_sign_id: 1 }),
      queryStringParameters: null,
    };
    const res = await handler(event, mockContext);

    expect(userSignsService.getUserSign).toHaveBeenCalledWith(
      expect.objectContaining({ dealer_sign_id: 1 }),
      'test-request-id-123'
    );
    expect(res.statusCode).toBe(200);
  });

  test('query string parameters merged into body for API Gateway events', async () => {
    // I parametri della query string vengono uniti al body per eventi API Gateway
    const mockResponse = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { dealer_sign_id: 5 } }),
    };
    userSignsService.getUserSign.mockResolvedValue(mockResponse);

    const event = {
      path: '/isStellantisBrand/getUserSign',
      body: JSON.stringify({ dealer_sign_id: 5 }),
      queryStringParameters: { extra_param: 'value123' },
    };
    const res = await handler(event, mockContext);

    // Il body passato al servizio deve contenere sia i query params che il body parsato
    expect(userSignsService.getUserSign).toHaveBeenCalledWith(
      expect.objectContaining({ dealer_sign_id: 5, extra_param: 'value123' }),
      'test-request-id-123'
    );
  });
});

describe('Multi-action routing — action dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('createUserSign dispatches to userSignsService.createUserSign', async () => {
    const mockResponse = {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, dealer_sign_id: 42 }),
    };
    userSignsService.createUserSign.mockResolvedValue(mockResponse);

    const event = {
      action: 'createUserSign',
      body: { dealer_login_userid: '0073741.d235', sign_image: 'aW1hZ2U=' },
    };
    const res = await handler(event, mockContext);

    expect(userSignsService.createUserSign).toHaveBeenCalledWith(
      { dealer_login_userid: '0073741.d235', sign_image: 'aW1hZ2U=' },
      'test-request-id-123'
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.dealer_sign_id).toBe(42);
  });

  test('getUserSign dispatches to userSignsService.getUserSign', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { dealer_sign_id: 1 } }),
    };
    userSignsService.getUserSign.mockResolvedValue(mockResponse);

    const event = { action: 'getUserSign', body: { dealer_sign_id: 1 } };
    const res = await handler(event, mockContext);

    expect(userSignsService.getUserSign).toHaveBeenCalledWith(
      { dealer_sign_id: 1 },
      'test-request-id-123'
    );
    expect(res.statusCode).toBe(200);
  });

  test('updateUserSign dispatches to userSignsService.updateUserSign', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Record aggiornato' }),
    };
    userSignsService.updateUserSign.mockResolvedValue(mockResponse);

    const event = {
      action: 'updateUserSign',
      body: { dealer_sign_id: 10, dealer_login_userid: 'newuser' },
    };
    const res = await handler(event, mockContext);

    expect(userSignsService.updateUserSign).toHaveBeenCalledWith(
      { dealer_sign_id: 10, dealer_login_userid: 'newuser' },
      'test-request-id-123'
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toBe('Record aggiornato');
  });

  test('deleteUserSign dispatches to userSignsService.deleteUserSign', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Record eliminato' }),
    };
    userSignsService.deleteUserSign.mockResolvedValue(mockResponse);

    const event = { action: 'deleteUserSign', body: { dealer_sign_id: 7 } };
    const res = await handler(event, mockContext);

    expect(userSignsService.deleteUserSign).toHaveBeenCalledWith(
      { dealer_sign_id: 7 },
      'test-request-id-123'
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toBe('Record eliminato');
  });

  test('unknown action returns 400 with valid actions list', async () => {
    const event = { action: 'unknownAction', body: {} };
    const res = await handler(event, mockContext);

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('unknownAction');
    expect(body.message).toContain('isStellantisBrand');
    expect(body.message).toContain('createUserSign');
    expect(body.message).toContain('getUserSign');
    expect(body.message).toContain('updateUserSign');
    expect(body.message).toContain('deleteUserSign');
  });
});

describe('Multi-action routing — edge cases for branch coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('API Gateway event with unparseable JSON body gracefully ignores it', async () => {
    // Copre il branch catch in resolveActionAndBody quando event.body non è JSON valido
    const mockResponse = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: {} }),
    };
    userSignsService.getUserSign.mockResolvedValue(mockResponse);

    const event = {
      path: '/isStellantisBrand/getUserSign',
      body: '{invalid json!!!',
      queryStringParameters: { dealer_login_userid: 'test123' },
    };
    const res = await handler(event, mockContext);

    // Il body non parsabile viene ignorato; il query string parameter viene comunque usato
    expect(userSignsService.getUserSign).toHaveBeenCalledWith(
      expect.objectContaining({ dealer_login_userid: 'test123' }),
      'test-request-id-123'
    );
    expect(res.statusCode).toBe(200);
  });

  test('API Gateway event with no action in path returns 400', async () => {
    // Copre il branch quando segments è vuoto (path senza segmenti utili)
    const event = {
      path: '',
      body: null,
      queryStringParameters: null,
    };
    const res = await handler(event, mockContext);

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('Azione sconosciuta');
  });
});
