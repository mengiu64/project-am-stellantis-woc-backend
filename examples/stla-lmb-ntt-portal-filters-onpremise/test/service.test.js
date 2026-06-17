jest.mock('../src/auth.js');
jest.mock('../src/http.js');
jest.mock('../src/secrets.js');

const { getFilters } = require('../src/service.js');
const { getValidToken, invalidateToken } = require('../src/auth.js');
const { httpsPost } = require('../src/http.js');
const { getSecretConfig, getURLParameter } = require('../src/secrets.js');
const { NTTError, NTTInternalServerError } = require('../src/responseHelper.js');

describe('service.js', () => {
  const mockSecrets = {
    fed_url: 'https://auth.example.com/token',
    fed_client_id: 'fed_id',
    fed_client_secret: 'fed_secret',
    scope: 'read',
    apic_client_id: 'apic_id',
    apic_client_secret: 'apic_secret'
  };

  const mockApicUrl = 'https://api.example.com/data';
  const mockToken = 'access-token-abc';

  const dealerParams = {
    type: 'dealers',
    codmarket: '1000',
    codbrand: '00',
    codactivity: 'IA',
    codnation: '39',
    startrecord: 0,
    maxrecord: 20
  };

  const locationParams = {
    type: 'dealer_locations',
    codmarket: '1000',
    codbrand: '00',
    codactivity: 'IA',
    coddealer: '0020211',
    comtype: 'TE'
  };

  const rawDealer = { coddealer: '001', name: 'Dealer One', rownumber: '1', totalrow: '50' };

  const rawLocation = {
    coddealer: '0020211',
    oic: '00010993',
    townname: 'ALBENGA',
    address: 'REGIONE MASSARETTI, 4',
    landtype: 'R'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECRET_CREDENTIALS = 'my-secret';
    process.env.APIC_URL_PARAMETER = 'my-param';
    getSecretConfig.mockResolvedValue(mockSecrets);
    getURLParameter.mockResolvedValue(mockApicUrl);
    getValidToken.mockResolvedValue(mockToken);
  });

  afterEach(() => {
    delete process.env.SECRET_CREDENTIALS;
    delete process.env.APIC_URL_PARAMETER;
  });

  describe('env variable validation', () => {
    it('throws NTTInternalServerError when SECRET_CREDENTIALS is not set', async () => {
      delete process.env.SECRET_CREDENTIALS;

      await expect(getFilters(dealerParams)).rejects.toBeInstanceOf(NTTInternalServerError);
      expect(httpsPost).not.toHaveBeenCalled();
    });

    it('throws NTTInternalServerError when APIC_URL_PARAMETER is not set', async () => {
      delete process.env.APIC_URL_PARAMETER;

      await expect(getFilters(dealerParams)).rejects.toBeInstanceOf(NTTInternalServerError);
      expect(httpsPost).not.toHaveBeenCalled();
    });
  });

  describe('mapDealers', () => {
    it('returns items with totalrow stripped and pagination at top level', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [rawDealer], message: null }
      });

      const result = await getFilters(dealerParams);

      expect(result.data).toEqual([{ coddealer: '001', name: 'Dealer One', rownumber: '1' }]);
      expect(result.data[0]).not.toHaveProperty('totalrow');
      expect(result.pagination).toEqual({ startrecord: 0, maxrecord: 20, totalrows: 50 });
    });

    it('passes startrecord and maxrecord into pagination', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [rawDealer], message: null }
      });

      const result = await getFilters({ ...dealerParams, startrecord: 20, maxrecord: 10 });

      expect(result.pagination).toEqual({ startrecord: 20, maxrecord: 10, totalrows: 50 });
    });

    it('returns totalrows as 0 when data is empty', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [], message: null }
      });

      const result = await getFilters(dealerParams);

      expect(result.data).toEqual([]);
      expect(result.pagination.totalrows).toBe(0);
    });

    it('returns multiple dealers with totalrow stripped from all', async () => {
      const dealers = [
        { ...rawDealer, coddealer: '001', rownumber: '1' },
        { ...rawDealer, coddealer: '002', rownumber: '2' }
      ];
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: dealers, message: null }
      });

      const result = await getFilters(dealerParams);

      expect(result.data).toHaveLength(2);
      result.data.forEach((d) => expect(d).not.toHaveProperty('totalrow'));
    });
  });

  describe('mapDealerLocations', () => {
    it('adds description field to each location', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [rawLocation], message: null }
      });

      const result = await getFilters(locationParams);

      expect(result.data[0].description).toBe('00010993 - ALBENGA - REGIONE MASSARETTI, 4');
    });

    it('does not prepend newSiteCode when comtype is TE', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [rawLocation], message: null }
      });

      const result = await getFilters(locationParams);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].coddealer).toBe('0020211');
    });

    it('prepends newSiteCode item first when comtype is AP', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [rawLocation], message: null }
      });

      const result = await getFilters({ ...locationParams, comtype: 'AP' });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].description).toBe('NEW SITE CODE');
      expect(result.data[0].codlocation).toBe('999');
      expect(result.data[0].oic).toBe('00000000');
    });

    it('newSiteCode prepend does not mutate the module-level constant on repeated calls', async () => {
      httpsPost.mockResolvedValue({
        status: 200,
        data: { success: true, data: [rawLocation], message: null }
      });

      const r1 = await getFilters({ ...locationParams, comtype: 'AP' });
      const r2 = await getFilters({ ...locationParams, comtype: 'AP' });

      expect(r1.data[0].description).toBe('NEW SITE CODE');
      expect(r2.data[0].description).toBe('NEW SITE CODE');
    });
  });

  describe('response shaping', () => {
    it('does not include message key when result.message is null', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [], message: null }
      });

      const result = await getFilters(dealerParams);

      expect(result).not.toHaveProperty('message');
    });

    it('includes message when result.message is a string', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [], message: 'No results found' }
      });

      const result = await getFilters(dealerParams);

      expect(result.message).toBe('No results found');
    });

    it('passes success flag through', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [], message: null }
      });

      const result = await getFilters(dealerParams);

      expect(result.success).toBe(true);
    });

    it('dealer_locations does not include pagination', async () => {
      httpsPost.mockResolvedValueOnce({
        status: 200,
        data: { success: true, data: [rawLocation], message: null }
      });

      const result = await getFilters(locationParams);

      expect(result).not.toHaveProperty('pagination');
    });
  });

  describe('callService - 401 retry', () => {
    it('invalidates token and retries once on 401', async () => {
      httpsPost
        .mockResolvedValueOnce({ status: 401, data: null })
        .mockResolvedValueOnce({
          status: 200,
          data: { success: true, data: [rawDealer], message: null }
        });
      getValidToken.mockResolvedValueOnce(mockToken).mockResolvedValueOnce('new-token-xyz');

      const result = await getFilters(dealerParams);

      expect(invalidateToken).toHaveBeenCalledTimes(1);
      expect(httpsPost).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('throws NTTError when service returns non-200 after retry', async () => {
      httpsPost
        .mockResolvedValueOnce({ status: 401, data: null })
        .mockResolvedValueOnce({ status: 500, data: 'Server Error' });

      await expect(getFilters(dealerParams)).rejects.toBeInstanceOf(NTTError);
    });
  });

  describe('callService - error handling', () => {
    it('throws NTTError when upstream returns non-200 without 401', async () => {
      httpsPost.mockResolvedValueOnce({ status: 503, data: 'Service Unavailable' });

      await expect(getFilters(dealerParams)).rejects.toBeInstanceOf(NTTError);
    });

    it('throws NTTInternalServerError on upstream timeout', async () => {
      const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      httpsPost.mockRejectedValueOnce(timeoutError);

      await expect(getFilters(dealerParams)).rejects.toBeInstanceOf(NTTInternalServerError);
    });

    it('throws NTTInternalServerError on unexpected network error', async () => {
      httpsPost.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(getFilters(dealerParams)).rejects.toBeInstanceOf(NTTInternalServerError);
    });

    it('propagates NTTError from upstream without wrapping', async () => {
      httpsPost.mockResolvedValueOnce({ status: 400, data: 'Bad Request' });

      const err = await getFilters(dealerParams).catch((e) => e);

      expect(err).toBeInstanceOf(NTTError);
      expect(err.statusCode).toBe(400);
    });
  });
});
