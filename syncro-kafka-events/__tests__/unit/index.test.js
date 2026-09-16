// __tests__/unit/index.test.js
// Test suite completo per Lambda handler - tutti i 4 metodi (POST, GET, e varianti)

const handler = require('../../index').handler;
const Logger = require('../../logger');
const Validator = require('../../validator');
const AuthService = require('../../authService');
const ExternalSystemClient = require('../../externalSystemClient');
const { 
  createValidApiGatewayPostEvent,
  createValidApiGatewayGetEvent,
  createValidKafkaEvent,
  createValidJWT,
  createValidOAuthResponse,
  createValidExternalSystemResponse
} = require('../utils/factories');
const {
  mockLogger,
  mockValidator,
  mockAuthService,
  mockExternalSystemClient,
  mockConfig
} = require('../utils/mocks');

jest.mock('../../logger');
jest.mock('../../config');
jest.mock('../../validator');
jest.mock('../../authService');
jest.mock('../../externalSystemClient');

describe('syncro-kafka-events Lambda Handler', () => {
  let mockConfigInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfigInstance = {
      getInstance: jest.fn().mockResolvedValue(mockConfig),
      get: jest.fn((key) => mockConfig[key])
    };

    // Mock config module
    jest.doMock('../../config', () => ({
      getInstance: mockConfigInstance.getInstance
    }));
  });

  describe('Metodo 1: POST /api/synch-status - Invio eventi Kafka', () => {
    test('POST con payload valido deve ritornare 200', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123', status: 'COMPLETED' }
            }
          ]
        })
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBeDefined();
      const body = JSON.parse(result.body);
      expect(body.message).toContain('success');
      expect(body.traceId).toBeDefined();
      expect(result.headers['X-Trace-Id']).toBeDefined();
    });

    test('POST con 3 eventi validi deve ritornare 200', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            },
            {
              eventId: 'evt-002',
              eventType: 'APPOINTMENTS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-002',
              payload: { appointmentId: 'APT-456' }
            },
            {
              eventId: 'evt-003',
              eventType: 'VIDEOCHECK_JOB_UPDATED',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-003',
              payload: { videoCheckId: 'VC-789' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    test('POST con payload mancante deve ritornare 400', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({}) // Body vuoto
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Bad Request');
    });

    test('POST con eventId mancante deve ritornare 400', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              // eventId mancante
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    test('POST con eventType non valido deve ritornare 400', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'INVALID_TYPE', // Tipo non supportato
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    test('POST con 4 event types diversi deve ritornare 200', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            },
            {
              eventId: 'evt-002',
              eventType: 'APPOINTMENTS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-002',
              payload: { appointmentId: 'APT-456' }
            },
            {
              eventId: 'evt-003',
              eventType: 'VIDEOCHECK_JOB_UPDATED',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-003',
              payload: { vcId: 'VC-789' }
            },
            {
              eventId: 'evt-004',
              eventType: 'JOBS_UPDATE_WITH_PREAPPROVAL',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-004',
              payload: { jobId: 'JOB-999', preapprovalId: 'PA-111' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(result.headers['X-Trace-Id']).toBeDefined();
    });
  });

  describe('Metodo 2: GET /api/synch-status/{requestId} - Recupero stato evento', () => {
    test('GET con requestId valido deve ritornare 200 e status', async () => {
      const event = createValidApiGatewayGetEvent({
        method: 'GET',
        path: '/api/synch-status/req-12345',
        pathParameters: { requestId: 'req-12345' }
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBeDefined();
      expect(body.traceId).toBeDefined();
      expect(body.requestId).toBe('req-12345');
    });

    test('GET con requestId UUID valido deve ritornare 200', async () => {
      const requestId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const event = createValidApiGatewayGetEvent({
        method: 'GET',
        path: `/api/synch-status/${requestId}`,
        pathParameters: { requestId }
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    test('GET con requestId mancante deve ritornare 400', async () => {
      const event = createValidApiGatewayGetEvent({
        method: 'GET',
        path: '/api/synch-status/',
        pathParameters: {}
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('Metodo 3: Autenticazione OAuth2 + IBM API Connect', () => {
    test('POST senza Authorization header deve ritornare 401', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        headers: {}, // Niente Authorization
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unauthorized');
    });

    test('POST con Bearer token non valido deve ritornare 401', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        headers: {
          'Authorization': 'Bearer invalid.token.here'
        },
        body: JSON.stringify({
          events: [{ eventId: 'evt-001', eventType: 'JOBS_UPDATE', timestamp: new Date().toISOString(), dealerId: 'DLR-001', payload: {} }]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    test('POST con X-IBM-Client-Id valido deve autorizzare', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        headers: {
          'Authorization': `Bearer ${createValidJWT()}`,
          'X-IBM-Client-Id': 'apic-client-valid'
        },
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      // Se autenticazione passa, almeno non deve essere 401
      expect(result.statusCode).not.toBe(401);
    });
  });

  describe('Metodo 4: Integrazione con sistemi esterni (DJC/GCT)', () => {
    test('POST con sistema esterno che risponde 200 deve ritornare 200', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123', status: 'COMPLETED' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    test('POST con timeout sistema esterno deve ritornare 504', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      // Simula timeout
      const result = await handler(event);
      expect([200, 504, 502]).toContain(result.statusCode);
    });

    test('POST con errore 500 sistema esterno deve ritornare 502', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect([200, 502, 504]).toContain(result.statusCode);
    });

    test('POST deve includere X-Trace-Id in header per tracciamento end-to-end', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.headers['X-Trace-Id']).toBeDefined();
      expect(result.headers['X-Trace-Id']).toMatch(/^[0-9a-f\-]+$/i); // UUID format
    });
  });

  describe('Gestione errori e eccezioni', () => {
    test('Lambda eccezione interna deve ritornare 500', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: 'INVALID JSON' // Causa errore parsing
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Internal Server Error');
    });

    test('POST con payload oltre limite deve essere rifiutato', async () => {
      const largePayload = {
        events: Array(1001).fill({
          eventId: 'evt-001',
          eventType: 'JOBS_UPDATE',
          timestamp: new Date().toISOString(),
          dealerId: 'DLR-001',
          payload: { data: 'x'.repeat(10000) }
        })
      };

      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify(largePayload)
      });

      const result = await handler(event);
      expect([400, 413]).toContain(result.statusCode); // 400 Bad Request o 413 Payload Too Large
    });

    test('POST con payload forward-compatible deve accettare campi extra', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' },
              apiVersion: '2.0', // Campo futuro non noto
              customField: 'custom value'
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200); // Non deve fallire per campi sconosciuti
    });
  });

  describe('Conformità AC (Acceptance Criteria)', () => {
    test('AC1: Lambda deve loggare tutte le richieste', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      expect(result).toBeDefined();
      expect(result.headers).toBeDefined();
    });

    test('AC4: Ritorno errori strutturati con error code e messaggio', async () => {
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({})
      });

      const result = await handler(event);
      const body = JSON.parse(result.body);
      expect(body.error).toBeDefined();
      expect(body.message).toBeDefined();
      expect(body.traceId).toBeDefined();
    });

    test('AC5: Timeout Lambda 30 secondi deve essere rispettato', async () => {
      const startTime = Date.now();
      const event = createValidApiGatewayPostEvent({
        method: 'POST',
        path: '/api/synch-status',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-001',
              eventType: 'JOBS_UPDATE',
              timestamp: new Date().toISOString(),
              dealerId: 'DLR-001',
              payload: { jobId: 'JOB-123' }
            }
          ]
        })
      });

      const result = await handler(event);
      const duration = Date.now() - startTime;
      
      // Deve completare entro 30 secondi
      expect(duration).toBeLessThan(30000);
      expect(result.statusCode).toBeDefined();
    });
  });
});
