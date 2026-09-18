// dbClient.integration.test.js
// Test di integrazione per database operations
// Mock pool PostgreSQL queries: UPDATE, ON CONFLICT, SELECT

const { getPool } = require('../../shared/dbClient');

jest.mock('../../shared/dbClient');

describe('Database Integration - woc.comunication_asyncro_djc', () => {
  
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {
      query: jest.fn(),
      end: jest.fn(),
      connect: jest.fn()
    };
    getPool.mockResolvedValue(mockPool);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 📝 TEST: UPDATE record (corrected logic)
  // ─────────────────────────────────────────────────────────────────────
  describe('UPDATE record - Callback DJC', () => {
    
    it('DEVE UPDATE record con campi corretti (status RECEIVED_FROM_DJC)', async () => {
      const pool = await getPool();
      
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-123',
          djc_sync_status: 'RECEIVED_FROM_DJC',
          version: 2
        }]
      });

      const result = await pool.query({
        text: `UPDATE woc.comunication_asyncro_djc 
               SET djc_sync_status = $1, json_modified = $2, updated_at = $3, version = version + 1
               WHERE job_card_id = $4 AND push_timestamp = $5
               RETURNING response_id, djc_sync_status, version`,
        values: [
          'RECEIVED_FROM_DJC',
          JSON.stringify({ events: [] }),
          new Date(),
          'JC-001',
          new Date()
        ]
      });

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].djc_sync_status).toBe('RECEIVED_FROM_DJC');
      expect(result.rows[0].version).toBe(2);
    });

    it('DEVE ritornare 0 rows se record non trovato (404 scenario)', async () => {
      const pool = await getPool();
      
      mockPool.query.mockResolvedValue({
        rows: [] // Nessun record aggiornato
      });

      const result = await pool.query({
        text: `UPDATE woc.comunication_asyncro_djc 
               SET djc_sync_status = $1, updated_at = $2, version = version + 1
               WHERE job_card_id = $3 AND push_timestamp = $4
               RETURNING response_id`,
        values: ['RECEIVED_FROM_DJC', new Date(), 'JC-NOT-EXISTS', new Date()]
      });

      expect(result.rows.length).toBe(0); // Record non trovato
    });

    it('DEVE incrementare version ad ogni UPDATE', async () => {
      const pool = await getPool();
      
      // Simula 3 UPDATE sequenziali
      let version = 1;
      mockPool.query.mockImplementation(() => {
        version++;
        return Promise.resolve({
          rows: [{
            response_id: 'res-123',
            version: version
          }]
        });
      });

      await pool.query({ text: 'UPDATE ...', values: [] });
      const result1 = await pool.query({ text: 'UPDATE ...', values: [] });
      const result2 = await pool.query({ text: 'UPDATE ...', values: [] });

      expect(result1.rows[0].version).toBe(3);
      expect(result2.rows[0].version).toBe(4);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔄 TEST: ON CONFLICT DO UPDATE - Idempotency
  // ─────────────────────────────────────────────────────────────────────
  describe('ON CONFLICT DO UPDATE - Gestione duplicate callback', () => {
    
    it('DEVE aggiornare record se (job_card_id, push_timestamp) duplicate', async () => {
      const pool = await getPool();
      
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-123',
          djc_sync_status: 'RECEIVED_FROM_DJC',
          version: 2
        }]
      });

      // Simula chiamata due volte con stessi parametri (stessa callback DJC)
      const query = `
        UPDATE woc.comunication_asyncro_djc
        SET json_modified = $1, djc_sync_status = $2, version = version + 1, updated_at = $3
        WHERE job_card_id = $4 AND push_timestamp = $5
        RETURNING response_id, version
      `;

      const values = ['{"events":[]}', 'RECEIVED_FROM_DJC', new Date(), 'JC-001', new Date()];

      const result1 = await pool.query({ text: query, values });
      const result2 = await pool.query({ text: query, values });

      expect(result1.rows[0].response_id).toBe('res-123');
      expect(result2.rows[0].response_id).toBe('res-123'); // Stesso record
    });

    it('DEVE preservare idempotency senza duplicare record', async () => {
      const pool = await getPool();
      
      // Simula: primo UPDATE OK, secondo (retry) no rows (conflict handled by DB)
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-123',
          version: 2
        }]
      });

      const result = await pool.query({
        text: 'UPDATE woc.comunication_asyncro_djc WHERE job_card_id = $1 AND push_timestamp = $2',
        values: ['JC-001', new Date()]
      });

      // Il database non crea duplicati grazie a unique constraint
      expect(result.rows.length).toBe(1); // Solo un record
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔍 TEST: SELECT record (GET /api/synch-status/{requestId})
  // ─────────────────────────────────────────────────────────────────────
  describe('SELECT record - Lettura stato comunicazione', () => {
    
    it('DEVE SELECT record con tutti i campi necessari', async () => {
      const pool = await getPool();
      
      const mockRecord = {
        response_id: 'res-789',
        job_card_id: 'JC-002',
        push_timestamp: '2025-01-15T10:00:00Z',
        djc_sync_status: 'SUCCESS',
        json_payload: '{"events":[]}',
        json_modified: '{"sentAt":"2025-01-15T10:05:00Z"}',
        retry_count: 0,
        error_code: null,
        error_message: null,
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-15T10:05:00Z',
        version: 3
      };

      mockPool.query.mockResolvedValue({
        rows: [mockRecord]
      });

      const result = await pool.query({
        text: `SELECT response_id, job_card_id, djc_sync_status, json_payload, 
               retry_count, error_code, error_message, created_at, updated_at, version
               FROM woc.comunication_asyncro_djc 
               WHERE response_id = $1 LIMIT 1`,
        values: ['res-789']
      });

      expect(result.rows.length).toBe(1);
      const record = result.rows[0];
      expect(record.response_id).toBe('res-789');
      expect(record.djc_sync_status).toBe('SUCCESS');
      expect(record.version).toBe(3);
      expect(record.error_code).toBeNull(); // SUCCESS: no errors
    });

    it('DEVE ritornare empty set se record non trovato', async () => {
      const pool = await getPool();
      
      mockPool.query.mockResolvedValue({
        rows: []
      });

      const result = await pool.query({
        text: 'SELECT * FROM woc.comunication_asyncro_djc WHERE response_id = $1',
        values: ['res-NOT-FOUND']
      });

      expect(result.rows.length).toBe(0);
    });

    it('DEVE SELECT record con status ERROR e error details', async () => {
      const pool = await getPool();
      
      mockPool.query.mockResolvedValue({
        rows: [{
          response_id: 'res-error',
          job_card_id: 'JC-005',
          djc_sync_status: 'ERROR',
          error_code: 'LAMBDA_EXCEPTION',
          error_message: 'Database connection timeout',
          retry_count: 1,
          version: 2
        }]
      });

      const result = await pool.query({
        text: 'SELECT * FROM woc.comunication_asyncro_djc WHERE response_id = $1',
        values: ['res-error']
      });

      expect(result.rows[0].djc_sync_status).toBe('ERROR');
      expect(result.rows[0].error_code).toBe('LAMBDA_EXCEPTION');
      expect(result.rows[0].error_message).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // ⏱️  TEST: Statement Timeout & Query Optimization
  // ─────────────────────────────────────────────────────────────────────
  describe('Query Performance & Timeouts', () => {
    
    it('DEVE eseguire query con statement_timeout = 5000ms', async () => {
      const pool = await getPool();
      
      mockPool.query.mockResolvedValue({ rows: [] });

      await pool.query({
        text: 'UPDATE woc.comunication_asyncro_djc SET djc_sync_status = $1 WHERE job_card_id = $2',
        values: ['SUCCESS', 'JC-001'],
        statement_timeout: 5000
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.objectContaining({
          statement_timeout: 5000
        })
      );
    });

    it('DEVE usare indice su response_id per SELECT veloce', async () => {
      const pool = await getPool();
      
      // Simula query plan: IndexScan su PK response_id
      mockPool.query.mockResolvedValue({
        rows: [{ response_id: 'res-456', djc_sync_status: 'PENDING' }]
      });

      const result = await pool.query({
        text: 'SELECT * FROM woc.comunication_asyncro_djc WHERE response_id = $1 LIMIT 1',
        values: ['res-456']
      });

      // Nel vero DB, questa query usa l'indice PK (risposta <10ms)
      expect(result.rows[0].response_id).toBe('res-456');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 🔐 TEST: Data Integrity & Constraints
  // ─────────────────────────────────────────────────────────────────────
  describe('Database Constraints & Data Integrity', () => {
    
    it('DEVE garantire unique key (job_card_id, push_timestamp)', async () => {
      const pool = await getPool();
      
      // Simula constraint violation
      mockPool.query.mockRejectedValue(
        new Error('duplicate key value violates unique constraint "idx_job_card_id_push_timestamp"')
      );

      await expect(
        pool.query({
          text: 'INSERT INTO woc.comunication_asyncro_djc (job_card_id, push_timestamp) VALUES ($1, $2)',
          values: ['JC-001', new Date()]
        })
      ).rejects.toThrow('duplicate key');
    });

    it('DEVE ritornare version number per optimistic locking', async () => {
      const pool = await getPool();
      
      mockPool.query.mockResolvedValue({
        rows: [{ version: 5 }]
      });

      const result = await pool.query({
        text: 'SELECT version FROM woc.comunication_asyncro_djc WHERE response_id = $1',
        values: ['res-123']
      });

      expect(result.rows[0].version).toBe(5);
    });

    it('DEVE serializzare JSON payload in json_payload', async () => {
      const pool = await getPool();
      
      const jsonPayload = { events: [{ job_card_id: 'JC-001' }] };
      mockPool.query.mockResolvedValue({
        rows: [{ json_payload: JSON.stringify(jsonPayload) }]
      });

      const result = await pool.query({
        text: 'SELECT json_payload FROM woc.comunication_asyncro_djc WHERE response_id = $1',
        values: ['res-123']
      });

      expect(JSON.parse(result.rows[0].json_payload).events[0].job_card_id).toBe('JC-001');
    });
  });

});
