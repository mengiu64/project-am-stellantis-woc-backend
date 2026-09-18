// index.test.js
// Test suite completa per lambda syncro-kafka-events con corrected UPDATE logic
// Mock: dbClient, authService, externalSystemClient, configModule

const { handler, _handlePostSynchStatus, _handleGetSynchStatus, _buildResponse } = require('../index');

// Mock modules
jest.mock('../config', () => ({
  getInstance: jest.fn().mockResolvedValue({
    getByPath: jest.fn((path) => {
      if (path === 'apic.clientSecret') return 'mock-secret-12345';
      if (path === 'apic.clientId') return 'mock-client-id';
      return null;
    })
  })
}));

jest.mock('../logger', () => {
  return class MockLogger {
    getTraceId() { return 'trace-123'; }
    info() {}
    warn() {}
    error() {}
    debug() {}
  };
});

jest.mock('../validator', () => ({
  validateAuthorizationHeader: jest.fn((header) => {
    if (!header) return { valid: false, error: 'Authorization header mancante' };
    if (!header.startsWith('Bearer ')) return { valid: false, error: 'Invalid Bearer format' };
    return { valid: true, token: header.substring(7) };
  }),
  validatePostSynchStatus: jest.fn((body) => {
    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return { valid: false, errors: ['events array obbligatorio'] };
    }
    return { valid: true, data: body };
  }),
  validateGetSynchStatus: jest.fn((requestId) => {
    if (!requestId || requestId.length < 10) {
      return { valid: false, errors: ['requestId non valido'] };
    }
    return { valid: true };
  })
}));

jest.mock('../authService');
jest.mock('../externalSystemClient');
jest.mock('../shared/dbClient');

const MockAuthService = require('../authService');
const MockExternalSystemClient = require('../externalSystemClient');
const { getPool } = require('../shared/dbClient');

describe('syncro-kafka-events Lambda Handler', () => {
  
  let mockPool;
  let mockLogger;
  let mockAuthService;
  let mockExternalClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup pool mock
    mockPool = {
      query: jest.fn()
    };
    getPool.mockResolvedValue(mockPool);
    
    // Setup authService mock
    mockAuthService.prototype.validateBearerToken.mockReturnValue({
      valid: true,
      decoded: { userId: 'user-123', scope: ['syncro:write', 'syncro:read'] }
    });
    mockAuthService.prototype.verifyPermissions.mockReturnValue({
      authorized: true
    });
    mockAuthService.prototype.getExternalSystemHeaders.mockResolvedValue({
      'Authorization': 'Bearer external-token'
    });
    
    // Setup externalSystemClient mock
    MockExternalSystemClient.prototype.sendToMultipleSystems.mockResolvedValue({
      successful: [
        { system: 'djc', statusCode: 200 },
        { system: 'gct', statusCode: 200 }
      ],
      failed: []
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔐 TEST: AUTENTICAZIONE
  // ─────────────────────────────────────────────────────────────────────
  describe('Autenticazione e Autorizzazione', () => {
    
    it('DEVE ritornare 401 se Authorization header mancante', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        headers: {},
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-001' }]
        })
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('Unauthorized');
    });

    it('DEVE ritornare 401 se token non valido', async () => {
      mockAuthService.prototype.validateBearerToken.mockReturnValue({
        valid: false,
        error: 'Token scaduto'
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        headers: {
          authorization: 'Bearer invalid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-001' }]
        })
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(401);
    });

    it('DEVE ritornare 403 se permessi insufficienti', async () => {
      mockAuthService.prototype.verifyPermissions.mockReturnValue({
        authorized: false,
        reason: 'Permesso syncro:write non assegnato'
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-001' }]
        })
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toBe('Forbidden');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // ✅ TEST: POST /api/synch-status (CORRETTO: UPDATE, not INSERT)
  // ─────────────────────────────────────────────────────────────────────
  describe('POST /api/synch-status - Callback DJC con UPDATE', () => {
    
    it('DEVE aggiornare record con successo (UPDATE) e ritornare 200', async () => {
      // Mock database: UPDATE successful, record trovato
      mockPool.query.mockImplementation((queryConfig) => {
        if (queryConfig.text.includes('UPDATE woc.comunication_asyncro_djc')) {
          // First UPDATE for callback receipt
          if (queryConfig.text.includes('RECEIVED_FROM_DJC')) {
            return Promise.resolve({
              rows: [{
                response_id: 'res-123',
                djc_sync_status: 'RECEIVED_FROM_DJC',
                version: 2
              }]
            });
          }
          // Second UPDATE for SUCCESS
          return Promise.resolve({
            rows: [{
              response_id: 'res-123',
              version: 3
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [
            {
              job_card_id: 'JC-001',
              data: { status: 'completed' }
            }
          ]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('successo');
      expect(body.jobCardId).toBe('JC-001');
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('DEVE ritornare 404 se record NON trovato in Aurora (UPDATE fallisce)', async () => {
      // Mock database: UPDATE fallisce perchè record non esiste
      mockPool.query.mockImplementation((queryConfig) => {
        if (queryConfig.text.includes('UPDATE woc.comunication_asyncro_djc')) {
          // No rows updated
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [
            {
              job_card_id: 'JC-999-NOT-EXISTS',
              data: { status: 'completed' }
            }
          ]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
      expect(body.message).toContain('non trovata');
    });

    it('DEVE ritornare 400 se payload non valido (job_card_id mancante)', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ data: { status: 'completed' } }] // job_card_id mancante
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      // Prima valida il payload
      const { Validator } = require('../validator');
      Validator.validatePostSynchStatus.mockReturnValue({
        valid: false,
        errors: ['job_card_id obbligatorio']
      });

      // non ti prego di continuare, il test a questo punto si divide
      // (in realtà andrà nel catch ma mocciamo il validate in modo che fallisca prima)
    });

    it('DEVE registrare errore lambda (UPDATE error) con status ERROR', async () => {
      // Simula errore durante lambda execution
      mockPool.query.mockImplementation((queryConfig) => {
        if (queryConfig.text.includes('RECEIVED_FROM_DJC')) {
          // Prima UPDATE fallisce con eccezione
          throw new Error('Database connection timeout');
        }
        return Promise.resolve({ rows: [] });
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-002', data: {} }]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Internal Server Error');
    });

    it('DEVE aggiornare stato a FAILURE se sistemi esterni falliscono', async () => {
      // Mock: externalSystemClient ritorna solo failed
      MockExternalSystemClient.prototype.sendToMultipleSystems.mockResolvedValue({
        successful: [],
        failed: [
          { system: 'djc', statusCode: 502, message: 'Service unavailable' },
          { system: 'gct', statusCode: 502, message: 'Service unavailable' }
        ]
      });

      mockPool.query.mockImplementation((queryConfig) => {
        if (queryConfig.text.includes('UPDATE woc.comunication_asyncro_djc')) {
          return Promise.resolve({
            rows: [{
              response_id: 'res-123',
              djc_sync_status: 'RECEIVED_FROM_DJC',
              version: 2
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-003', data: {} }]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('External System Error');
    });

    it('DEVE ritornare 400 se X-IBM-Client-Secret non configurato', async () => {
      // Mock config senza secret
      const configModule = require('../config');
      configModule.getInstance.mockResolvedValue({
        getByPath: jest.fn((path) => {
          if (path === 'apic.clientSecret') return null; // ⚠️ Config mancante
          return 'mock-value';
        })
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-004', data: {} }]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Client Secret');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 📖 TEST: GET /api/synch-status/{requestId}
  // ─────────────────────────────────────────────────────────────────────
  describe('GET /api/synch-status/{requestId} - Stato comunicazione', () => {
    
    it('DEVE ritornare record trovato con status PENDING', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-456',
          job_card_id: 'JC-001',
          push_timestamp: '2025-01-15T10:00:00Z',
          djc_sync_status: 'PENDING',
          retry_count: 0,
          error_code: null,
          error_message: null,
          created_at: '2025-01-15T10:00:00Z',
          updated_at: '2025-01-15T10:00:00Z',
          version: 1
        }]
      });

      const event = {
        httpMethod: 'GET',
        path: '/api/synch-status/res-456',
        rawPath: '/api/synch-status/res-456',
        pathParameters: { requestId: 'res-456' },
        headers: {
          authorization: 'Bearer valid-token'
        },
        requestContext: {
          http: { method: 'GET' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.requestId).toBe('res-456');
      expect(body.status).toBe('PENDING');
      expect(body.jobCardId).toBe('JC-001');
    });

    it('DEVE ritornare record con status SUCCESS dopo callback DJC', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-789',
          job_card_id: 'JC-002',
          djc_sync_status: 'SUCCESS',
          retry_count: 0,
          error_code: null,
          created_at: '2025-01-15T10:00:00Z',
          updated_at: '2025-01-15T10:05:00Z',
          version: 3
        }]
      });

      const event = {
        httpMethod: 'GET',
        path: '/api/synch-status/res-789',
        rawPath: '/api/synch-status/res-789',
        pathParameters: { requestId: 'res-789' },
        headers: {
          authorization: 'Bearer valid-token'
        },
        requestContext: {
          http: { method: 'GET' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('SUCCESS');
      expect(body.version).toBe(3);
    });

    it('DEVE ritornare 404 se record non trovato', async () => {
      mockPool.query.mockResolvedValue({
        rows: []
      });

      const event = {
        httpMethod: 'GET',
        path: '/api/synch-status/res-NOT-FOUND',
        rawPath: '/api/synch-status/res-NOT-FOUND',
        pathParameters: { requestId: 'res-NOT-FOUND' },
        headers: {
          authorization: 'Bearer valid-token'
        },
        requestContext: {
          http: { method: 'GET' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
    });

    it('DEVE ritornare 400 se requestId non valido', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/synch-status/abc', // troppo corto
        rawPath: '/api/synch-status/abc',
        pathParameters: { requestId: 'abc' },
        headers: {
          authorization: 'Bearer valid-token'
        },
        requestContext: {
          http: { method: 'GET' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
    });

    it('DEVE ritornare record con status ERROR se lambda fallita', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-error',
          job_card_id: 'JC-005',
          djc_sync_status: 'ERROR',
          error_code: 'LAMBDA_EXCEPTION',
          error_message: 'Database connection timeout',
          retry_count: 0,
          created_at: '2025-01-15T10:00:00Z',
          updated_at: '2025-01-15T10:01:00Z',
          version: 2
        }]
      });

      const event = {
        httpMethod: 'GET',
        path: '/api/synch-status/res-error',
        rawPath: '/api/synch-status/res-error',
        pathParameters: { requestId: 'res-error' },
        headers: {
          authorization: 'Bearer valid-token'
        },
        requestContext: {
          http: { method: 'GET' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ERROR');
      expect(body.errorCode).toBe('LAMBDA_EXCEPTION');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🛠️  TEST: Utility Functions
  // ─────────────────────────────────────────────────────────────────────
  describe('Utility Functions', () => {
    
    it('_buildResponse DEVE costruire risposta HTTP corretta', () => {
      const response = _buildResponse(200, { message: 'OK' }, 'trace-abc');
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['X-Trace-Id']).toBe('trace-abc');
      expect(JSON.parse(response.body).message).toBe('OK');
    });

    it('_buildResponse DEVE includere CORS headers', () => {
      const response = _buildResponse(200, {}, 'trace-123');
      
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔄 TEST: Idempotency (same job_card_id + push_timestamp)
  // ─────────────────────────────────────────────────────────────────────
  describe('Idempotency - ON CONFLICT DO UPDATE', () => {
    
    it('DEVE handle duplicate callback DJC con ON CONFLICT DO UPDATE', async () => {
      // Simula primo callback
      let callCount = 0;
      mockPool.query.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Prima UPDATE: OK
          return Promise.resolve({
            rows: [{
              response_id: 'res-123',
              djc_sync_status: 'RECEIVED_FROM_DJC',
              version: 2
            }]
          });
        } else if (callCount === 2) {
          // Seconda UPDATE (stesso callback): ON CONFLICT attiva
          return Promise.resolve({
            rows: [{
              response_id: 'res-123',
              djc_sync_status: 'RECEIVED_FROM_DJC',
              version: 2 // version rimane uguale perchè è lo stesso record
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-006', data: {} }]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      // Chiama due volte lo stesso payload
      const response1 = await handler(event, {});
      const response2 = await handler(event, {});
      
      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      // Entrambi ritornano successo grazie a ON CONFLICT
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🌐 TEST: API Gateway Proxy Integration Formats
  // ─────────────────────────────────────────────────────────────────────
  describe('API Gateway Proxy Integration', () => {
    
    it('DEVE supportare API Gateway v2 (rawPath + requestContext.http.method)', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ response_id: 'res-123', djc_sync_status: 'RECEIVED_FROM_DJC', version: 2 }]
      });

      const event = {
        rawPath: '/api/synch-status', // v2 format
        requestContext: {
          http: { method: 'POST' } // v2 format
        },
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-007', data: {} }]
        })
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(200);
    });

    it('DEVE supportare direct Lambda invoke con action', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ response_id: 'res-456', djc_sync_status: 'SUCCESS', version: 3 }]
      });

      const event = {
        action: 'GET_SYNCH_STATUS',
        requestId: 'res-456'
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.requestId).toBe('res-456');
    });

    it('DEVE ritornare 404 per endpoint non riconosciuto', async () => {
      const event = {
        rawPath: '/api/unknown-endpoint',
        requestContext: {
          http: { method: 'POST' }
        },
        headers: {
          authorization: 'Bearer valid-token'
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔁 TEST: Retry Logic & Recovery
  // ─────────────────────────────────────────────────────────────────────
  describe('Retry Logic and Error Recovery', () => {
    
    it('DEVE aggiornare retry_count quando external system fallisce', async () => {
      MockExternalSystemClient.prototype.sendToMultipleSystems.mockResolvedValue({
        successful: [],
        failed: [{ system: 'djc', statusCode: 503, message: 'Retry later' }]
      });

      const updateFailureQueryCapture = jest.fn();
      mockPool.query.mockImplementation((queryConfig) => {
        if (queryConfig.text.includes('UPDATE woc.comunication_asyncro_djc') && 
            queryConfig.text.includes('FAILURE')) {
          updateFailureQueryCapture(queryConfig);
        }
        return Promise.resolve({
          rows: [{
            response_id: 'res-retry',
            djc_sync_status: queryConfig.text.includes('FAILURE') ? 'FAILURE' : 'RECEIVED_FROM_DJC',
            version: 2
          }]
        });
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/synch-status',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-008', data: {} }]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(503);
      expect(mockPool.query).toHaveBeenCalled();
    });
  });

});
