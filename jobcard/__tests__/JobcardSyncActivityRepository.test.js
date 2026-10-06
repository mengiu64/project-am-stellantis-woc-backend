'use strict';

jest.mock('../db', () => ({ getPool: jest.fn() }));

const db = require('../db');
const {
  resolveJobCardId,
  upsertSyncActivity,
  recordSyncActivity,
  selectSyncStatus,
  getSyncStatus,
  withSyncStatus,
  selectLastPayload,
  getLastPayload,
  UPSERT_SQL,
  SELECT_SYNC_STATUS_SQL,
  SELECT_LAST_PAYLOAD_SQL,
} = require('../JobcardSyncActivityRepository');

describe('JobcardSyncActivityRepository', () => {
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('resolveJobCardId', () => {
    test('prefers roInfo.jobCardSrpId', () => {
      expect(resolveJobCardId({
        roInfo: { jobCardSrpId: 'SRP-1', dmsRepairOrderId: '84564621', jobCardLegacyId: 'L-1' },
      })).toBe('SRP-1');
    });

    test('falls back to dmsRepairOrderId, then jobCardLegacyId', () => {
      expect(resolveJobCardId({ roInfo: { dmsRepairOrderId: 84564621, jobCardLegacyId: 'L-1' } })).toBe('84564621');
      expect(resolveJobCardId({ roInfo: { jobCardSrpId: '  ', dmsRepairOrderId: null, jobCardLegacyId: ' L-1 ' } })).toBe('L-1');
    });

    test('returns null when no id is available', () => {
      expect(resolveJobCardId({ roInfo: {} })).toBeNull();
      expect(resolveJobCardId({})).toBeNull();
      expect(resolveJobCardId(undefined)).toBeNull();
    });
  });

  describe('upsertSyncActivity', () => {
    test('runs the UPSERT with jobcardid and serialized payload, returning the row', async () => {
      const row = { jobcardid: 'SRP-1', creationdate: new Date('2026-09-30T10:00:00Z') };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
      const payload = { roInfo: { jobCardSrpId: 'SRP-1' }, jobs: [{ jobDescription: 'x' }] };

      await expect(upsertSyncActivity(pool, 'SRP-1', payload)).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(UPSERT_SQL, ['SRP-1', JSON.stringify(payload)]);
    });

    test('UPSERT only updates payload on conflict (creationdate/ack/reasons/lastupdate untouched)', () => {
      expect(UPSERT_SQL).toMatch(/INSERT INTO woc\.jobcard_sync_activity \(jobcardid, creationdate, payload\)/);
      expect(UPSERT_SQL).toMatch(/ON CONFLICT \(jobcardid\) DO UPDATE SET payload = EXCLUDED\.payload\s+RETURNING/);
    });
  });

  describe('recordSyncActivity', () => {
    const payload = { roInfo: { dmsRepairOrderId: '84564621' } };

    test('uses the injected getPool and upserts the payload', async () => {
      const row = { jobcardid: '84564621' };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
      const getPool = jest.fn().mockResolvedValue(pool);

      await expect(recordSyncActivity(payload, { getPool })).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(UPSERT_SQL, ['84564621', JSON.stringify(payload)]);
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('defaults to db.getPool when no getPool is injected', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [{ jobcardid: '84564621' }] }) };
      db.getPool.mockResolvedValue(pool);

      await recordSyncActivity(payload);
      expect(db.getPool).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test('throws an "is required" error (-> 400) without touching the DB when no jobcard id is present', async () => {
      const getPool = jest.fn();
      await expect(recordSyncActivity({ roInfo: {} }, { getPool }))
        .rejects.toThrow('[jobCard] roInfo.jobCardSrpId/dmsRepairOrderId/jobCardLegacyId is required');
      expect(getPool).not.toHaveBeenCalled();
    });

    test('propagates DB errors (blocking)', async () => {
      const getPool = jest.fn().mockResolvedValue({ query: jest.fn().mockRejectedValue(new Error('connection refused')) });
      await expect(recordSyncActivity(payload, { getPool })).rejects.toThrow('connection refused');
    });

    test('propagates pool creation errors (blocking)', async () => {
      const getPool = jest.fn().mockRejectedValue(new Error('secret fetch failed'));
      await expect(recordSyncActivity(payload, { getPool })).rejects.toThrow('secret fetch failed');
    });
  });

  describe('selectSyncStatus', () => {
    test('selects ack/techreason/businessreason by jobcardid, returning the row', async () => {
      const row = { ack: 'OK', techreason: 'SYNCED', businessreason: 'SYNCED - ok' };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };

      await expect(selectSyncStatus(pool, 'SRP-1')).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(SELECT_SYNC_STATUS_SQL, ['SRP-1']);
      expect(SELECT_SYNC_STATUS_SQL).toMatch(
        /SELECT ack, techreason, businessreason\s+FROM woc\.jobcard_sync_activity\s+WHERE jobcardid = \$1/,
      );
    });

    test('returns null when the jobcard is not tracked', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(selectSyncStatus(pool, 'SRP-404')).resolves.toBeNull();
    });
  });

  describe('getSyncStatus', () => {
    const empty = { ack: '', techReason: '', businessReason: '' };
    const poolReturning = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });

    test('maps the row to ack/techReason/businessReason using the injected getPool', async () => {
      const pool = poolReturning([{ ack: 'KO', techreason: 'FAILED', businessreason: 'FAILED - DMS down' }]);
      const getPool = jest.fn().mockResolvedValue(pool);

      await expect(getSyncStatus('SRP-1', { getPool }))
        .resolves.toEqual({ ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS down' });
      expect(pool.query).toHaveBeenCalledWith(SELECT_SYNC_STATUS_SQL, ['SRP-1']);
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('defaults to db.getPool and trims/stringifies the id', async () => {
      const pool = poolReturning([{ ack: 'OK', techreason: 'SYNCED', businessreason: null }]);
      db.getPool.mockResolvedValue(pool);

      await expect(getSyncStatus(' SRP-1 ')).resolves.toEqual({ ack: 'OK', techReason: 'SYNCED', businessReason: '' });
      await getSyncStatus(84564621);
      expect(db.getPool).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls.map(([, params]) => params)).toEqual([['SRP-1'], ['84564621']]);
    });

    test('returns empty strings when the outcome has not been populated yet (NULL columns)', async () => {
      const getPool = jest.fn().mockResolvedValue(poolReturning([{ ack: null, techreason: null, businessreason: null }]));
      await expect(getSyncStatus('SRP-1', { getPool })).resolves.toEqual(empty);
    });

    test('returns empty strings when the jobcard is not tracked', async () => {
      const getPool = jest.fn().mockResolvedValue(poolReturning([]));
      await expect(getSyncStatus('SRP-404', { getPool })).resolves.toEqual(empty);
    });

    test.each([undefined, null, '', '   '])('returns empty strings without touching the DB for id %p', async (id) => {
      const getPool = jest.fn();
      await expect(getSyncStatus(id, { getPool })).resolves.toEqual(empty);
      expect(getPool).not.toHaveBeenCalled();
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('is best-effort on query errors: logs a warning and returns empty strings', async () => {
      const getPool = jest.fn().mockResolvedValue({ query: jest.fn().mockRejectedValue(new Error('connection refused')) });

      await expect(getSyncStatus('SRP-1', { getPool })).resolves.toEqual(empty);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('jobcardid=SRP-1: connection refused'));
    });

    test('is best-effort on pool creation errors', async () => {
      const getPool = jest.fn().mockRejectedValue(new Error('secret fetch failed'));

      await expect(getSyncStatus('SRP-1', { getPool })).resolves.toEqual(empty);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('secret fetch failed'));
    });

    test('is best-effort when the DB does not answer within timeoutMs', async () => {
      const getPool = jest.fn().mockResolvedValue({ query: jest.fn().mockReturnValue(new Promise(() => {})) });

      await expect(getSyncStatus('SRP-1', { getPool, timeoutMs: 5 })).resolves.toEqual(empty);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('jobcardid=SRP-1: timeout dopo 5 ms'));
    });

    test('clears the timeout once the read completes', async () => {
      jest.useFakeTimers();
      try {
        const getPool = jest.fn().mockResolvedValue(poolReturning([{ ack: 'OK' }]));

        await expect(getSyncStatus('SRP-1', { getPool }))
          .resolves.toEqual({ ack: 'OK', techReason: '', businessReason: '' });
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('withSyncStatus', () => {
    const syncStatus = { ack: 'OK', techReason: '', businessReason: '' };

    test('inserts the outcome right before jobCardDetail (jobCardDetails response)', () => {
      const jobCardDetail = { roInfo: { jobCardSrpId: 'SRP-1' } };
      const body = {
        dmsAvailable: true, statusCode: 200, success: true, message: 'Job card retrieved successfully', jobCardDetail,
      };

      const result = withSyncStatus(body, syncStatus);
      expect(Object.keys(result)).toEqual([
        'dmsAvailable', 'statusCode', 'success', 'message', 'ack', 'techReason', 'businessReason', 'jobCardDetail',
      ]);
      expect(result).toEqual({ ...body, ...syncStatus });
      expect(result.jobCardDetail).toBe(jobCardDetail);
      expect(body).not.toHaveProperty('ack');
    });

    test('appends the outcome when there is no jobCardDetail (saveJobcard response)', () => {
      const body = { statusCode: 200, success: true, message: 'Job Card Transaction Successful', jobCardId: 'SRP-1' };

      const result = withSyncStatus(body, syncStatus);
      expect(Object.keys(result)).toEqual([
        'statusCode', 'success', 'message', 'jobCardId', 'ack', 'techReason', 'businessReason',
      ]);
      expect(result).toEqual({ ...body, ...syncStatus });
    });

    test.each([undefined, null, 'raw text body', 42, [{ a: 1 }]])('returns non-object body %p unchanged', (body) => {
      expect(withSyncStatus(body, syncStatus)).toBe(body);
    });
  });

  describe('selectLastPayload', () => {
    test('selects jobcardid/payload by jobcardid, returning the row', async () => {
      const row = { jobcardid: 'SRP-1', payload: { roInfo: { jobCardSrpId: 'SRP-1' } } };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };

      await expect(selectLastPayload(pool, 'SRP-1')).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(SELECT_LAST_PAYLOAD_SQL, ['SRP-1']);
      expect(SELECT_LAST_PAYLOAD_SQL).toMatch(
        /SELECT jobcardid, payload\s+FROM woc\.jobcard_sync_activity\s+WHERE jobcardid = \$1/,
      );
    });

    test('returns null when the jobcard is not tracked', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(selectLastPayload(pool, 'SRP-404')).resolves.toBeNull();
    });
  });

  describe('getLastPayload', () => {
    const payload = { roInfo: { jobCardSrpId: 'SRP-1' }, jobs: [{ jobDescription: 'Service' }] };
    const poolReturning = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });

    test('returns jobCardId and the stored payload using the injected getPool', async () => {
      const pool = poolReturning([{ jobcardid: 'SRP-1', payload }]);
      const getPool = jest.fn().mockResolvedValue(pool);

      const result = await getLastPayload('SRP-1', { getPool });
      expect(result).toEqual({ jobCardId: 'SRP-1', payload });
      expect(result.payload).toBe(payload);
      expect(pool.query).toHaveBeenCalledWith(SELECT_LAST_PAYLOAD_SQL, ['SRP-1']);
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('defaults to db.getPool and trims/stringifies the id', async () => {
      const pool = poolReturning([{ jobcardid: 'SRP-1', payload }]);
      db.getPool.mockResolvedValue(pool);

      await getLastPayload(' SRP-1 ');
      await getLastPayload(84564621);
      expect(db.getPool).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls.map(([, params]) => params)).toEqual([['SRP-1'], ['84564621']]);
    });

    test('returns null when the jobcard has no recorded payload', async () => {
      const getPool = jest.fn().mockResolvedValue(poolReturning([]));
      await expect(getLastPayload('SRP-404', { getPool })).resolves.toBeNull();
    });

    test.each([undefined, null, '', '   '])('throws an "is required" error (-> 400) without touching the DB for id %p', async (id) => {
      const getPool = jest.fn();
      await expect(getLastPayload(id, { getPool })).rejects.toThrow('[jobCard] jobCardId is required');
      expect(getPool).not.toHaveBeenCalled();
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('propagates DB errors (blocking, unlike getSyncStatus)', async () => {
      const getPool = jest.fn().mockResolvedValue({ query: jest.fn().mockRejectedValue(new Error('connection refused')) });
      await expect(getLastPayload('SRP-1', { getPool })).rejects.toThrow('connection refused');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test('propagates pool creation errors (blocking)', async () => {
      const getPool = jest.fn().mockRejectedValue(new Error('secret fetch failed'));
      await expect(getLastPayload('SRP-1', { getPool })).rejects.toThrow('secret fetch failed');
    });
  });
});
