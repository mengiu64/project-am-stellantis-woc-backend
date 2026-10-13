'use strict';

jest.mock('../db', () => ({ getPool: jest.fn() }));

const db = require('../db');
const {
  resolveJobCardId,
  withTimeout,
  upsertSyncActivity,
  recordSyncActivity,
  updateDjcSynch,
  recordDjcSynch,
  selectSyncStatus,
  getSyncStatus,
  withSyncStatus,
  UPSERT_SQL,
  UPDATE_DJC_SYNCH_SQL,
  SELECT_SYNC_STATUS_SQL,
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

  describe('withTimeout', () => {
    test('resolves with the promise value and clears the timer', async () => {
      jest.useFakeTimers();
      try {
        await expect(withTimeout(Promise.resolve('row'), 1000)).resolves.toBe('row');
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    test('propagates the promise rejection', async () => {
      await expect(withTimeout(Promise.reject(new Error('connection refused')), 1000)).rejects.toThrow('connection refused');
    });

    test('rejects with "timeout dopo <ms> ms" when the promise does not settle in time', async () => {
      await expect(withTimeout(new Promise(() => {}), 5)).rejects.toThrow('timeout dopo 5 ms');
    });
  });

  describe('upsertSyncActivity', () => {
    test('runs the UPSERT with jobcardid and serialized payload, returning the row', async () => {
      const row = { jobcardid: 'SRP-1', creationdate: new Date('2026-09-30T10:00:00Z') };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
      const payload = { roInfo: { jobCardSrpId: 'SRP-1' }, jobs: [{ jobDescription: 'x' }] };

      await expect(upsertSyncActivity(pool, 'SRP-1', payload)).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(UPSERT_SQL, ['SRP-1', JSON.stringify(payload), false]);
    });

    test('passes force as $3 (strictly boolean) and returns undefined when the UPSERT is blocked', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(upsertSyncActivity(pool, 'SRP-1', {}, true)).resolves.toBeUndefined();
      expect(pool.query).toHaveBeenLastCalledWith(UPSERT_SQL, ['SRP-1', '{}', true]);
      await upsertSyncActivity(pool, 'SRP-1', {}, 'true');
      expect(pool.query).toHaveBeenLastCalledWith(UPSERT_SQL, ['SRP-1', '{}', false]);
    });

    test('UPSERT updates the row only when forced or when the previous push is not waiting for its ack', () => {
      const [, whereClause] = UPSERT_SQL.split('businessreason = NULL');
      expect(whereClause.replace(/\s+/g, ' ').trim()).toBe(
        "WHERE $3::boolean OR NOT (woc.jobcard_sync_activity.djcsynch IS TRUE AND COALESCE(woc.jobcard_sync_activity.ack, '') = '') RETURNING jobcardid, creationdate",
      );
    });

    test('UPSERT updates payload and resets djcsynch and the previous push outcome on conflict (creationdate/lastupdate untouched)', () => {
      expect(UPSERT_SQL).toMatch(/INSERT INTO woc\.jobcard_sync_activity \(jobcardid, creationdate, payload\)/);
      expect(UPSERT_SQL).toMatch(
        /ON CONFLICT \(jobcardid\) DO UPDATE SET payload = EXCLUDED\.payload, djcsynch = NULL,\s+ack = NULL, techreason = NULL, businessreason = NULL\s+WHERE/,
      );
    });

    test('UPSERT clears ack/techreason/businessreason so a new save never reports the outcome of the previous push', () => {
      const [, conflictClause] = UPSERT_SQL.split('ON CONFLICT (jobcardid) DO UPDATE SET');
      const [setClause] = conflictClause.split('WHERE');
      const assignments = setClause.split(',').map((part) => part.trim().replace(/\s+/g, ' '));

      expect(assignments).toEqual([
        'payload = EXCLUDED.payload',
        'djcsynch = NULL',
        'ack = NULL',
        'techreason = NULL',
        'businessreason = NULL',
      ]);
      expect(setClause).not.toMatch(/creationdate|lastupdate/);
    });
  });

  describe('recordSyncActivity', () => {
    const payload = { roInfo: { dmsRepairOrderId: '84564621' } };

    test('uses the injected getPool and upserts the payload', async () => {
      const row = { jobcardid: '84564621' };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
      const getPool = jest.fn().mockResolvedValue(pool);

      await expect(recordSyncActivity(payload, { getPool })).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(UPSERT_SQL, ['84564621', JSON.stringify(payload), false]);
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('throws isAckPending without writing when the previous push is waiting for its ack', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      const error = await recordSyncActivity(payload, { getPool: async () => pool }).catch((err) => err);
      expect(error.isAckPending).toBe(true);
      expect(error.jobCardId).toBe('84564621');
      expect(error.message).toBe('[djc] save blocked for jobCardId 84564621: previous synchronization not acknowledged yet');
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(console.log).not.toHaveBeenCalled();
    });

    test('forces the UPSERT and logs it', async () => {
      const row = { jobcardid: '84564621' };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
      await expect(recordSyncActivity(payload, { getPool: async () => pool, force: true })).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(UPSERT_SQL, ['84564621', JSON.stringify(payload), true]);
      expect(console.log).toHaveBeenCalledWith('[djc] jobcard_sync_activity upsert jobcardid=84564621 (force)');
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
        .rejects.toThrow('[djc] roInfo.jobCardSrpId/dmsRepairOrderId/jobCardLegacyId is required');
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

  describe('updateDjcSynch', () => {
    test('runs the UPDATE of djcsynch by jobcardid, returning the row', async () => {
      const row = { jobcardid: 'SRP-1', djcsynch: false };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };

      await expect(updateDjcSynch(pool, 'SRP-1', false)).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(UPDATE_DJC_SYNCH_SQL, ['SRP-1', false]);
      expect(UPDATE_DJC_SYNCH_SQL).toMatch(
        /UPDATE woc\.jobcard_sync_activity\s+SET djcsynch = \$2\s+WHERE jobcardid = \$1\s+RETURNING jobcardid, djcsynch/,
      );
    });

    test('returns null when the jobcard is not tracked', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(updateDjcSynch(pool, 'SRP-404', true)).resolves.toBeNull();
    });
  });

  describe('recordDjcSynch', () => {
    const poolUpdating = () => ({
      query: jest.fn(async (sql, [jobcardid, djcsynch]) => ({ rows: [{ jobcardid, djcsynch }] })),
    });

    test.each([
      [true, true],
      [false, false],
      [undefined, false],
      ['true', false],
      [1, false],
    ])('writes djcsynch === true (%p -> %p) using the injected getPool', async (outcome, expected) => {
      const pool = poolUpdating();
      const getPool = jest.fn().mockResolvedValue(pool);

      await expect(recordDjcSynch('SRP-1', outcome, { getPool })).resolves.toBe(true);
      expect(pool.query).toHaveBeenCalledWith(UPDATE_DJC_SYNCH_SQL, ['SRP-1', expected]);
      expect(logSpy).toHaveBeenCalledWith(`[djc] jobcard_sync_activity djcsynch=${expected} jobcardid=SRP-1`);
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('defaults to db.getPool and trims/stringifies the id', async () => {
      const pool = poolUpdating();
      db.getPool.mockResolvedValue(pool);

      await expect(recordDjcSynch(' SRP-1 ', true)).resolves.toBe(true);
      await expect(recordDjcSynch(84564621, false)).resolves.toBe(true);
      expect(db.getPool).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls.map(([, params]) => params)).toEqual([['SRP-1', true], ['84564621', false]]);
    });

    test.each([undefined, null, '', '   '])('returns false without touching the DB for id %p', async (id) => {
      const getPool = jest.fn();
      await expect(recordDjcSynch(id, true, { getPool })).resolves.toBe(false);
      expect(getPool).not.toHaveBeenCalled();
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('returns false and logs a warning when the jobcard is not tracked', async () => {
      const getPool = jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }) });

      await expect(recordDjcSynch('SRP-404', true, { getPool })).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('djcsynch: jobcardid=SRP-404 non presente'));
    });

    test('is best-effort on query errors: logs a warning and returns false', async () => {
      const getPool = jest.fn().mockResolvedValue({ query: jest.fn().mockRejectedValue(new Error('connection refused')) });

      await expect(recordDjcSynch('SRP-1', true, { getPool })).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        '[djc] jobcard_sync_activity aggiornamento djcsynch fallito jobcardid=SRP-1: connection refused',
      );
    });

    test('is best-effort on pool creation errors', async () => {
      const getPool = jest.fn().mockRejectedValue(new Error('secret fetch failed'));

      await expect(recordDjcSynch('SRP-1', false, { getPool })).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('secret fetch failed'));
    });

    test('is best-effort when the DB does not answer within timeoutMs', async () => {
      const getPool = jest.fn().mockResolvedValue({ query: jest.fn().mockReturnValue(new Promise(() => {})) });

      await expect(recordDjcSynch('SRP-1', true, { getPool, timeoutMs: 5 })).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('jobcardid=SRP-1: timeout dopo 5 ms'));
    });

    test('clears the timeout once the write completes', async () => {
      jest.useFakeTimers();
      try {
        const getPool = jest.fn().mockResolvedValue(poolUpdating());

        await expect(recordDjcSynch('SRP-1', true, { getPool })).resolves.toBe(true);
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('selectSyncStatus', () => {
    test('selects djcsynch/ack/techreason/businessreason by jobcardid, returning the row', async () => {
      const row = { djcsynch: true, ack: 'OK', techreason: 'SYNCED', businessreason: 'SYNCED - ok' };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };

      await expect(selectSyncStatus(pool, 'SRP-1')).resolves.toBe(row);
      expect(pool.query).toHaveBeenCalledWith(SELECT_SYNC_STATUS_SQL, ['SRP-1']);
      expect(SELECT_SYNC_STATUS_SQL).toMatch(
        /SELECT djcsynch, ack, techreason, businessreason\s+FROM woc\.jobcard_sync_activity\s+WHERE jobcardid = \$1/,
      );
    });

    test('returns null when the jobcard is not tracked', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(selectSyncStatus(pool, 'SRP-404')).resolves.toBeNull();
    });
  });

  describe('getSyncStatus', () => {
    const empty = { djcsynch: null, ack: '', techReason: '', businessReason: '' };
    const poolReturning = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });

    test('maps the row to djcsynch/ack/techReason/businessReason using the injected getPool', async () => {
      const pool = poolReturning([{ djcsynch: true, ack: 'KO', techreason: 'FAILED', businessreason: 'FAILED - DMS down' }]);
      const getPool = jest.fn().mockResolvedValue(pool);

      const result = await getSyncStatus('SRP-1', { getPool });
      expect(result).toEqual({ djcsynch: true, ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS down' });
      expect(Object.keys(result)).toEqual(['djcsynch', 'ack', 'techReason', 'businessReason']);
      expect(pool.query).toHaveBeenCalledWith(SELECT_SYNC_STATUS_SQL, ['SRP-1']);
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('keeps djcsynch false (DGT save failed) instead of turning it into null', async () => {
      const getPool = jest.fn().mockResolvedValue(poolReturning([{ djcsynch: false, ack: null, techreason: null, businessreason: null }]));
      await expect(getSyncStatus('SRP-1', { getPool })).resolves.toEqual({ ...empty, djcsynch: false });
    });

    test('defaults to db.getPool and trims/stringifies the id', async () => {
      const pool = poolReturning([{ ack: 'OK', techreason: 'SYNCED', businessreason: null }]);
      db.getPool.mockResolvedValue(pool);

      await expect(getSyncStatus(' SRP-1 '))
        .resolves.toEqual({ djcsynch: null, ack: 'OK', techReason: 'SYNCED', businessReason: '' });
      await getSyncStatus(84564621);
      expect(db.getPool).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls.map(([, params]) => params)).toEqual([['SRP-1'], ['84564621']]);
    });

    test('returns djcsynch null and empty strings when the outcome has not been populated yet (NULL columns)', async () => {
      const getPool = jest.fn().mockResolvedValue(poolReturning([{
        djcsynch: null, ack: null, techreason: null, businessreason: null,
      }]));
      await expect(getSyncStatus('SRP-1', { getPool })).resolves.toEqual(empty);
    });

    test('returns djcsynch null and empty strings when the jobcard is not tracked', async () => {
      const getPool = jest.fn().mockResolvedValue(poolReturning([]));
      await expect(getSyncStatus('SRP-404', { getPool })).resolves.toEqual(empty);
    });

    test.each([undefined, null, '', '   '])('returns the empty outcome without touching the DB for id %p', async (id) => {
      const getPool = jest.fn();
      await expect(getSyncStatus(id, { getPool })).resolves.toEqual(empty);
      expect(getPool).not.toHaveBeenCalled();
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('is best-effort on query errors: logs a warning and returns the empty outcome', async () => {
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
          .resolves.toEqual({ djcsynch: null, ack: 'OK', techReason: '', businessReason: '' });
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('withSyncStatus', () => {
    const syncStatus = { djcsynch: true, ack: 'OK', techReason: '', businessReason: '' };

    test('inserts the outcome right before jobCardDetail (jobCardDetails response)', () => {
      const jobCardDetail = { roInfo: { jobCardSrpId: 'SRP-1' } };
      const body = {
        dmsAvailable: true, statusCode: 200, success: true, message: 'Job card retrieved successfully', jobCardDetail,
      };

      const result = withSyncStatus(body, syncStatus);
      expect(Object.keys(result)).toEqual([
        'dmsAvailable', 'statusCode', 'success', 'message', 'djcsynch', 'ack', 'techReason', 'businessReason', 'jobCardDetail',
      ]);
      expect(result).toEqual({ ...body, ...syncStatus });
      expect(result.jobCardDetail).toBe(jobCardDetail);
      expect(body).not.toHaveProperty('ack');
      expect(body).not.toHaveProperty('djcsynch');
    });

    test('appends the outcome when there is no jobCardDetail (saveJobcard response)', () => {
      const body = { statusCode: 200, success: true, message: 'Job Card Transaction Successful', jobCardId: 'SRP-1' };

      const result = withSyncStatus(body, syncStatus);
      expect(Object.keys(result)).toEqual([
        'statusCode', 'success', 'message', 'jobCardId', 'djcsynch', 'ack', 'techReason', 'businessReason',
      ]);
      expect(result).toEqual({ ...body, ...syncStatus });
    });

    test.each([undefined, null, 'raw text body', 42, [{ a: 1 }]])('returns non-object body %p unchanged', (body) => {
      expect(withSyncStatus(body, syncStatus)).toBe(body);
    });
  });
});
