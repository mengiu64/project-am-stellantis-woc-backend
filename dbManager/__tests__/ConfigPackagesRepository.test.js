'use strict';

const { getConfigPackages } = require('../ConfigPackagesRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('ConfigPackagesRepository', () => {
  describe('getConfigPackages', () => {
    it('throws when pkwstouse is missing', async () => {
      const pool = makePool();
      await expect(getConfigPackages(pool, {}))
        .rejects.toThrow('"pkwstouse" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('groups rows by department', async () => {
      const pool = makePool(async () => ({
        rows: [
          { department: 'BODY', pkcod: '7210E221' },
          { department: 'BODY', pkcod: '7015A041' },
        ],
      }));

      const result = await getConfigPackages(pool, { pkwstouse: 'eper' });

      expect(result).toEqual({ BODY: ['7210E221', '7015A041'] });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPPER(TRIM(pkwstouse)) = UPPER(TRIM($1))'),
        ['eper'],
      );
    });

    it('groups rows across multiple departments', async () => {
      const pool = makePool(async () => ({
        rows: [
          { department: 'ACCESSORIES', pkcod: '95R04A' },
          { department: 'MECHANICH', pkcod: '42001A' },
          { department: 'MECHANICH', pkcod: '42055A' },
        ],
      }));

      const result = await getConfigPackages(pool, { pkwstouse: 'docsoa' });

      expect(result).toEqual({
        ACCESSORIES: ['95R04A'],
        MECHANICH: ['42001A', '42055A'],
      });
    });

    it('returns an empty object when no rows are configured for pkwstouse', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getConfigPackages(pool, { pkwstouse: 'unknown' });

      expect(result).toEqual({});
    });

    it('matches pkwstouse regardless of case/whitespace (query relies on UPPER/TRIM in SQL)', async () => {
      const pool = makePool(async () => ({ rows: [{ department: 'BODY', pkcod: 'X1' }] }));

      const result = await getConfigPackages(pool, { pkwstouse: ' EPER ' });

      expect(result).toEqual({ BODY: ['X1'] });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPPER(TRIM(pkwstouse)) = UPPER(TRIM($1))'),
        [' EPER '],
      );
    });
  });
});
