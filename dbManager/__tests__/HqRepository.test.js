'use strict';

const mockGetAnagSection = jest.fn();
const mockGetAnagAllocation = jest.fn();
jest.mock('../S3ConfigRepository', () => ({
  S3ConfigRepository: jest.fn().mockImplementation(() => ({
    getAnagSection: mockGetAnagSection,
    getAnagAllocation: mockGetAnagAllocation,
  })),
}));

const {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspection,
  insertVehicleInspection,
  getDisabledOics,
  getEnableSignatureByOics,
  getAddressByOics,
  setMarketEnable,
  setMarketDisable,
  setOicEnable,
  insertDomain,
  setDomain,
  deleteDomain,
  setDomainVisible,
  insertPackage,
  setPackage,
  deletePackage,
  setPackageVisible,
  getPackageList,
  insertAudit,
  searchAudit,
  getAnagSection,
  getAnagAllocation,
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
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND t.fl_is_deleted_flag = 0'));
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

    it('filters on market = $2 (in AND with type/deleted=0) when market is provided', async () => {
      const rows = [
        { id: 1, market: '1000', type: 'EXTERIOR', descr: 'Controllo carrozzeria', visible: 1, deleted: 0 },
      ];
      const pool = makePool(async () => ({ rows }));

      const result = await getVehicleInspection(pool, '1000', 'EXTERIOR');

      expect(result).toBe(rows);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM woc.hq_vehicle_inspection'),
        ['EXTERIOR', '1000'],
      );
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('WHERE type = $1'));
      expect(sql).toEqual(expect.stringContaining('AND deleted = 0'));
      expect(sql).toEqual(expect.stringContaining('AND market = $2'));
      expect(sql).not.toEqual(expect.stringContaining('market IS NULL'));
      expect(sql).toEqual(expect.stringContaining('ORDER BY id'));
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
    ])('filters on market IS NULL OR market = \'\' when market is %s', async (_label, marketValue) => {
      const pool = makePool(async () => ({ rows: [] }));

      await getVehicleInspection(pool, marketValue, 'EXTERIOR');

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("(market IS NULL OR market = '')"),
        ['EXTERIOR'],
      );
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

    it('runs the UPDATE with the given id/value and writes an audit row', async () => {
      const calls = [];
      const pool = makePool(async (sql) => {
        calls.push(sql);
        if (sql.includes('SELECT')) {
          return { rows: [{ type: 'EXTERIOR', descr: 'Test', visible: 1 }] };
        }
        return { rows: [] };
      });

      await setVehicleInspectionVisible(pool, 1, 1, 'jdoe', '1000');

      expect(pool.query).toHaveBeenCalledTimes(3);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SET visible = $2'),
        [1, 1],
      );
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SELECT'),
        [1],
      );
      expect(pool.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO woc.hq_audit'),
        ['jdoe', 'EXTERIOR', '1000', 'update', 'EXTERIOR Test enable :1'],
      );
    });
  });

  describe('deletetVehicleInspection', () => {
    it('throws when id is missing', async () => {
      const pool = makePool();
      await expect(deletetVehicleInspection(pool, undefined, 1))
        .rejects.toThrow('"id" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE with the given id/value and writes an audit row', async () => {
      const pool = makePool(async (sql) => {
        if (sql.includes('SELECT')) {
          return { rows: [{ type: 'EXTERIOR', descr: 'Test', visible: 1 }] };
        }
        return { rows: [] };
      });

      await deletetVehicleInspection(pool, 1, 1, 'jdoe', '1000');

      expect(pool.query).toHaveBeenCalledTimes(3);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SET deleted = $2'),
        [1, 1],
      );
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SELECT'),
        [1],
      );
      expect(pool.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO woc.hq_audit'),
        ['jdoe', 'EXTERIOR', '1000', 'delete', 'deleted 1000 Test '],
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

    it('runs the INSERT with the given market/type/descr and writes an audit row', async () => {
      const pool = makePool(async (sql) => {
        if (sql.includes('RETURNING id')) {
          return { rows: [{ id: 42 }] };
        }
        if (sql.includes('SELECT')) {
          return { rows: [{ type: 'EXTERIOR', descr: 'Controllo carrozzeria', visible: 1 }] };
        }
        return { rows: [] };
      });

      await insertVehicleInspection(pool, '1000', 'EXTERIOR', 'Controllo carrozzeria', 'jdoe', '1000');

      expect(pool.query).toHaveBeenCalledTimes(3);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO woc.hq_vehicle_inspection'),
        ['1000', 'EXTERIOR', 'Controllo carrozzeria'],
      );
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SELECT'),
        [42],
      );
      expect(pool.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO woc.hq_audit'),
        ['jdoe', 'EXTERIOR', '1000', 'insert', 'EXTERIOR Controllo carrozzeria visible: 1'],
      );
    });
  });

  describe('getDisabledOics', () => {
    it('returns an empty set without querying when pairs is missing/empty', async () => {
      const pool = makePool();

      expect(await getDisabledOics(pool, [])).toEqual(new Set());
      expect(await getDisabledOics(pool, undefined)).toEqual(new Set());
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns a set of "market|oic" keys explicitly disabled (enablewoc = 0)', async () => {
      const pool = makePool(async () => ({
        rows: [{ market: '1000', oic: '00010925' }],
      }));

      const result = await getDisabledOics(pool, [
        { market: '1000', oic: '00010925' },
        { market: '1000', oic: '00007584' },
      ]);

      expect(result).toEqual(new Set(['1000|00010925']));
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM unnest($1::varchar[], $2::varchar[])'),
        [['1000', '1000'], ['00010925', '00007584']],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('WHERE hae.enablewoc = 0'));
    });

    it('returns an empty set when no pair is explicitly disabled', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getDisabledOics(pool, [{ market: '1000', oic: '00010925' }]);

      expect(result).toEqual(new Set());
    });
  });

  describe('getEnableSignatureByOics', () => {
    it('returns an empty map without querying when pairs is missing/empty', async () => {
      const pool = makePool();

      expect(await getEnableSignatureByOics(pool, [])).toEqual(new Map());
      expect(await getEnableSignatureByOics(pool, undefined)).toEqual(new Map());
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns a map "market|oic" -> boolean letto da hae.enablesignature (1/0)', async () => {
      const pool = makePool(async () => ({
        rows: [
          { market: '1000', oic: '00010925', enablesignature: 1 },
          { market: '1000', oic: '00007584', enablesignature: 0 },
        ],
      }));

      const result = await getEnableSignatureByOics(pool, [
        { market: '1000', oic: '00010925' },
        { market: '1000', oic: '00007584' },
      ]);

      expect(result).toEqual(new Map([
        ['1000|00010925', true],
        ['1000|00007584', false],
      ]));
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM unnest($1::varchar[], $2::varchar[])'),
        [['1000', '1000'], ['00010925', '00007584']],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('JOIN woc.hq_application_enabling'));
    });

    it('returns an empty map when no pair has a matching row (default: feaEnabled = false lato chiamante)', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getEnableSignatureByOics(pool, [{ market: '1000', oic: '00010925' }]);

      expect(result).toEqual(new Map());
    });
  });

  describe('getAddressByOics', () => {
    it('returns an empty map without querying when oics is missing/empty', async () => {
      const pool = makePool();

      expect(await getAddressByOics(pool, { oics: [] })).toEqual(new Map());
      expect(await getAddressByOics(pool, {})).toEqual(new Map());
      expect(await getAddressByOics(pool, undefined)).toEqual(new Map());
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns a map oic -> {address, zipcode, city} letto da woc.addr_snowflakes', async () => {
      const pool = makePool(async () => ({
        rows: [
          { oic: '00010925', address: 'VIA ROMA 1', zipcode: '00100', city: 'ROMA' },
          { oic: '00007584', address: 'VIA AMBRA 41-45', zipcode: '58100', city: 'GROSSETO' },
        ],
      }));

      const result = await getAddressByOics(pool, { oics: ['00010925', '00007584'] });

      expect(result).toEqual(new Map([
        ['00010925', { address: 'VIA ROMA 1', zipcode: '00100', city: 'ROMA' }],
        ['00007584', { address: 'VIA AMBRA 41-45', zipcode: '58100', city: 'GROSSETO' }],
      ]));
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('JOIN woc.addr_snowflakes'),
        [['00010925', '00007584']],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('SELECT DISTINCT'));
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('s.cd_paired_oic_code = ANY($1::varchar[])'));
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
    });

    it('normalizes missing address fields to null and returns an empty map when there are no rows', async () => {
      const pool = makePool(async () => ({ rows: [{ oic: '00010925', address: null, zipcode: undefined, city: null }] }));

      const result = await getAddressByOics(pool, { oics: ['00010925'] });

      expect(result).toEqual(new Map([
        ['00010925', { address: null, zipcode: null, city: null }],
      ]));

      const poolNoRows = makePool(async () => ({ rows: [] }));
      expect(await getAddressByOics(poolNoRows, { oics: ['00099999'] })).toEqual(new Map());
    });
  });

  describe('setMarketEnable', () => {
    it('upserts hq_pk_market (deleted = 0) and cascades deleted = 1 on hq_pk_oic', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setMarketEnable(pool, '1000');

      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO woc.hq_pk_market'),
        ['1000'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('ON CONFLICT (market) DO UPDATE SET deleted = 0'));
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE woc.hq_pk_oic SET deleted = 1'),
        ['1000'],
      );
    });
  });

  describe('setMarketDisable', () => {
    it('upserts hq_pk_market (deleted = 1) and re-enables (deleted = 0) on hq_pk_oic', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setMarketDisable(pool, '1000');

      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO woc.hq_pk_market'),
        ['1000'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('ON CONFLICT (market) DO UPDATE SET deleted = 1'));
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE woc.hq_pk_oic SET deleted = 0'),
        ['1000'],
      );
    });
  });

  describe('setOicEnable', () => {
    it('throws when oic is missing', async () => {
      const pool = makePool();
      await expect(setOicEnable(pool, '1000', undefined))
        .rejects.toThrow('"oic" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('upserts hq_pk_oic (deleted = 0) on the (market, oic) PK', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setOicEnable(pool, '1000', '00006821');

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO woc.hq_pk_oic'),
        ['1000', '00006821'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('ON CONFLICT (market, oic) DO UPDATE SET deleted = 0'));
    });
  });

  describe('insertDomain', () => {
    it('inserts the domain and returns the generated iddomain', async () => {
      const pool = makePool(async () => ({ rows: [{ iddomain: 42 }] }));

      const result = await insertDomain(pool, '1000', '00006821', 'Meccanica');

      expect(result).toBe(42);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO woc.hq_pk_domain'),
        ['1000', '00006821', 'Meccanica'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('RETURNING iddomain'));
    });
  });

  describe('setDomain', () => {
    it('throws when iddomain is missing', async () => {
      const pool = makePool();
      await expect(setDomain(pool, '1000', undefined, 'Meccanica'))
        .rejects.toThrow('"iddomain" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE with the given market/iddomain/descr', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setDomain(pool, '1000', 42, 'Meccanica');

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE woc.hq_pk_domain'),
        ['1000', 42, 'Meccanica'],
      );
    });
  });

  describe('deleteDomain', () => {
    it('throws when iddomain is missing', async () => {
      const pool = makePool();
      await expect(deleteDomain(pool, '1000', undefined))
        .rejects.toThrow('"iddomain" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE SET deleted = 1 with the given market/iddomain', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await deleteDomain(pool, '1000', 42);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE woc.hq_pk_domain'),
        ['1000', 42],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('SET deleted = 1'));
    });
  });

  describe('setDomainVisible', () => {
    it('throws when iddomain is missing', async () => {
      const pool = makePool();
      await expect(setDomainVisible(pool, undefined, 1))
        .rejects.toThrow('"iddomain" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE SET visible = value with the given iddomain', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setDomainVisible(pool, 7, 0);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE woc.hq_pk_domain'),
        [7, 0],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('SET visible = $2'));
    });
  });

  describe('insertPackage', () => {
    it('throws when iddomain is missing', async () => {
      const pool = makePool();
      await expect(insertPackage(pool, '1000', '00006821', undefined, 'Tagliando', 60, 100.5))
        .rejects.toThrow('"iddomain" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('inserts the package and returns the generated idpackage', async () => {
      const pool = makePool(async () => ({ rows: [{ idpackage: 7 }] }));

      const result = await insertPackage(pool, '1000', '00006821', 42, 'Tagliando', 60, 100.5);

      expect(result).toBe(7);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO woc.hq_pk_packages'),
        ['1000', '00006821', 42, 'Tagliando', 60, 100.5],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('RETURNING idpackage'));
    });
  });

  describe('setPackage', () => {
    it('throws when idpackage is missing', async () => {
      const pool = makePool();
      await expect(setPackage(pool, undefined, 42, 'Tagliando', 60, 100.5))
        .rejects.toThrow('"idpackage" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when iddomain is missing', async () => {
      const pool = makePool();
      await expect(setPackage(pool, 7, undefined, 'Tagliando', 60, 100.5))
        .rejects.toThrow('"iddomain" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE with the given idpackage/iddomain/descr/timeop/pricewithvat', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setPackage(pool, 7, 42, 'Tagliando', 60, 100.5);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE woc.hq_pk_packages'),
        [7, 42, 'Tagliando', 60, 100.5],
      );
    });
  });

  describe('deletePackage', () => {
    it('throws when idpackage is missing', async () => {
      const pool = makePool();
      await expect(deletePackage(pool, undefined))
        .rejects.toThrow('"idpackage" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the DELETE with the given idpackage', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await deletePackage(pool, 7);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM woc.hq_pk_packages'),
        [7],
      );
    });
  });

  describe('setPackageVisible', () => {
    it('throws when idpackage is missing', async () => {
      const pool = makePool();
      await expect(setPackageVisible(pool, undefined, 1))
        .rejects.toThrow('"idpackage" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the UPDATE SET visible = value with the given idpackage', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await setPackageVisible(pool, 7, 0);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE woc.hq_pk_packages'),
        [7, 0],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('SET visible = $2'));
    });
  });

  describe('getPackageList', () => {
    it('joins on hq_pk_oic and filters dom/pk on oic = $2 when oic is provided', async () => {
      const pool = makePool(async () => ({
        rows: [
          {
            market: '1000',
            oic: '00006821',
            iddomain: 3,
            domaindescr: 'Meccanica',
            domvisible: 1,
            idpackage: 7,
            packagedescr: 'Tagliando',
            timeop: 60,
            pricewithvat: 100.5,
            pkvisible: 1,
          },
        ],
      }));

      const result = await getPackageList(pool, '1000', '00006821');

      expect(result).toEqual([
        {
          market: '1000',
          oic: '00006821',
          iddomain: 3,
          domainDescr: 'Meccanica',
          domVisible: 1,
          idpackage: 7,
          packageDescr: 'Tagliando',
          timeop: 60,
          pricewithvat: 100.5,
          pkVisible: 1,
        },
      ]);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('JOIN woc.hq_pk_oic oi ON oi.market = mk.market AND oi.oic = $2 AND oi.deleted = 0'),
        ['1000', '00006821'],
      );
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('FROM woc.hq_pk_market mk'));
      expect(sql).toEqual(expect.stringContaining('LEFT JOIN woc.hq_pk_domain dom ON dom.market = mk.market AND dom.oic = oi.oic AND dom.deleted = 0'));
      expect(sql).toEqual(expect.stringContaining('LEFT JOIN woc.hq_pk_packages pk ON pk.market = mk.market AND pk.oic = oi.oic AND pk.iddomain = dom.iddomain'));
      expect(sql).toEqual(expect.stringContaining('dom.visible AS domvisible'));
      expect(sql).toEqual(expect.stringContaining('pk.visible AS pkvisible'));
      expect(sql).toEqual(expect.stringContaining("($1 IS NOT NULL AND $1 <> '' AND mk.market = $1)"));
    });

    it('does not join hq_pk_oic and filters dom/pk on oic IS NULL (market-level configuration) when oic is null/undefined', async () => {
      const pool = makePool(async () => ({
        rows: [
          {
            market: '1000',
            oic: null,
            iddomain: 9,
            domaindescr: 'test1',
            domvisible: 1,
            idpackage: null,
            packagedescr: null,
            timeop: null,
            pricewithvat: null,
            pkvisible: null,
          },
        ],
      }));

      const result = await getPackageList(pool, '1000', undefined);

      expect(result).toEqual([
        {
          market: '1000', oic: null, iddomain: 9, domainDescr: 'test1', domVisible: 1, idpackage: null, packageDescr: null, timeop: null, pricewithvat: null, pkVisible: null,
        },
      ]);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT mk.market, NULL::varchar AS oic'),
        ['1000'],
      );
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('LEFT JOIN woc.hq_pk_domain dom ON dom.market = mk.market AND dom.oic IS NULL AND dom.deleted = 0'));
      expect(sql).toEqual(expect.stringContaining('LEFT JOIN woc.hq_pk_packages pk ON pk.market = mk.market AND pk.oic IS NULL AND pk.iddomain = dom.iddomain'));
      expect(sql).not.toEqual(expect.stringContaining('hq_pk_oic'));
    });

    it('returns an empty array when no rows are found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPackageList(pool, '1000', '00006821');

      expect(result).toEqual([]);
    });
  });

  describe('insertAudit', () => {
    it('throws when username is missing', async () => {
      const pool = makePool();
      await expect(insertAudit(pool, undefined, 'domain', '1000', 'create', 'Nuovo dominio'))
        .rejects.toThrow('"username" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when section is missing', async () => {
      const pool = makePool();
      await expect(insertAudit(pool, 'mario.rossi', undefined, '1000', 'create', 'Nuovo dominio'))
        .rejects.toThrow('"section" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when actiontype is missing', async () => {
      const pool = makePool();
      await expect(insertAudit(pool, 'mario.rossi', 'domain', '1000', undefined, 'Nuovo dominio'))
        .rejects.toThrow('"actiontype" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('runs the INSERT with CURRENT_DATE and the given fields', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await insertAudit(pool, 'mario.rossi', 'domain', '1000', 'create', 'Nuovo dominio');

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO woc.hq_audit'),
        ['mario.rossi', 'domain', '1000', 'create', 'Nuovo dominio'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('CURRENT_DATE'));
    });
  });

  describe('searchAudit', () => {
    it('runs a query with no WHERE clause when no filters are given', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await searchAudit(pool, undefined, undefined, undefined, undefined, undefined, undefined);

      expect(result).toEqual([]);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.not.stringContaining('WHERE'),
        [],
      );
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('LIMIT 100'));
    });

    it('builds a dynamic WHERE clause including only the provided filters', async () => {
      const rows = [{
        id: 1, username: 'mario.rossi', creationdate: '2024-01-01', section: 'domain', market: '1000', actiontype: 'create', descr: 'Nuovo dominio',
      }];
      const pool = makePool(async () => ({ rows }));

      const result = await searchAudit(pool, '1000', 'domain', '2024-01-01', '2024-12-31', 'create', 'mario.rossi');

      expect(result).toBe(rows);
      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('market = $1'));
      expect(sql).toEqual(expect.stringContaining('section = $2'));
      expect(sql).toEqual(expect.stringContaining('creationdate >= $3'));
      expect(sql).toEqual(expect.stringContaining('creationdate <= $4'));
      expect(sql).toEqual(expect.stringContaining('actiontype = $5'));
      expect(sql).toEqual(expect.stringContaining('UPPER(username) LIKE UPPER($6)'));
      expect(params).toEqual(['1000', 'domain', '2024-01-01', '2024-12-31', 'create', '%mario.rossi%']);
    });

    it('builds a WHERE clause with only market and actiontype when the other filters are missing', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await searchAudit(pool, '1000', undefined, undefined, undefined, 'create');

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('market = $1'));
      expect(sql).toEqual(expect.stringContaining('actiontype = $2'));
      expect(params).toEqual(['1000', 'create']);
    });

    it('builds a WHERE clause with only username (case-insensitive partial match) when it is the only filter given', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await searchAudit(pool, undefined, undefined, undefined, undefined, undefined, 'mario.rossi');

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('UPPER(username) LIKE UPPER($1)'));
      expect(params).toEqual(['%mario.rossi%']);
    });

    it('does not apply LIMIT 100 when at least one filter is given', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await searchAudit(pool, '1000');

      const [sql] = pool.query.mock.calls[0];
      expect(sql).not.toEqual(expect.stringContaining('LIMIT'));
    });
  });

  describe('getAnagSection', () => {
    it('delegates to S3ConfigRepository.getAnagSection', async () => {
      const sections = [{ section: 'domain' }, { section: 'conditions' }];
      mockGetAnagSection.mockResolvedValue(sections);

      const result = await getAnagSection();

      expect(mockGetAnagSection).toHaveBeenCalledWith();
      expect(result).toBe(sections);
    });
  });

  describe('getAnagAllocation', () => {
    it('delegates to S3ConfigRepository.getAnagAllocation', async () => {
      const allocations = [{ type: 'create' }, { type: 'update' }];
      mockGetAnagAllocation.mockResolvedValue(allocations);

      const result = await getAnagAllocation();

      expect(mockGetAnagAllocation).toHaveBeenCalledWith();
      expect(result).toBe(allocations);
    });
  });
});
