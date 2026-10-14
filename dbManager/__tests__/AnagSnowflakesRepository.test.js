'use strict';

const { getCountryIsoCode, getPhysicalSiteAndSincom, getPhysicalSiteAndPdvId, getBrandsByOics, getMarkets } = require('../AnagSnowflakesRepository');

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
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
    });

    it('returns null when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getCountryIsoCode(pool, { market: '9999' });

      expect(result).toBeNull();
    });
  });

  describe('getPhysicalSiteAndSincom', () => {
    it('throws when mainSincom is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndSincom(pool, { market: '1000', brand: 'FT' }))
        .rejects.toThrow('"mainSincom" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when called without a params object', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndSincom(pool))
        .rejects.toThrow('"mainSincom" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when market is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndSincom(pool, { mainSincom: '0073741', brand: 'FT' }))
        .rejects.toThrow('"market" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when brand is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndSincom(pool, { mainSincom: '0073741', market: '1000' }))
        .rejects.toThrow('"brand" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('uses cd_contract_brand_arcad_code directly (uppercased) when brand is already a 2-letter code, with OR on mainSincom/gn_legal_entity', async () => {
      const pool = makePool(async () => ({
        rows: [{ cd_paired_oic_code: 'SITE001', cd_sincom_code: '0062230', cd_dealer_arcad_code: 'ARC001' }],
      }));

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: 'ft',
      });

      expect(result).toEqual({ physicalSiteId: 'SITE001', dealerNumberIdSource: '0062230', dealerArcadCode: 'ARC001', dpEnIdent: null, arcadBrand: 'FT' });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('(s.cd_main_sincom_code = $1 OR s.gn_legal_entity = $1)'),
        ['0073741', '1000', 'FT'],
      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('s.cd_contract_brand_arcad_code = $3'),
        expect.anything(),
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
    });

    it('transforms a non-letter brand (WebDAC numeric code) into the ARCAD code before searching', async () => {
      const pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ cd_contract_brand_arcad_code: 'FT' }] })
          .mockResolvedValueOnce({ rows: [{ cd_paired_oic_code: 'SITE002', cd_sincom_code: '0062231', cd_dealer_arcad_code: 'ARC002' }] }),
      };

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: '55',
      });

      expect(result).toEqual({ physicalSiteId: 'SITE002', dealerNumberIdSource: '0062231', dealerArcadCode: 'ARC002', dpEnIdent: null, arcadBrand: 'FT' });
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('s.cd_contract_brand_webdac_code = $1'),
        ['55'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('s.cd_contract_brand_arcad_code = $3'),
        ['0073741', '1000', 'FT'],
      );
      expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
    });

    it('returns nulls without querying the main table when a non-letter brand cannot be resolved to an ARCAD code', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: '999',
      });

      expect(result).toEqual({ physicalSiteId: null, dealerNumberIdSource: null, dealerArcadCode: null, dpEnIdent: null, arcadBrand: null });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('s.cd_contract_brand_webdac_code = $1'),
        ['999'],
      );
    });

    it('returns nulls when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: 'FT',
      });

      expect(result).toEqual({ physicalSiteId: null, dealerNumberIdSource: null, dealerArcadCode: null, dpEnIdent: null, arcadBrand: 'FT' });
    });

    it('adds an AND on cd_paired_oic_code as a 4th param when pairedOicCode is provided', async () => {
      const pool = makePool(async () => ({
        rows: [{ cd_paired_oic_code: 'SITE001', cd_sincom_code: '0062230', cd_dealer_arcad_code: 'ARC001' }],
      }));

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: 'ft', pairedOicCode: '00000357',
      });

      expect(result).toEqual({ physicalSiteId: 'SITE001', dealerNumberIdSource: '0062230', dealerArcadCode: 'ARC001', dpEnIdent: null, arcadBrand: 'FT' });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND s.cd_paired_oic_code = $4'),
        ['0073741', '1000', 'FT', '00000357'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
    });

    it('does not add the cd_paired_oic_code condition when pairedOicCode is not provided (backward compatible)', async () => {
      const pool = makePool(async () => ({
        rows: [{ cd_paired_oic_code: 'SITE001', cd_sincom_code: '0062230', cd_dealer_arcad_code: 'ARC001' }],
      }));

      await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: 'ft',
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.not.stringContaining('cd_paired_oic_code = $4'),
        ['0073741', '1000', 'FT'],
      );
    });
  });

  describe('getPhysicalSiteAndPdvId', () => {
    it('throws when mainSincom is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndPdvId(pool, { market: '1000', brand: 'FT', oic: '00007584' }))
        .rejects.toThrow('"mainSincom" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when called without a params object', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndPdvId(pool))
        .rejects.toThrow('"mainSincom" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when market is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndPdvId(pool, { mainSincom: '0073741', brand: 'FT', oic: '00007584' }))
        .rejects.toThrow('"market" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when brand is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndPdvId(pool, { mainSincom: '0073741', market: '1000', oic: '00007584' }))
        .rejects.toThrow('"brand" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when oic is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndPdvId(pool, { mainSincom: '0073741', market: '1000', brand: 'FT' }))
        .rejects.toThrow('"oic" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('resolves physicalSiteId/dealerArcadCode filtering also on cd_paired_oic_code', async () => {
      const pool = makePool(async () => ({
        rows: [{ physicalsite: 'SITE001', podvinfo: 'ARC001', dp_en_ident: 'DMS001' }],
      }));

      const result = await getPhysicalSiteAndPdvId(pool, {
        mainSincom: '0073741', market: '1000', brand: 'ft', oic: '00007584',
      });

      expect(result).toEqual({ physicalSiteId: 'SITE001', dealerArcadCode: 'ARC001', dpEnIdent: 'DMS001' });
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('LEFT JOIN woc.dms_snowflakes dms ON s.cd_dealer_arcad_code = dms.en_ident'));
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND s.cd_paired_oic_code = $4'),
        ['0073741', '1000', 'FT', '00007584'],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
    });

    it('returns nulls without querying the main table when a non-letter brand cannot be resolved to an ARCAD code', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPhysicalSiteAndPdvId(pool, {
        mainSincom: '0073741', market: '1000', brand: '999', oic: '00007584',
      });

      expect(result).toEqual({ physicalSiteId: null, dealerArcadCode: null, dpEnIdent: null });
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('returns nulls when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPhysicalSiteAndPdvId(pool, {
        mainSincom: '0073741', market: '1000', brand: 'FT', oic: '00007584',
      });

      expect(result).toEqual({ physicalSiteId: null, dealerArcadCode: null, dpEnIdent: null });
    });
  });

  describe('getBrandsByOics', () => {
    it('returns an empty map without querying when oics is missing/empty', async () => {
      const pool = makePool();

      expect(await getBrandsByOics(pool, {})).toEqual(new Map());
      expect(await getBrandsByOics(pool)).toEqual(new Map());
      expect(await getBrandsByOics(pool, { oics: [] })).toEqual(new Map());
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns a map of oic -> distinct brand codes read from woc.ang_snowflakes', async () => {
      const pool = makePool(async () => ({
        rows: [
          { oic: '00010925', brands: ['31'] },
          { oic: '00007584', brands: ['30', '31'] },
        ],
      }));

      const result = await getBrandsByOics(pool, { oics: ['00010925', '00007584'] });

      expect(result).toEqual(new Map([
        ['00010925', ['31']],
        ['00007584', ['30', '31']],
      ]));
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('array_agg(DISTINCT s.cd_contract_brand_webdac_code'),
        [['00010925', '00007584']],
      );
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('GROUP BY s.cd_paired_oic_code'));
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('s.cd_paired_oic_code = ANY($1::varchar[])'));
      expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('AND s.fl_is_deleted_flag = 0'));
    });

    it('omits an oic from the map when its brands column is not an array', async () => {
      const pool = makePool(async () => ({
        rows: [{ oic: '00010925', brands: null }],
      }));

      const result = await getBrandsByOics(pool, { oics: ['00010925'] });

      expect(result).toEqual(new Map([['00010925', []]]));
    });

    it('returns an empty map when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getBrandsByOics(pool, { oics: ['00099999'] });

      expect(result).toEqual(new Map());
    });
  });

  describe('getMarkets', () => {
    it('returns all distinct markets when no filter is given', async () => {
      const rows = [
        { market: '1000', description: 'Italy' },
        { market: '3109', description: null },
      ];
      const pool = makePool(async () => ({ rows }));

      const result = await getMarkets(pool);

      expect(result).toEqual(rows);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM woc.ang_snowflakes'), []);
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('SELECT DISTINCT a.cd_market_code AS market, ad.gn_country_name AS description'));
      expect(sql).toEqual(expect.stringContaining('LEFT JOIN LATERAL'));
      expect(sql).toEqual(expect.stringContaining('WHERE ad2.cd_market_code = a.cd_market_code'));
      expect(sql).toEqual(expect.stringContaining('ORDER BY ad2.fl_is_deleted_flag ASC, ad2.dt_ingestion_timestamp DESC'));
      expect(sql).toEqual(expect.stringContaining('WHERE a.fl_is_deleted_flag = 0'));
      expect(sql).not.toEqual(expect.stringContaining('cd_market_code = ANY'));
    });

    it('filters by the given market codes', async () => {
      const pool = makePool(async () => ({ rows: [{ market: '3109', description: 'France' }] }));

      const result = await getMarkets(pool, { markets: ['3109'] });

      expect(result).toEqual([{ market: '3109', description: 'France' }]);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('a.cd_market_code = ANY($1::varchar[])'),
        [['3109']],
      );
    });

    it('ignores an empty markets array (no filter applied)', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await getMarkets(pool, { markets: [] });

      expect(pool.query).toHaveBeenCalledWith(expect.any(String), []);
      const [sql] = pool.query.mock.calls[0];
      expect(sql).not.toEqual(expect.stringContaining('cd_market_code = ANY'));
    });
  });

  describe('insertdmsSnowflakes', () => {
    const { insertdmsSnowflakes } = require('../AnagSnowflakesRepository');
    const makeClient = (rowsPerCall) => {
      const client = { query: jest.fn(), release: jest.fn() };
      client.query.mockImplementation(async (sql) => (
        /^INSERT/.test(sql) ? { rows: rowsPerCall.shift() } : { rows: [] }
      ));
      return { connect: jest.fn().mockResolvedValue(client), client };
    };

    it('does nothing for an empty list', async () => {
      const pool = { connect: jest.fn() };
      expect(await insertdmsSnowflakes(pool, [])).toEqual({ received: 0, saved: 0, inserted: 0, updated: 0 });
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rejects invalid input', async () => {
      await expect(insertdmsSnowflakes({}, null)).rejects.toThrow('must be an array');
      await expect(insertdmsSnowflakes({}, [{}])).rejects.toThrow('gn_row_hash');
    });

    it('upserts in one statement, dedupes by hash and counts inserted/updated', async () => {
      const { connect, client } = makeClient([[{ inserted: true }, { inserted: false }]]);
      const result = await insertdmsSnowflakes({ connect }, [
        { gn_row_hash: 'a', cd_unique_site_code: 'S1', cd_snr_site_code: '' },
        { gn_row_hash: 'b', cd_unique_site_code: 'S2' },
        { gn_row_hash: 'a', cd_unique_site_code: 'S1bis' },
      ]);

      expect(result).toEqual({ received: 3, saved: 2, inserted: 1, updated: 1 });
      const insert = client.query.mock.calls.find(([sql]) => /^INSERT/.test(sql));
      expect(insert[0]).toContain('ON CONFLICT (gn_row_hash) DO UPDATE SET');
      expect(insert[0]).toContain('updated_at = NOW()');
      expect(insert[0]).toContain('dt_last_updated_date = NOW()');
      expect(insert[1]).toHaveLength(2 * 37);
      expect(insert[1][1]).toBe('S1bis');
      expect(insert[1][2]).toBeNull();
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('rolls back and rethrows on error', async () => {
      const client = { query: jest.fn(async (sql) => { if (/^INSERT/.test(sql)) throw new Error('boom'); return {}; }), release: jest.fn() };
      await expect(insertdmsSnowflakes({ connect: async () => client }, [{ gn_row_hash: 'a' }])).rejects.toThrow('boom');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });

    it('upserts legal entities into woc.legalentity_snowflakes', async () => {
      const { insertLegalentitySnowflakes } = require('../AnagSnowflakesRepository');
      const { connect, client } = makeClient([[{ inserted: true }]]);
      const result = await insertLegalentitySnowflakes({ connect }, [{ gn_row_hash: 'a', gn_legal_entity: 'LE1' }]);

      expect(result).toEqual({ received: 1, saved: 1, inserted: 1, updated: 0 });
      const insert = client.query.mock.calls.find(([sql]) => /^INSERT/.test(sql));
      expect(insert[0]).toContain('INSERT INTO woc.legalentity_snowflakes');
      expect(insert[0]).toContain('ON CONFLICT (gn_row_hash) DO UPDATE SET');
      expect(insert[1]).toHaveLength(34);
    });

    it('upserts addresses into woc.addr_snowflakes', async () => {
      const { insertAddrSnowflakes } = require('../AnagSnowflakesRepository');
      const { connect, client } = makeClient([[{ inserted: false }]]);
      const result = await insertAddrSnowflakes({ connect }, [{ gn_row_hash: 'a', gn_town: 'Torino' }]);

      expect(result).toEqual({ received: 1, saved: 1, inserted: 0, updated: 1 });
      const insert = client.query.mock.calls.find(([sql]) => /^INSERT/.test(sql));
      expect(insert[0]).toContain('INSERT INTO woc.addr_snowflakes');
      expect(insert[0]).toContain('ON CONFLICT (gn_row_hash) DO UPDATE SET');
      expect(insert[1]).toHaveLength(32);
    });

    it('upserts M2M records into woc.ang_snowflakes', async () => {
      const { insertAnagSnowflakes } = require('../AnagSnowflakesRepository');
      const { connect, client } = makeClient([[{ inserted: true }]]);
      const result = await insertAnagSnowflakes({ connect }, [{ gn_row_hash: 'a' }]);

      expect(result).toEqual({ received: 1, saved: 1, inserted: 1, updated: 0 });
      const insert = client.query.mock.calls.find(([sql]) => /^INSERT/.test(sql));
      expect(insert[0]).toContain('INSERT INTO woc.ang_snowflakes');
      expect(insert[0]).toContain('ON CONFLICT (gn_row_hash) DO UPDATE SET');
      expect(insert[1]).toHaveLength(37);
    });
  });
});
