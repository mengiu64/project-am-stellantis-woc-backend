'use strict';

const {
  listEnabledDealers,
  upsertDmsSettings,
  getDmsSettings,
  registerDealer,
} = require('../DmsSettingsRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('DmsSettingsRepository', () => {
  describe('listEnabledDealers', () => {
    it('returns the active country/brand/dealer combinations ordered', async () => {
      const rows = [{ country: 'it', brand: 'FT', dealer: '0073741' }];
      const pool = makePool(async () => ({ rows }));

      const result = await listEnabledDealers(pool);

      expect(result).toEqual(rows);
      expect(pool.query).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('active = TRUE'),
          statement_timeout: 5000,
        }),
      );
    });

    it('returns an empty array when no dealer is enabled', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await listEnabledDealers(pool);

      expect(result).toEqual([]);
    });
  });

  describe('upsertDmsSettings', () => {
    it('throws when country is missing', async () => {
      const pool = makePool();
      await expect(upsertDmsSettings(pool, { brand: 'FT', dealer: '0073741', settings: { success: true, data: [] } }))
        .rejects.toThrow('"country" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when brand is missing', async () => {
      const pool = makePool();
      await expect(upsertDmsSettings(pool, { country: 'it', dealer: '0073741', settings: { success: true, data: [] } }))
        .rejects.toThrow('"brand" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when dealer is missing', async () => {
      const pool = makePool();
      await expect(upsertDmsSettings(pool, { country: 'it', brand: 'FT', settings: { success: true, data: [] } }))
        .rejects.toThrow('"dealer" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('upserts with success/data split into separate columns and ON CONFLICT clause', async () => {
      const pool = makePool(async () => ({ rows: [] }));
      const settings = { success: true, data: [{ key: 'isDML', value: 'TRUE', format: 'boolean' }] };

      await upsertDmsSettings(pool, { country: 'it', brand: 'FT', dealer: '0073741', settings });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [{ text: sql, values: params, statement_timeout: timeout }] = pool.query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (country, brand, dealer)');
      expect(params).toEqual(['it', 'FT', '0073741', true, JSON.stringify(settings.data)]);
      expect(timeout).toBe(5000);
    });

    it('defaults a non-object/failed settings value to success=false, data=[]', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await upsertDmsSettings(pool, { country: 'it', brand: 'FT', dealer: '0073741', settings: null });

      const [{ values: params }] = pool.query.mock.calls[0];
      expect(params).toEqual(['it', 'FT', '0073741', false, '[]']);
    });

    it('defaults success=false, data=[] when the upstream response has success=false (e.g. normalized 404)', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await upsertDmsSettings(pool, { country: 'it', brand: 'FT', dealer: '0073741', settings: { success: false, data: [] } });

      const [{ values: params }] = pool.query.mock.calls[0];
      expect(params).toEqual(['it', 'FT', '0073741', false, '[]']);
    });
  });

  describe('getDmsSettings', () => {
    it('throws when country is missing', async () => {
      const pool = makePool();
      await expect(getDmsSettings(pool, { brand: 'FT', dealer: '0073741' }))
        .rejects.toThrow('"country" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when brand is missing', async () => {
      const pool = makePool();
      await expect(getDmsSettings(pool, { country: 'it', dealer: '0073741' }))
        .rejects.toThrow('"brand" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when dealer is missing', async () => {
      const pool = makePool();
      await expect(getDmsSettings(pool, { country: 'it', brand: 'FT' }))
        .rejects.toThrow('"dealer" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('reconstructs the {success, data} response when a row is found', async () => {
      const data = [{ key: 'isDML', value: 'TRUE', format: 'boolean' }];
      const pool = makePool(async () => ({ rows: [{ success: true, data, updated_at: new Date('2026-01-01T03:00:00Z') }] }));

      const result = await getDmsSettings(pool, { country: 'it', brand: 'FT', dealer: '0073741' });

      expect(result).toEqual({ success: true, data });
      expect(pool.query).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('UPPER(TRIM(country)) = UPPER(TRIM($1))'),
          values: ['it', 'FT', '0073741'],
          statement_timeout: 5000,
        }),
      );
    });

    it('returns null when no row is found (never seen combination)', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getDmsSettings(pool, { country: 'it', brand: 'FT', dealer: '0073741' });

      expect(result).toBeNull();
    });

    it('defensively normalizes to data=[] when the stored JSONB column is not an array', async () => {
      const pool = makePool(async () => ({ rows: [{ success: true, data: 'not-an-array', updated_at: null }] }));

      const result = await getDmsSettings(pool, { country: 'it', brand: 'FT', dealer: '0073741' });

      expect(result).toEqual({ success: true, data: [] });
    });
  });

  describe('registerDealer', () => {
    it('inserts the combination with ON CONFLICT DO NOTHING', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await registerDealer(pool, { country: 'it', brand: 'FT', dealer: '0073741' });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [{ text: sql, values: params, statement_timeout: timeout }] = pool.query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (country, brand, dealer) DO NOTHING');
      expect(params).toEqual(['it', 'FT', '0073741']);
      expect(timeout).toBe(5000);
    });

    it('does nothing (no query) when country/brand/dealer is missing', async () => {
      const pool = makePool();

      await registerDealer(pool, { country: 'it', brand: 'FT', dealer: undefined });
      await registerDealer(pool, { country: '', brand: 'FT', dealer: '0073741' });
      await registerDealer(pool, {});

      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});
