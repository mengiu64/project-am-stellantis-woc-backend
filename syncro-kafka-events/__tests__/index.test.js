// index.test.js
// Test suite per lambda syncro-kafka-events con 4 eventi specifici
// Implementazione ristretta secondo SRP DL KAFKA Specification

const { 
  handler, 
  _validatePayload, 
  _buildResponse,
  _getErrorCode,
  _getErrorMessage,
  SUPPORTED_EVENT_TYPES,
  EVENT_TYPE_TO_DB_STATUS
} = require('../index');

const { getPool } = require('../shared/dbClient');

// Mock modules
jest.mock('../shared/dbClient');
jest.mock('../logger', () => {
  return class MockLogger {
    getTraceId() { return 'trace-12345'; }
    info() {}
    warn() {}
    error() {}
    debug() {}
  };
});

describe('syncro-kafka-events Lambda - 4 Event Types', () => {
  
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {
      query: jest.fn()
    };
    getPool.mockResolvedValue(mockPool);
  });

  // ─────────────────────────────────────────────────────────────────────
  // ✅ TEST: VALIDAZIONE PAYLOAD
  // ─────────────────────────────────────────────────────────────────────

  describe('_validatePayload()', () => {
    
    it('DEVE accettare payload valido DMS_PUSH_SUCCESS_WITHOUT_UPDATE', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
        jobCardSrpId: 'JCID-42',
        timestamp: '2026-04-24T10:30:00Z'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(true);
      expect(result.data.eventType).toBe('DMS_PUSH_SUCCESS_WITHOUT_UPDATE');
      expect(result.data.jobCardId).toBe('JCID-42');
    });

    it('DEVE accettare payload valido DMS_PUSH_SUCCESS_WITH_UPDATE', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_SUCCESS_WITH_UPDATE',
        jobCardSrpId: 'JCID-43',
        timestamp: '2026-04-24T11:00:00Z'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(true);
      expect(result.data.eventType).toBe('DMS_PUSH_SUCCESS_WITH_UPDATE');
    });

    it('DEVE accettare payload valido DMS_PUSH_REFUSAL', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_REFUSAL',
        jobCardSrpId: 'JCID-44',
        timestamp: '2026-04-24T12:00:00Z'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(true);
      expect(result.data.eventType).toBe('DMS_PUSH_REFUSAL');
    });

    it('DEVE accettare payload valido DMS_PUSH_FAILURE', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_FAILURE',
        jobCardSrpId: 'JCID-45',
        timestamp: '2026-04-24T13:00:00Z'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(true);
      expect(result.data.eventType).toBe('DMS_PUSH_FAILURE');
    });

    it('DEVE rifiutare eventType non supportato', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'JOBS_UPDATE_WITH_PREAPPROVAL', // Non nella lista dei 4
        jobCardSrpId: 'JCID-99',
        timestamp: '2026-04-24T10:30:00Z'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('non supportato');
    });

    it('DEVE rifiutare eventType mancante', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        jobCardSrpId: 'JCID-42',
        timestamp: '2026-04-24T10:30:00Z'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('eventType');
    });

    it('DEVE rifiutare jobCardSrpId mancante', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
        timestamp: '2026-04-24T10:30:00Z'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('jobCardId');
    });

    it('DEVE rifiutare timestamp mancante', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
        jobCardSrpId: 'JCID-42'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('timestamp');
    });

    it('DEVE rifiutare timestamp non valido', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
        jobCardSrpId: 'JCID-42',
        timestamp: 'not-a-valid-date'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Timestamp');
    });

    it('DEVE accettare campi aggiuntivi opzionali', () => {
      const mockLogger = { warn: jest.fn() };
      const payload = {
        eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
        jobCardSrpId: 'JCID-42',
        timestamp: '2026-04-24T10:30:00Z',
        jobCardLegacyId: '123456',
        dmsRepairOrderId: '1A45',
        xpDealerCode: '123456A'
      };

      const result = _validatePayload(payload, mockLogger);

      expect(result.valid).toBe(true);
      expect(result.data.jobCardLegacyId).toBe('123456');
      expect(result.data.dmsRepairOrderId).toBe('1A45');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔄 TEST: MAPPING ERRORE CODE E MESSAGE
  // ─────────────────────────────────────────────────────────────────────

  describe('_getErrorCode() e _getErrorMessage()', () => {
    
    it('DEVE ritornare null error_code per DMS_PUSH_SUCCESS_WITHOUT_UPDATE', () => {
      const errorCode = _getErrorCode('DMS_PUSH_SUCCESS_WITHOUT_UPDATE');
      const errorMsg = _getErrorMessage('DMS_PUSH_SUCCESS_WITHOUT_UPDATE');

      expect(errorCode).toBeNull();
      expect(errorMsg).toBeNull();
    });

    it('DEVE ritornare null error_code per DMS_PUSH_SUCCESS_WITH_UPDATE', () => {
      const errorCode = _getErrorCode('DMS_PUSH_SUCCESS_WITH_UPDATE');
      const errorMsg = _getErrorMessage('DMS_PUSH_SUCCESS_WITH_UPDATE');

      expect(errorCode).toBeNull();
      expect(errorMsg).toBeNull();
    });

    it('DEVE ritornare error_code DMS_PUSH_REFUSED per DMS_PUSH_REFUSAL', () => {
      const errorCode = _getErrorCode('DMS_PUSH_REFUSAL');
      const errorMsg = _getErrorMessage('DMS_PUSH_REFUSAL');

      expect(errorCode).toBe('DMS_PUSH_REFUSED');
      expect(errorMsg).toContain('rifiutato');
    });

    it('DEVE ritornare error_code DMS_PUSH_FAILED per DMS_PUSH_FAILURE', () => {
      const errorCode = _getErrorCode('DMS_PUSH_FAILURE');
      const errorMsg = _getErrorMessage('DMS_PUSH_FAILURE');

      expect(errorCode).toBe('DMS_PUSH_FAILED');
      expect(errorMsg).toContain('fallimento');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🗄️  TEST: HANDLER - Salvataggio in Aurora
  // ─────────────────────────────────────────────────────────────────────

  describe('handler() - Salvataggio in Aurora', () => {
    
    it('DEVE registrare evento DMS_PUSH_SUCCESS_WITHOUT_UPDATE e ritornare 200', async () => {
      // Mock: database UPSERT successful
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-uuid-001',
          djc_sync_status: 'SUCCESS_WITHOUT_UPDATE',
          version: 1  // INSERT (version=1)
        }]
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {},
        body: JSON.stringify({
          eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
          jobCardSrpId: 'JCID-42',
          timestamp: '2026-04-24T10:30:00Z',
          djc: 'Y',
          ambito: 'SALES'
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('successo');
      expect(body.response.status).toBe('SUCCESS_WITHOUT_UPDATE');
    });

    it('DEVE registrare evento DMS_PUSH_SUCCESS_WITH_UPDATE e ritornare 200', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-uuid-002',
          djc_sync_status: 'SUCCESS_WITH_UPDATE',
          version: 1
        }]
      });

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify({
          eventType: 'DMS_PUSH_SUCCESS_WITH_UPDATE',
          jobCardSrpId: 'JCID-43',
          timestamp: '2026-04-24T11:00:00Z',
          djc: 'Y',
          ambito: 'SERVICE'
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.response.status).toBe('SUCCESS_WITH_UPDATE');
    });

    it('DEVE registrare evento DMS_PUSH_REFUSAL con error_code', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-uuid-003',
          djc_sync_status: 'REFUSAL',
          version: 1
        }]
      });

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify({
          eventType: 'DMS_PUSH_REFUSAL',
          jobCardSrpId: 'JCID-44',
          timestamp: '2026-04-24T12:00:00Z',
          djc: 'Y',
          ambito: 'SALES'
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.response.status).toBe('REFUSAL');
    });

    it('DEVE registrare evento DMS_PUSH_FAILURE con error_code', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-uuid-004',
          djc_sync_status: 'FAILURE',
          version: 1
        }]
      });

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify({
          eventType: 'DMS_PUSH_FAILURE',
          jobCardSrpId: 'JCID-45',
          timestamp: '2026-04-24T13:00:00Z',
          djc: 'Y',
          ambito: 'SALES'
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.response.status).toBe('FAILURE');
    });

    it('DEVE ritornare 400 se eventType non supportato', async () => {
      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify({
          eventType: 'JOBS_UPDATE_WITH_PREAPPROVAL', // Non supportato
          jobCardSrpId: 'JCID-99',
          timestamp: '2026-04-24T10:30:00Z'
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toContain('Validazione');
    });

    it('DEVE ritornare 400 se payload JSON non valido', async () => {
      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: '{invalid json}',
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
    });

    it('DEVE gestire UPDATE se stesso evento arriva due volte (ON CONFLICT)', async () => {
      // Primo INSERT: version = 1
      // Secondo UPDATE: version = 2
      mockPool.query.mockResolvedValueOnce({
        rows: [{ response_id: 'res-uuid', djc_sync_status: 'SUCCESS_WITHOUT_UPDATE', version: 1 }]
      }).mockResolvedValueOnce({
        rows: [{ response_id: 'res-uuid', djc_sync_status: 'SUCCESS_WITHOUT_UPDATE', version: 2 }]
      });

      const payload = {
        eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
        jobCardSrpId: 'JCID-DUP',
        timestamp: '2026-04-24T10:30:00Z',
        djc: 'Y',
        ambito: 'SALES'
      };

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify(payload),
        requestContext: { http: { method: 'POST' } }
      };

      // Primo call
      const response1 = await handler(event, {});
      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.response.version).toBe(1); // INSERT

      // Secondo call (stesso payload)
      const response2 = await handler(event, {});
      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.response.version).toBe(2); // UPDATE per idempotency
    });

    it('DEVE ritornare 503 se Aurora non disponibile', async () => {
      // Mock: errore connessione database
      getPool.mockRejectedValueOnce(new Error('ECONNREFUSED: connect failed'));

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify({
          eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
          jobCardSrpId: 'JCID-42',
          timestamp: '2026-04-24T10:30:00Z',
          djc: 'Y',
          ambito: 'SALES'
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Service Unavailable');
    });

    it('DEVE ritornare 504 se query database timeout', async () => {
      // Mock: query timeout con messaggio che include 'statement timeout'
      mockPool.query.mockRejectedValueOnce(new Error('statement timeout'));

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify({
          eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
          jobCardSrpId: 'JCID-42',
          timestamp: '2026-04-24T10:30:00Z',
          djc: 'Y',
          ambito: 'SALES'
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(504);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Gateway Timeout');
    });

    it('DEVE ritornare 404 se record non trovato in UPDATE', async () => {
      // Mock: UPDATE fallisce (nessuna riga perché il record non esiste)
      mockPool.query.mockResolvedValue({ rows: [] });

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        body: JSON.stringify({
          eventType: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
          jobCardSrpId: 'JCID-42',
          timestamp: '2026-04-24T10:30:00Z',
          djc: 'Y',
          ambito: 'SALES'
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
      expect(body.message).toContain('Record non trovato');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🛠️  TEST: Utility Functions
  // ─────────────────────────────────────────────────────────────────────

  describe('_buildResponse()', () => {
    
    it('DEVE costruire risposta HTTP con headers corretti', () => {
      const response = _buildResponse(200, { message: 'OK' }, 'trace-123');

      expect(response.statusCode).toBe(200);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['X-Trace-Id']).toBe('trace-123');
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(JSON.parse(response.body).message).toBe('OK');
    });

    it('DEVE gestire diversi status code', () => {
      const codes = [200, 400, 500, 503, 504];

      codes.forEach(code => {
        const response = _buildResponse(code, {}, 'trace');
        expect(response.statusCode).toBe(code);
        expect(response.headers['X-Trace-Id']).toBe('trace');
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 📊 TEST: Costanti ed Enum
  // ─────────────────────────────────────────────────────────────────────

  describe('SUPPORTED_EVENT_TYPES e EVENT_TYPE_TO_DB_STATUS', () => {
    
    it('DEVE contenere esattamente 4 event types supportati', () => {
      const eventTypes = Object.values(SUPPORTED_EVENT_TYPES);
      expect(eventTypes).toHaveLength(4);
      expect(eventTypes).toContain('DMS_PUSH_SUCCESS_WITHOUT_UPDATE');
      expect(eventTypes).toContain('DMS_PUSH_SUCCESS_WITH_UPDATE');
      expect(eventTypes).toContain('DMS_PUSH_REFUSAL');
      expect(eventTypes).toContain('DMS_PUSH_FAILURE');
    });

    it('DEVE mappare ogni event type a uno status database', () => {
      Object.values(SUPPORTED_EVENT_TYPES).forEach(eventType => {
        expect(EVENT_TYPE_TO_DB_STATUS[eventType]).toBeDefined();
      });
    });

    it('DEVE mappare a status database corretti', () => {
      expect(EVENT_TYPE_TO_DB_STATUS['DMS_PUSH_SUCCESS_WITHOUT_UPDATE']).toBe('SUCCESS_WITHOUT_UPDATE');
      expect(EVENT_TYPE_TO_DB_STATUS['DMS_PUSH_SUCCESS_WITH_UPDATE']).toBe('SUCCESS_WITH_UPDATE');
      expect(EVENT_TYPE_TO_DB_STATUS['DMS_PUSH_REFUSAL']).toBe('REFUSAL');
      expect(EVENT_TYPE_TO_DB_STATUS['DMS_PUSH_FAILURE']).toBe('FAILURE');
    });
  });

});
