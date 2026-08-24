'use strict';

const { listFunctions } = require('../ListFunctionsRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('ListFunctionsRepository', () => {
  describe('listFunctions', () => {
    it('queries woc.listfunctions and returns the raw rows', async () => {
      const pool = makePool(async () => ({
        rows: [{ function: 'FCT0040' }, { function: 'FCT0050' }],
      }));

      const result = await listFunctions(pool);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM woc.listfunctions'),
      );
      expect(result).toEqual([{ function: 'FCT0040' }, { function: 'FCT0050' }]);
    });

    it('returns an empty array when the table has no rows', async () => {
      const pool = makePool(async () => ({ rows: [] }));
      const result = await listFunctions(pool);
      expect(result).toEqual([]);
    });
  });
});
