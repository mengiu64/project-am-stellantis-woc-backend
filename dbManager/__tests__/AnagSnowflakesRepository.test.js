'use strict';

const { getCountryIsoCode, getPhysicalSiteAndSincom } = require('../AnagSnowflakesRepository');

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

  describe('getPhysicalSiteAndSincom', () => {
    it('throws when mainSincom is missing', async () => {
      const pool = makePool();
      await expect(getPhysicalSiteAndSincom(pool, { market: '1000', brand: 'FT' }))
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

    it('uses cd_contract_brand_arcad_code when brand is a 2-letter code', async () => {
      const pool = makePool(async () => ({
        rows: [{ gn_physical_site_arcad: 'SITE001', cd_sincom_code: '0062230' }],
      }));

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: 'FT',
      });

      expect(result).toEqual({ physicalSiteId: 'SITE001', dealerNumberIdSource: '0062230' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('s.cd_contract_brand_arcad_code = $3'),
        ['0073741', '1000', 'FT'],
      );
    });

    it('uses cd_contract_brand_webdac_code when brand is not a 2-letter code', async () => {
      const pool = makePool(async () => ({
        rows: [{ gn_physical_site_arcad: 'SITE002', cd_sincom_code: '0062231' }],
      }));

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: '55',
      });

      expect(result).toEqual({ physicalSiteId: 'SITE002', dealerNumberIdSource: '0062231' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('s.cd_contract_brand_webdac_code = $3'),
        ['0073741', '1000', '55'],
      );
    });

    it('returns nulls when no row is found', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      const result = await getPhysicalSiteAndSincom(pool, {
        mainSincom: '0073741', market: '1000', brand: 'FT',
      });

      expect(result).toEqual({ physicalSiteId: null, dealerNumberIdSource: null });
    });
  });
});
