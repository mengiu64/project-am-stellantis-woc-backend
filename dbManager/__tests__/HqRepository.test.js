'use strict';

const {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspectionVisible,
  insertVehicleInspection,
} = require('../HqRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('HqRepository', () => {
  describe('getEnablingConfiguration', () => {
    it('throws when codmarket is missing', async () => {
      const pool = makePool();
      await expect(getEnablingConfiguration(pool, undefined))
        .rejects.toThrow('"codmarket" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns the mapped rows when found', async () => {
      const pool = makePool(async () => ({
        rows: [
          {
            gn_site_name: 'BRANDINI S.P.A.',
            cd_paired_oic_code: '00006821',
            gn_address_1: 'VIA COPERNICO 123',
            gn_legal_entity: '0073741',
            enablewoc: 1,
            enablesignature: 0,
          },
        ],
      }));

      const result = await getEnablingConfiguration(pool, '1000');

      expect(result).toEqual([
        {
          siteName: 'BRANDINI S.P.A.',
          oic: '00006821',
          address: 'VIA COPERNICO 123',
          legalEntity: '0073741',
          enableWOC: 1,
          enableSignature: 0,
        },
      ]);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM woc.ang_snowflakes t'),
        ['1000'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('JOIN woc.addr_snowflakes t2'));
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('LEFT JOIN woc.hq_application_enabling hae'));
    });

    it('returns an empty array when no rows are found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getEnablingConfiguration(pool, '9999');

      expect(result).toEqual([]);
    });
  });

  describe('setEnablingConfiguration', () => {
    it('throws when codmarket is missing', async () => {
      const pool = makePool();
      await expect(setEnablingConfiguration(pool, undefined, '00006821', 1, 0))
        .rejects.toThrow('"codmarket" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when oic is missing', async () => {
      const pool = makePool();
      await expect(setEnablingConfiguration(pool, '1000', undefined, 1, 0))
        .rejects.toThrow('"oic" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('inserts the record when it does not exist yet', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setEnablingConfiguration(pool, '1000', '00006821', 1, 0);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO woc.hq_application_enabling'),
        ['1000', '00006821', 1, 0],
      );
    });

    it('falls back to UPDATE when the record already exists (unique violation)', async () => {
      const uniqueViolationErr = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      const pool = makePool()
      pool.query = jest.fn()
        .mockRejectedValueOnce(uniqueViolationErr)
        .mockResolvedValueOnce({ rows: [] });

      await setEnablingConfiguration(pool, '1000', '00006821', 1, 1);

      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO woc.hq_application_enabling'),
        ['1000', '00006821', 1, 1],
      );
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE woc.hq_application_enabling'),
        ['1000', '00006821', 1, 1],
      );
    });

    it('rethrows errors that are not a unique violation', async () => {
      const otherErr = Object.assign(new Error('connection lost'), { code: '08006' });
      const pool = makePool(async () => { throw otherErr; });

      await expect(setEnablingConfiguration(pool, '1000', '00006821', 1, 0))
        .rejects.toThrow('connection lost');
      expect(pool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('getVehicleInspection', () => {
    it('throws when type is missing', async () => {
      const pool = makePool();
      await expect(getVehicleInspection(pool, '1000', undefined))
        .rejects.toThrow('"type" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns the rows from the query', async () => {
      const rows = [
        { id: 1, market: '1000', type: 'EXTERIOR', descr: 'Controllo carrozzeria', visible: 1, deleted: 0 },
      ];
      const pool = makePool(async () => ({ rows }));

      const result = await getVehicleInspection(pool, '1000', 'EXTERIOR');

      expect(result).toBe(rows);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM woc.hq_vehicle_inspection t'),
        ['1000', 'EXTERIOR'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('PARTITION BY descr, type'));
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('ORDER BY id'));
    });

    it('returns an empty array when no rows are found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getVehicleInspection(pool, '1000', 'EXTERIOR');

      expect(result).toEqual([]);
    });
  });

  describe('setVehicleInspectionVisible', () => {
    it('throws when id is missing', async () => {
      const pool = makePool();
      await expect(setVehicleInspectionVisible(pool, undefined, 1))
        .rejects.toThrow('"id" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE with the given id/value', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setVehicleInspectionVisible(pool, 1, 1);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET visible = $2'),
        [1, 1],
      );
    });
  });

  describe('deletetVehicleInspectionVisible', () => {
    it('throws when id is missing', async () => {
      const pool = makePool();
      await expect(deletetVehicleInspectionVisible(pool, undefined, 1))
        .rejects.toThrow('"id" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE with the given id/value', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await deletetVehicleInspectionVisible(pool, 1, 1);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET deleted = $2'),
        [1, 1],
      );
    });
  });

  describe('insertVehicleInspection', () => {
    it('throws when type is missing', async () => {
      const pool = makePool();
      await expect(insertVehicleInspection(pool, '1000', undefined, 'Controllo carrozzeria'))
        .rejects.toThrow('"type" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when descr is missing', async () => {
      const pool = makePool();
      await expect(insertVehicleInspection(pool, '1000', 'EXTERIOR', undefined))
        .rejects.toThrow('"descr" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the INSERT with the given market/type/descr', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await insertVehicleInspection(pool, '1000', 'EXTERIOR', 'Controllo carrozzeria');

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO woc.hq_vehicle_inspection'),
        ['1000', 'EXTERIOR', 'Controllo carrozzeria'],
      );
    });
  });
});
