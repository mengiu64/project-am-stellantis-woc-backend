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

      expect(result).toEqual({ physicalSiteId: 'SITE001', dealerNumberIdSource: '0062230', dealerArcadCode: 'ARC001' });
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

      expect(result).toEqual({ physicalSiteId: 'SITE002', dealerNumberIdSource: '0062231', dealerArcadCode: 'ARC002' });
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

      expect(result).toEqual({ physicalSiteId: null, dealerNumberIdSource: null, dealerArcadCode: null });
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

      expect(result).toEqual({ physicalSiteId: null, dealerNumberIdSource: null, dealerArcadCode: null });
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
        rows: [{ physicalsite: 'SITE001', podvinfo: 'ARC001' }],
      }));

      const result = await getPhysicalSiteAndPdvId(pool, {
        mainSincom: '0073741', market: '1000', brand: 'ft', oic: '00007584',
      });

      expect(result).toEqual({ physicalSiteId: 'SITE001', dealerArcadCode: 'ARC001' });
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

      expect(result).toEqual({ physicalSiteId: null, dealerArcadCode: null });
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('returns nulls when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPhysicalSiteAndPdvId(pool, {
        mainSincom: '0073741', market: '1000', brand: 'FT', oic: '00007584',
      });

      expect(result).toEqual({ physicalSiteId: null, dealerArcadCode: null });
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
        { market: '3109', description: 'France' },
      ];
      const pool = makePool(async () => ({ rows }));

      const result = await getMarkets(pool);

      expect(result).toEqual(rows);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM woc.ang_snowflakes'), []);
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toEqual(expect.stringContaining('SELECT DISTINCT s.cd_market_code AS market, s.gn_country_name AS description'));
      expect(sql).toEqual(expect.stringContaining('WHERE s.fl_is_deleted_flag = 0'));
      expect(sql).not.toEqual(expect.stringContaining('cd_market_code = ANY'));
    });

    it('filters by the given market codes', async () => {
      const pool = makePool(async () => ({ rows: [{ market: '3109', description: 'France' }] }));

      const result = await getMarkets(pool, { markets: ['3109'] });

      expect(result).toEqual([{ market: '3109', description: 'France' }]);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('s.cd_market_code = ANY($1::varchar[])'),
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
});
