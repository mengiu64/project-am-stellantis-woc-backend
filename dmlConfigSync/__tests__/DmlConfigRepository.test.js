'use strict';

const { listEnabledMarkets, upsertDmlConfiguration, getDmlConfiguration } = require('../DmlConfigRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('DmlConfigRepository', () => {
  describe('listEnabledMarkets', () => {
    it('returns the active markets ordered by country/language', async () => {
      const rows = [{ country: 'fr', language: 'fr' }];
      const pool = makePool(async () => ({ rows }));

      const result = await listEnabledMarkets(pool);

      expect(result).toEqual(rows);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('active = TRUE'));
    });

    it('returns an empty array when no market is enabled', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await listEnabledMarkets(pool);

      expect(result).toEqual([]);
    });
  });

  describe('upsertDmlConfiguration', () => {
    it('throws when country is missing', async () => {
      const pool = makePool();
      await expect(upsertDmlConfiguration(pool, { language: 'fr', companyTypes: [], customerTitles: [] }))
        .rejects.toThrow('"country" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when language is missing', async () => {
      const pool = makePool();
      await expect(upsertDmlConfiguration(pool, { country: 'fr', companyTypes: [], customerTitles: [] }))
        .rejects.toThrow('"language" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('upserts with the JSON-stringified arrays and ON CONFLICT clause', async () => {
      const pool = makePool(async () => ({ rows: [] }));
      const companyTypes = [{ code: 'A' }];
      const customerTitles = [{ code: 'B' }];

      await upsertDmlConfiguration(pool, { country: 'fr', language: 'fr', companyTypes, customerTitles });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (country, language)');
      expect(params).toEqual(['fr', 'fr', JSON.stringify(companyTypes), JSON.stringify(customerTitles)]);
    });

    it('defaults non-array companyTypes/customerTitles to empty arrays', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await upsertDmlConfiguration(pool, { country: 'fr', language: 'fr', companyTypes: null, customerTitles: undefined });

      const [, params] = pool.query.mock.calls[0];
      expect(params).toEqual(['fr', 'fr', '[]', '[]']);
    });
  });

  describe('getDmlConfiguration', () => {
    it('throws when country is missing', async () => {
      const pool = makePool();
      await expect(getDmlConfiguration(pool, { language: 'fr' }))
        .rejects.toThrow('"country" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when language is missing', async () => {
      const pool = makePool();
      await expect(getDmlConfiguration(pool, { country: 'fr' }))
        .rejects.toThrow('"language" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns companyTypes/customerTitles/updatedAt when a row is found', async () => {
      const updatedAt = new Date('2026-01-01T03:00:00Z');
      const pool = makePool(async () => ({
        rows: [{ company_types: [{ code: 'A' }], customer_titles: [{ code: 'B' }], updated_at: updatedAt }],
      }));

      const result = await getDmlConfiguration(pool, { country: 'fr', language: 'fr' });

      expect(result).toEqual({ companyTypes: [{ code: 'A' }], customerTitles: [{ code: 'B' }], updatedAt });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPPER(TRIM(country)) = UPPER(TRIM($1))'),
        ['fr', 'fr'],
      );
    });

    it('returns empty arrays and null updatedAt when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getDmlConfiguration(pool, { country: 'de', language: 'de' });

      expect(result).toEqual({ companyTypes: [], customerTitles: [], updatedAt: null });
    });

    it('defensively returns [] when the stored JSONB column is not an array', async () => {
      const pool = makePool(async () => ({
        rows: [{ company_types: null, customer_titles: 'not-an-array', updated_at: null }],
      }));

      const result = await getDmlConfiguration(pool, { country: 'fr', language: 'fr' });

      expect(result).toEqual({ companyTypes: [], customerTitles: [], updatedAt: null });
    });
  });
});
