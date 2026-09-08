'use strict';

const { getCountryIsoCode } = require('../AnagSnowflakesRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('AnagSnowflakesRepository', () => {
  describe('getCountryIsoCode', () => {
    it('throws when market is missing', async () => {
      const pool = makePool();
      await expect(getCountryIsoCode(pool, {}))
        .rejects.toThrow('"market" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns the country ISO code when a row is found', async () => {
      const pool = makePool(async () => ({ rows: [{ cd_dealer_country_iso_code: 'IT' }] }));

      const result = await getCountryIsoCode(pool, { market: '1000' });

      expect(result).toBe('IT');
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM woc.ang_snowflakes'),
        ['1000'],
      );
    });

    it('returns null when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getCountryIsoCode(pool, { market: '9999' });

      expect(result).toBeNull();
    });
  });
});
