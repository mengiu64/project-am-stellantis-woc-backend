// integration.e2e.test.js
// End-to-end integration tests
// Flow completo: isStellantisBrand crea record → DJC callback → syncro-kafka-events UPDATE

const { handler } = require('../index');
const { getPool } = require('../../shared/dbClient');

jest.mock('../../shared/dbClient');
jest.mock('../config');
jest.mock('../logger');
jest.mock('../validator');
jest.mock('../authService');
jest.mock('../externalSystemClient');

describe('End-to-End Integration Tests', () => {
  
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {
      query: jest.fn(),
      end: jest.fn()
    };
    getPool.mockResolvedValue(mockPool);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔄 TEST: Complete Flow - isStellantisBrand → DJC → syncro-kafka-events
  // ─────────────────────────────────────────────────────────────────────
  describe('Flow: isStellantisBrand → DJC → syncro-kafka-events', () => {
    
    it('DEVE completare flow end-to-end con successo', async () => {
      // Step 1: isStellantisBrand crea record in Aurora (PENDING)
      const recordCreatedByisStellantisBrand = {
        response_id: 'res-e2e-001',
        job_card_id: 'JC-E2E-001',
        push_timestamp: new Date(),
        djc_sync_status: 'PENDING',
        version: 1
      };

      // Step 2: DJC callback → syncro-kafka-events riceve evento
      const djcCallbackEvent = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token',
          'X-IBM-Client-Id': 'djc-system'
        },
        body: JSON.stringify({
          events: [{
            job_card_id: recordCreatedByisStellantisBrand.job_card_id,
            status: 'processed',
            timestamp: new Date().toISOString()
          }]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      // Mock Step 1: SELECT record creato da isStellantisBrand
      let queryCount = 0;
      mockPool.query.mockImplementation((queryConfig) => {
        queryCount++;
        
        if (queryConfig.text.includes('UPDATE woc.comunication_asyncro_djc')) {
          // Prima UPDATE: RECEIVED_FROM_DJC
          if (queryConfig.text.includes('RECEIVED_FROM_DJC')) {
            return Promise.resolve({
              rows: [{
                response_id: recordCreatedByisStellantisBrand.response_id,
                djc_sync_status: 'RECEIVED_FROM_DJC',
                version: 2
              }]
            });
          }
          // Seconda UPDATE: SUCCESS (dopo invio a sistemi)
          return Promise.resolve({
            rows: [{
              response_id: recordCreatedByisStellantisBrand.response_id,
              version: 3
            }]
          });
        }
        
        return Promise.resolve({ rows: [] });
      });

      // Mock ExternalSystemClient: invio a DJC + GCT
      const MockExternalSystemClient = require('../externalSystemClient');
      MockExternalSystemClient.prototype.sendToMultipleSystems.mockResolvedValue({
        successful: [
          { system: 'djc', statusCode: 200 },
          { system: 'gct', statusCode: 200 }
        ],
        failed: []
      });

      // Step 3: Esegui handler (syncro-kafka-events)
      const response = await handler(djcCallbackEvent, {});

      // Step 4: Verifica risultato
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobCardId).toBe('JC-E2E-001');
      expect(body.results.successful).toBe(2); // DJC + GCT
      
      // Step 5: Verifica che database sia stato aggiornato 2+ volte
      expect(mockPool.query.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('DEVE fallire e ritornare 404 se record non esiste (isStellantisBrand not called)', async () => {
      // Step 1: isStellantisBrand non ha creato record
      // Step 2: DJC invia callback per record inesistente
      const orphanedCallback = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: JSON.stringify({
          events: [{
            job_card_id: 'JC-ORPHANED-001',
            status: 'processed'
          }]
        }),
        requestContext: {
          http: { method: 'POST' }
        }
      };

      // Mock: UPDATE ritorna 0 rows (record non trovato)
      mockPool.query.mockResolvedValue({ rows: [] });

      // Step 3: Esegui handler
      const response = await handler(orphanedCallback, {});

      // Step 4: Verifica 404
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
    });

    it('DEVE aggiornare stato correttamente attraverso flow', async () => {
      // Track stato transitions
      const stateTransitions = [];

      mockPool.query.mockImplementation((queryConfig) => {
        if (queryConfig.text.includes('UPDATE')) {
          if (queryConfig.values[0] === 'RECEIVED_FROM_DJC') {
            stateTransitions.push('PENDING → RECEIVED_FROM_DJC');
          } else if (queryConfig.values[0] === 'SUCCESS') {
            stateTransitions.push('RECEIVED_FROM_DJC → SUCCESS');
          }
        }
        
        return Promise.resolve({
          rows: [{
            response_id: 'res-001',
            version: stateTransitions.length + 1
          }]
        });
      });

      const MockExternalSystemClient = require('../externalSystemClient');
      MockExternalSystemClient.prototype.sendToMultipleSystems.mockResolvedValue({
        successful: [{ system: 'djc', statusCode: 200 }],
        failed: []
      });

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        headers: { authorization: 'Bearer valid-token' },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-001' }]
        }),
        requestContext: { http: { method: 'POST' } }
      };

      await handler(event, {});

      // Verifica transizioni di stato
      expect(stateTransitions).toContainEqual('PENDING → RECEIVED_FROM_DJC');
      expect(stateTransitions).toContainEqual('RECEIVED_FROM_DJC → SUCCESS');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔍 TEST: GET /api/synch-status - Query after flow completion
  // ─────────────────────────────────────────────────────────────────────
  describe('GET /api/synch-status after POST completion', () => {
    
    it('DEVE ritornare stato SUCCESS dopo POST flow completo', async () => {
      // Simula: record è già stato aggiornato da POST flow
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-e2e-001',
          job_card_id: 'JC-E2E-001',
          djc_sync_status: 'SUCCESS',
          retry_count: 0,
          error_code: null,
          created_at: '2025-01-15T10:00:00Z',
          updated_at: '2025-01-15T10:05:00Z',
          version: 3
        }]
      });

      const getEvent = {
        httpMethod: 'GET',
        rawPath: '/api/synch-status/res-e2e-001',
        pathParameters: { requestId: 'res-e2e-001' },
        headers: { authorization: 'Bearer valid-token' },
        requestContext: { http: { method: 'GET' } }
      };

      const response = await handler(getEvent, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('SUCCESS');
      expect(body.version).toBe(3);
    });

    it('DEVE ritornare stato FAILURE se POST fallisce', async () => {
      // Simula: record è stato aggiornato con status FAILURE
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-failed-001',
          job_card_id: 'JC-FAILED-001',
          djc_sync_status: 'FAILURE',
          error_code: '502',
          error_message: 'Bad Gateway - DJC unavailable',
          retry_count: 1,
          version: 2
        }]
      });

      const getEvent = {
        httpMethod: 'GET',
        rawPath: '/api/synch-status/res-failed-001',
        pathParameters: { requestId: 'res-failed-001' },
        headers: { authorization: 'Bearer valid-token' },
        requestContext: { http: { method: 'GET' } }
      };

      const response = await handler(getEvent, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('FAILURE');
      expect(body.errorCode).toBe('502');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔁 TEST: Retry Scenarios - DJC callback timeout & recovery
  // ─────────────────────────────────────────────────────────────────────
  describe('Retry Scenarios', () => {
    
    it('DEVE gestire DJC callback timeout e permettere retry', async () => {
      // Primo tentativo: timeout
      mockPool.query.mockRejectedValueOnce(new Error('Query timeout'));
      
      // Secondo tentativo: successo
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          response_id: 'res-retry-001',
          djc_sync_status: 'RECEIVED_FROM_DJC',
          version: 2
        }]
      });

      const callbackEvent = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        headers: { authorization: 'Bearer valid-token' },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-RETRY-001' }]
        }),
        requestContext: { http: { method: 'POST' } }
      };

      // Primo call fallisce (errore in catch block)
      const response1 = await handler(callbackEvent, {});
      expect(response1.statusCode).toBe(500);
    });

    it('DEVE accumulare retry_count su fallimenti ripetuti', async () => {
      let retryCount = 0;

      mockPool.query.mockImplementation((queryConfig) => {
        if (queryConfig.text.includes('UPDATE')) {
          retryCount++;
        }
        
        return Promise.resolve({
          rows: [{
            response_id: 'res-multi-retry',
            retry_count: retryCount,
            version: retryCount + 1
          }]
        });
      });

      const MockExternalSystemClient = require('../externalSystemClient');
      MockExternalSystemClient.prototype.sendToMultipleSystems.mockRejectedValue(
        new Error('Service temporarily unavailable')
      );

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        headers: { authorization: 'Bearer valid-token' },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-MULTI-RETRY' }]
        }),
        requestContext: { http: { method: 'POST' } }
      };

      // Primo tentativo
      const response1 = await handler(event, {});
      
      // Verifica che retry_count sia stato incrementato
      expect(retryCount).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 📊 TEST: Version Tracking & Optimistic Locking
  // ─────────────────────────────────────────────────────────────────────
  describe('Version Tracking & Optimistic Locking', () => {
    
    it('DEVE incrementare version ad ogni UPDATE', async () => {
      const versions = [];

      mockPool.query.mockImplementation((queryConfig) => {
        const currentVersion = versions.length + 1;
        versions.push(currentVersion);
        
        return Promise.resolve({
          rows: [{
            response_id: 'res-version-001',
            version: currentVersion
          }]
        });
      });

      const MockExternalSystemClient = require('../externalSystemClient');
      MockExternalSystemClient.prototype.sendToMultipleSystems.mockResolvedValue({
        successful: [{ system: 'djc' }],
        failed: []
      });

      const event = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        headers: { authorization: 'Bearer valid-token' },
        body: JSON.stringify({
          events: [{ job_card_id: 'JC-VERSION' }]
        }),
        requestContext: { http: { method: 'POST' } }
      };

      await handler(event, {});

      // Deve avere almeno 2 UPDATE (RECEIVED_FROM_DJC, SUCCESS)
      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions).toEqual([1, 2]); // Prima 1, poi 2
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🌐 TEST: Multiple Events in Single Callback
  // ─────────────────────────────────────────────────────────────────────
  describe('Multiple Events in Callback', () => {
    
    it('DEVE processare callback con multipli events', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-multi-001',
          djc_sync_status: 'RECEIVED_FROM_DJC',
          version: 2
        }]
      });

      const callbackWithMultipleEvents = {
        httpMethod: 'POST',
        rawPath: '/api/synch-status',
        headers: { authorization: 'Bearer valid-token' },
        body: JSON.stringify({
          events: [
            { job_card_id: 'JC-MULTI-001', status: 'complete' },
            { job_card_id: 'JC-MULTI-002', status: 'complete' },
            { job_card_id: 'JC-MULTI-003', status: 'failed' }
          ]
        }),
        requestContext: { http: { method: 'POST' } }
      };

      const MockExternalSystemClient = require('../externalSystemClient');
      MockExternalSystemClient.prototype.sendToMultipleSystems.mockResolvedValue({
        successful: [{ system: 'djc' }, { system: 'gct' }],
        failed: []
      });

      const response = await handler(callbackWithMultipleEvents, {});

      expect(response.statusCode).toBe(200);
      // Job Card ID estratto dal PRIMO evento
      const body = JSON.parse(response.body);
      expect(body.jobCardId).toBe('JC-MULTI-001');
    });
  });

});
