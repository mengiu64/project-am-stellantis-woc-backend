'use strict';

const { getEnablingConfiguration, setEnablingConfiguration, getDisabledOics, getAddressByOics } = require('../HqRepository');

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
});
