'use strict';

const { getPkwstouse } = require('../PkConfigRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('PkConfigRepository', () => {
  describe('getPkwstouse', () => {
    it('throws when codbrand is missing', async () => {
      const pool = makePool();
      await expect(getPkwstouse(pool, { codmarket: 'IT' }))
        .rejects.toThrow('"codbrand" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns the application when an exact (codmarket, codbrand) match is found', async () => {
      const pool = makePool(async () => ({ rows: [{ application: 'eper' }] }));

      const result = await getPkwstouse(pool, { codmarket: 'IT', codbrand: 'FIAT' });

      expect(result).toBe('eper');
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE codmarket = $1'),
        ['IT', 'FIAT'],
      );
    });

    it('falls back to codmarket IS NULL when no exact match is found', async () => {
      const pool = makePool(async (sql) => {
        if (sql.includes('codmarket = $1')) return { rows: [] };
        if (sql.includes('codmarket IS NULL')) return { rows: [{ application: 'docsoa' }] };
        throw new Error('unexpected query');
      });

      const result = await getPkwstouse(pool, { codmarket: 'IT', codbrand: 'JEEP' });

      expect(result).toBe('docsoa');
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[1][0]).toContain('codmarket IS NULL');
      expect(pool.query.mock.calls[1][1]).toEqual(['JEEP']);
    });

    it('queries directly with codmarket IS NULL when codmarket is not provided', async () => {
      const pool = makePool(async () => ({ rows: [{ application: 'menupricing' }] }));

      const result = await getPkwstouse(pool, { codmarket: null, codbrand: 'FIAT' });

      expect(result).toBe('menupricing');
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('codmarket IS NULL'),
        ['FIAT'],
      );
    });

    it('returns null when neither the exact match nor the fallback are found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPkwstouse(pool, { codmarket: 'IT', codbrand: 'UNKNOWN' });

      expect(result).toBeNull();
      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });
});
