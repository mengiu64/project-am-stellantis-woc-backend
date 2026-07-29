'use strict';

const { listFavorites, toggleFavorite } = require('../FavoriteRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('FavoriteRepository', () => {
  describe('listFavorites', () => {
    it('throws when username is missing', async () => {
      const pool = makePool();
      await expect(listFavorites(pool, { vin: 'VF3CABHW6GT204366' }))
        .rejects.toThrow('"username" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when vin is missing', async () => {
      const pool = makePool();
      await expect(listFavorites(pool, { username: '0062230.d001' }))
        .rejects.toThrow('"vin" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('queries pkfavorite filtered by username/vin and maps rows', async () => {
      const createdAt = new Date('2026-01-01T09:00:00Z');
      const pool = makePool(async () => ({
        rows: [
          { package_code: 'FORFAIT-A', created_at: createdAt },
          { package_code: 'FORFAIT-B', created_at: createdAt },
        ],
      }));

      const result = await listFavorites(pool, { username: '0062230.d001', vin: 'VF3CABHW6GT204366' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT package_code, created_at'),
        ['0062230.d001', 'VF3CABHW6GT204366'],
      );
      expect(result).toEqual([
        { packageCode: 'FORFAIT-A', createdAt },
        { packageCode: 'FORFAIT-B', createdAt },
      ]);
    });

    it('returns an empty array when no favorites exist', async () => {
      const pool = makePool(async () => ({ rows: [] }));
      const result = await listFavorites(pool, { username: '0062230.d001', vin: 'VF3CABHW6GT204366' });
      expect(result).toEqual([]);
    });
  });

  describe('toggleFavorite', () => {
    it('throws when username is missing', async () => {
      const pool = makePool();
      await expect(toggleFavorite(pool, { vin: 'VF3', packageCode: 'X' }))
        .rejects.toThrow('"username" is required');
    });

    it('throws when vin is missing', async () => {
      const pool = makePool();
      await expect(toggleFavorite(pool, { username: 'u', packageCode: 'X' }))
        .rejects.toThrow('"vin" is required');
    });

    it('throws when packageCode is missing', async () => {
      const pool = makePool();
      await expect(toggleFavorite(pool, { username: 'u', vin: 'VF3' }))
        .rejects.toThrow('"packageCode" is required');
    });

    it('removes the favorite when a row was deleted', async () => {
      const pool = makePool(async (sql) => {
        if (sql.includes('DELETE')) return { rowCount: 1, rows: [{ id: 7 }] };
        throw new Error('INSERT should not be called when a row was deleted');
      });

      const result = await toggleFavorite(pool, {
        username: '0062230.d001',
        vin: 'VF3CABHW6GT204366',
        packageCode: 'FORFAIT-A',
      });

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query.mock.calls[0][0]).toContain('DELETE FROM pkfavorite');
      expect(pool.query.mock.calls[0][1]).toEqual(['0062230.d001', 'VF3CABHW6GT204366', 'FORFAIT-A']);
      expect(result).toEqual({ action: 'removed', packageCode: 'FORFAIT-A' });
    });

    it('adds the favorite when no row was deleted (does not exist yet)', async () => {
      const createdAt = new Date('2026-01-01T09:00:00Z');
      const pool = makePool(async (sql) => {
        if (sql.includes('DELETE')) return { rowCount: 0, rows: [] };
        if (sql.includes('INSERT')) return { rows: [{ id: 42, created_at: createdAt }] };
        throw new Error('unexpected query');
      });

      const result = await toggleFavorite(pool, {
        username: '0062230.d001',
        vin: 'VF3CABHW6GT204366',
        packageCode: 'FORFAIT-A',
      });

      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[1][0]).toContain('INSERT INTO pkfavorite');
      expect(pool.query.mock.calls[1][1]).toEqual(['0062230.d001', 'VF3CABHW6GT204366', 'FORFAIT-A']);
      expect(result).toEqual({ action: 'added', packageCode: 'FORFAIT-A', id: 42, createdAt });
    });
  });
});
