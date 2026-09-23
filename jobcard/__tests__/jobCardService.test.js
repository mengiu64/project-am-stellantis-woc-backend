'use strict';

jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    auth: {
      url: 'https://auth.test/as/token.oauth2',
      grantType: 'client_credentials',
      scope: 'prd:dgt',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
    dgt: {
      baseUrl: 'https://api.dgt.test',
      basePath: '/ps-stage/extra/srp/digital-layer/v1',
      clientId: 'dgt-client-id',
      clientSecret: 'dgt-client-secret',
    },
  }),
}));
jest.mock('../httpClient');
jest.mock('../dynamoCache', () => ({
  getCacheItem: jest.fn(),
  setCacheItem: jest.fn((key, value) => Promise.resolve(value)),
}));
jest.mock('../authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../../dms/authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../../dms/dmsService', () => ({ postDmsInquiry: jest.fn(), resolveDynamicSenderFields: jest.fn() }));

const { httpsRequest } = require('../httpClient');
const { getCacheItem, setCacheItem } = require('../dynamoCache');
const { getBearerToken: getDgtBearerToken } = require('../authService');
const { getBearerToken } = require('../../dms/authService');
const { postDmsInquiry, resolveDynamicSenderFields } = require('../../dms/dmsService');
const { getJobCardList, getJobCardListCurrent, getJobCardDetails, saveJobCard, getCartPriceAndAvailability, applyDataFromDml, getDataFromDML, getDataFromDMLFromTmp, buildDmsSender } = require('../jobCardService');

describe('jobCardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    getBearerToken.mockResolvedValue('DML-TOKEN');
    getDgtBearerToken.mockResolvedValue('DGT-TOKEN');
    postDmsInquiry.mockResolvedValue({ success: true });
    // Di default si comporta come il vero dms/dmsService.js
    // ::resolveDynamicSenderFields quando la risoluzione automatica (session/
    // v360) non produce nulla: ritorna semplicemente gli overrides.
    resolveDynamicSenderFields.mockImplementation((_identifiers, overrides) => Promise.resolve({ ...overrides }));
  });

  afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
  });

  // ── getJobCardList ───────────────────────────────────────────────────────────

  test('throws if dealerId is missing', async () => {
    await expect(getJobCardList('token', {})).rejects.toThrow('[jobCard] dealerId is required');
  });

  test('calls httpsRequest with correct path and method', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { items: [] } });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(options.path).toContain('/jobCardList');
    expect(options.hostname).toBe('api.dgt.test');
  });

  test('sends dealerId in headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.dealerId).toBe('0062219');
  });

  test('includes IBM client credentials in headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('bearer-token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['X-IBM-Client-Id']).toBe('dgt-client-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('dgt-client-secret');
    expect(options.headers.Authorization).toBe('Bearer bearer-token');
  });

  test('defaults pageSize to 50 when not provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.pageSize).toBe('50');
  });

  test('defaults pageSize to 50 when null', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219', pageSize: null });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.pageSize).toBe('50');
  });

  test('sends optional filters as headers when provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', {
      dealerId: '0062219',
      vin: 'VIN123',
      licensePlate: 'AB123',
      page: 2,
      pageSize: 10,
      sortBy: 'creationDate',
      sortOrder: 'desc',
    });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.vin).toBe('VIN123');
    expect(options.headers.licensePlate).toBe('AB123');
    expect(options.headers.page).toBe('2');
    expect(options.headers.pageSize).toBe('10');
    expect(options.headers.sortBy).toBe('creationDate');
    expect(options.headers.sortOrder).toBe('desc');
  });

  test('returns response body on success', async () => {
    const body = { total: 5, items: [{ jobCardId: '1' }] };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardList('token', { dealerId: '0062219' });
    expect(result).toEqual(body);
  });

  test('coerces workshopReturn to boolean on every jobCardList entry', async () => {
    const body = {
      jobCardList: [
        { jobCardSrpId: 'JCID-1', workshopReturn: 'false' },
        { jobCardSrpId: 'JCID-2', workshopReturn: 'true' },
        { jobCardSrpId: 'JCID-3', workshopReturn: true },
      ],
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardList('token', { dealerId: '0062219' });

    expect(result.jobCardList.map(j => j.workshopReturn)).toEqual([false, true, true]);
  });

  test('does not fail when jobCardList is missing or workshopReturn is absent', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardList: [{ jobCardSrpId: 'JCID-1' }] } });

    const result = await getJobCardList('token', { dealerId: '0062219' });

    expect(result.jobCardList[0].workshopReturn).toBeUndefined();
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: { error: 'server error' } });

    await expect(getJobCardList('token', { dealerId: '0062219' }))
      .rejects.toThrow('[jobCard] jobCardList failed: HTTP 500');
  });

  test('includes x-trace-id header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['x-trace-id']).toBeDefined();
    expect(typeof options.headers['x-trace-id']).toBe('string');
  });

  // ── getJobCardDetails ────────────────────────────────────────────────────────

  test('throws if jobCardId is missing', async () => {
    await expect(getJobCardDetails('token', '')).rejects.toThrow('[jobCard] jobCardId is required');
    await expect(getJobCardDetails('token', null)).rejects.toThrow('[jobCard] jobCardId is required');
    await expect(getJobCardDetails('token', undefined)).rejects.toThrow('[jobCard] jobCardId is required');
  });

  test('calls httpsRequest with correct path including jobCardId in header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardId: '79' } });

    await getJobCardDetails('token', '79');

    const [options] = httpsRequest.mock.calls[0];
    expect(options.path).toContain('/jobCardDetails');
    expect(options.headers.jobCardId).toBe('79');
  });

  test('returns response body on success', async () => {
    const body = { jobCardId: '79', status: 'open' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardDetails('token', '79');
    expect(result).toEqual(body);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 404, headers: {}, body: { message: 'not found' } });

    await expect(getJobCardDetails('token', '99'))
      .rejects.toThrow('[jobCard] jobCardDetails failed: HTTP 404');
  });

  test('converts numeric jobCardId to string', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardDetails('token', 79);

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.jobCardId).toBe('79');
  });

  test('sanitizes ";" separators in contactInfo.address', async () => {
    const body = {
      jobCardDetail: {
        customerInfo: [
          { contactInfo: { address: '13;poissy ;test' } },
        ],
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardDetails('token', '79');

    expect(result.jobCardDetail.customerInfo[0].contactInfo.address).toBe('13 poissy test');
  });

  test('leaves address untouched when it has no ";"', async () => {
    const body = {
      jobCardDetail: {
        customerInfo: [
          { contactInfo: { address: '78 VIA PO' } },
        ],
      },
    };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await getJobCardDetails('token', '79');

    expect(result.jobCardDetail.customerInfo[0].contactInfo.address).toBe('78 VIA PO');
  });

  test('does not fail when jobCardDetail or customerInfo is missing', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await expect(getJobCardDetails('token', '79')).resolves.toEqual({});
  });

  // ── roInfo.roSource enrichment ───────────────────────────────────────────────

  describe('getJobCardListCurrent', () => {
    function jobCard(overrides = {}) {
      return {
        jobCardSrpId: overrides.jobCardSrpId ?? 'SRP-1',
        appointments: overrides.appointments ?? [],
        status: overrides.status ?? 'CREATED',
        ...overrides,
      };
    }

    test('throws if dealerId is missing', async () => {
      await expect(getJobCardListCurrent('token', undefined, '2026-05-20'))
        .rejects.toThrow('[jobCard] dealerId is required');
    });

    test('throws if currentDate is missing', async () => {
      await expect(getJobCardListCurrent('token', '0062219', undefined))
        .rejects.toThrow('[jobCard] currentDate is required');
    });

    test('calls getJobCardList 3 times with the expected date ranges/headers', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardList: [] } });

      await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(httpsRequest).toHaveBeenCalledTimes(3);
      const [receptionOpts, deliveryOpts, createdOpts] = httpsRequest.mock.calls.map(([opts]) => opts);

      expect(receptionOpts.headers.receptionStartDate).toBe('2026-05-20T00:01:00.000Z');
      expect(receptionOpts.headers.receptionEndDate).toBe('2026-05-20T23:59:00.000Z');

      expect(deliveryOpts.headers.deliveryStartDate).toBe('2026-05-20T00:01:00.000Z');
      expect(deliveryOpts.headers.deliveryEndDate).toBe('2026-05-20T23:59:00.000Z');

      expect(createdOpts.headers.creationStartDate).toBe('2026-05-14T00:01:00.000Z');
      expect(createdOpts.headers.creationEndDate).toBe('2026-05-20T23:59:00.000Z');
    });

    test('combines arrayReception, arrayDelivery and arrayCreated, tagging type and keeping duplicates', async () => {
      const cardA = jobCard({ jobCardSrpId: 'A' });
      const cardB = jobCard({ jobCardSrpId: 'B' });
      const cardC = jobCard({ jobCardSrpId: 'C' });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [cardA, cardB] } }) // reception
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [cardB] } })        // delivery (dup of B)
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [cardC] } });        // created

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList).toHaveLength(4);
      expect(result.jobCardList.map((c) => c.jobCardSrpId)).toEqual(['A', 'B', 'B', 'C']);
      expect(result.jobCardList.map((c) => c.type)).toEqual(['reception', 'reception', 'delivery', undefined]);
    });

    test('excludes arrayCreated entries with an estimated reception date/time set', async () => {
      const withEstimatedReception = jobCard({
        jobCardSrpId: 'D',
        appointments: [{ reception: { estimatedReceptionDateTime: '2026-05-20T09:00:00Z' } }],
      });
      const withoutEstimated = jobCard({ jobCardSrpId: 'E' });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [withEstimatedReception, withoutEstimated] } });

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList.map((c) => c.jobCardSrpId)).toEqual(['E']);
    });

    test('excludes arrayCreated entries with an estimated delivery date/time set', async () => {
      const withEstimatedDelivery = jobCard({
        jobCardSrpId: 'F',
        appointments: [{ delivery: { estimatedDeliveryDateTime: '2026-05-20T17:00:00Z' } }],
      });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [withEstimatedDelivery] } });

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList).toEqual([]);
    });

    test('excludes arrayCreated entries with an actual (non-estimated) reception date/time set', async () => {
      const withActualReception = jobCard({
        jobCardSrpId: 'I',
        appointments: [{ reception: { estimatedReceptionDateTime: null, receptionDateTime: '2026-05-18T08:30:00.000Z' } }],
      });
      const withoutAny = jobCard({ jobCardSrpId: 'J' });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [withActualReception, withoutAny] } });

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList.map((c) => c.jobCardSrpId)).toEqual(['J']);
    });

    test('excludes arrayCreated entries with an actual (non-estimated) delivery date/time set', async () => {
      const withActualDelivery = jobCard({
        jobCardSrpId: 'K',
        appointments: [{ delivery: { estimatedDeliveryDateTime: null, deliveryDateTime: '2026-05-19T11:30:00.000Z' } }],
      });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [withActualDelivery] } });

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList).toEqual([]);
    });

    test('excludes arrayCreated entries with status different from "CREATED"', async () => {
      const createdStatus = jobCard({ jobCardSrpId: 'G', status: 'CREATED' });
      const otherStatus    = jobCard({ jobCardSrpId: 'H', status: 'BOOKED' });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [createdStatus, otherStatus] } });

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList.map((c) => c.jobCardSrpId)).toEqual(['G']);
    });

    test('handles missing jobCardList arrays in any of the three responses', async () => {
      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: {} })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: {} })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: {} });

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result).toEqual({ jobCardList: [] });
    });
  });

  // ── roInfo.roSource enrichment ───────────────────────────────────────────────

  describe('roSource enrichment', () => {
    test('mirrors roInfo.sourceApplication into roInfo.roSource, placed right after it', async () => {
      const body = {
        jobCardDetail: {
          roInfo: { jobCardSrpId: 'JCID-504', sourceApplication: 'PANIER', dealerId: '017721L' },
        },
      };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

      const result = await getJobCardDetails('token', '79');

      expect(result.jobCardDetail.roInfo.roSource).toBe('PANIER');
      expect(Object.keys(result.jobCardDetail.roInfo)).toEqual([
        'jobCardSrpId', 'sourceApplication', 'roSource', 'dealerId',
      ]);
    });

    test('does not fail when roInfo or sourceApplication is missing', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardDetail: {} } });
      await expect(getJobCardDetails('token', '79')).resolves.toEqual({ jobCardDetail: {} });

      const body = { jobCardDetail: { roInfo: { dealerId: '017721L' } } };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });
      const result = await getJobCardDetails('token', '79');
      expect(result.jobCardDetail.roInfo.roSource).toBeUndefined();
      expect(result.jobCardDetail.roInfo.dealerId).toBe('017721L');
    });
  });

  // ── packageType / packageCharge enrichment on jobs ──────────────────────────

  describe('packageType/packageCharge enrichment', () => {
    async function detailsFor(jobs) {
      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { jobCardDetail: { jobs } },
      });
      const result = await getJobCardDetails('token', '79');
      return result.jobCardDetail.jobs;
    }

    test('jobType "MFP" => packageType "FP", packageCharge "CUSTOMER"', async () => {
      const [job] = await detailsFor([{ jobType: 'MFP' }]);
      expect(job.packageType).toBe('FP');
      expect(job.packageCharge).toBe('CUSTOMER');
    });

    test('jobType "STD" with packageCode present => packageType "QE", packageCharge "CUSTOMER"', async () => {
      const [job] = await detailsFor([{ jobType: 'STD', packageCode: 'PKG-1' }]);
      expect(job.packageType).toBe('QE');
      expect(job.packageCharge).toBe('CUSTOMER');
    });

    test('jobType "LFP" => packageType "LFP", packageCharge "CUSTOMER"', async () => {
      const [job] = await detailsFor([{ jobType: 'LFP' }]);
      expect(job.packageType).toBe('LFP');
      expect(job.packageCharge).toBe('CUSTOMER');
    });

    test.each([
      ['missing', undefined],
      ['null', null],
      ['empty string', ''],
    ])('jobType "STD" with packageCode %s => packageType "GC", packageCharge "CUSTOMER"', async (_label, packageCode) => {
      const [job] = await detailsFor([{ jobType: 'STD', packageCode }]);
      expect(job.packageType).toBe('GC');
      expect(job.packageCharge).toBe('CUSTOMER');
    });

    test('any other non-empty jobType => packageType "GC", packageCharge "INTERNAL"', async () => {
      const [job] = await detailsFor([{ jobType: 'REPAIR' }]);
      expect(job.packageType).toBe('GC');
      expect(job.packageCharge).toBe('INTERNAL');
    });

    test('jobType missing/empty/null => packageType "GC", packageCharge "CUSTOMER"', async () => {
      const [j1] = await detailsFor([{}]);
      expect(j1.packageType).toBe('GC');
      expect(j1.packageCharge).toBe('CUSTOMER');

      const [j2] = await detailsFor([{ jobType: null }]);
      expect(j2.packageType).toBe('GC');
      expect(j2.packageCharge).toBe('CUSTOMER');

      const [j3] = await detailsFor([{ jobType: '' }]);
      expect(j3.packageType).toBe('GC');
      expect(j3.packageCharge).toBe('CUSTOMER');
    });

    test('paymentType present overrides packageCharge regardless of jobType', async () => {
      const [job] = await detailsFor([{ jobType: 'MFP', paymentType: 'MANUFACTURER' }]);
      expect(job.packageType).toBe('FP');
      expect(job.packageCharge).toBe('MANUFACTURER');
    });

    test('paymentType present overrides packageCharge for the "other jobType" (INTERNAL) case', async () => {
      const [job] = await detailsFor([{ jobType: 'WARRANTY', paymentType: 'INSURANCE' }]);
      expect(job.packageType).toBe('GC');
      expect(job.packageCharge).toBe('INSURANCE');
    });

    test('enriches every job in the array independently', async () => {
      const jobs = await detailsFor([
        { jobType: 'MFP' },
        { jobType: 'STD', packageCode: 'PKG-2' },
        { jobType: 'STD' },
      ]);
      expect(jobs.map(j => [j.packageType, j.packageCharge])).toEqual([
        ['FP', 'CUSTOMER'],
        ['QE', 'CUSTOMER'],
        ['GC', 'CUSTOMER'],
      ]);
    });

    test('does not fail when jobs is missing or not an array', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardDetail: {} } });
      await expect(getJobCardDetails('token', '79')).resolves.toEqual({ jobCardDetail: {} });
    });

    test('places packageType/packageCharge before partInfo when partInfo is present', async () => {
      const [job] = await detailsFor([
        {
          jobInternalId: 'j1',
          jobType: 'STD',
          packageCode: '42001A',
          partInfo: [{ partId: '1' }],
        },
      ]);
      expect(Object.keys(job)).toEqual([
        'jobInternalId', 'jobType', 'packageCode', 'packageType', 'packageCharge', 'partInfo',
      ]);
    });

    test('places packageType/packageCharge before laborInfo when laborInfo is present', async () => {
      const [job] = await detailsFor([
        {
          jobInternalId: 'j1',
          jobType: 'MFP',
          laborInfo: [{ laborOperationId: '1' }],
        },
      ]);
      expect(Object.keys(job)).toEqual([
        'jobInternalId', 'jobType', 'packageType', 'packageCharge', 'laborInfo',
      ]);
    });

    test('places packageType/packageCharge before whichever of partInfo/laborInfo comes first', async () => {
      const [job] = await detailsFor([
        {
          jobInternalId: 'j1',
          jobType: 'STD',
          packageCode: '42001A',
          partInfo: [{ partId: '1' }],
          laborInfo: [{ laborOperationId: '1' }],
        },
      ]);
      expect(Object.keys(job)).toEqual([
        'jobInternalId', 'jobType', 'packageCode', 'packageType', 'packageCharge', 'partInfo', 'laborInfo',
      ]);
    });

    test('appends packageType/packageCharge at the end when neither partInfo nor laborInfo is present', async () => {
      const [job] = await detailsFor([{ jobInternalId: 'j1', jobType: 'STD' }]);
      expect(Object.keys(job)).toEqual(['jobInternalId', 'jobType', 'packageType', 'packageCharge']);
    });
  });

  // ── appDiscountPercentage/dmsDiscountPercentage normalization (checkDiscount) ─

  describe('checkDiscount', () => {
    async function detailsFor(jobs) {
      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { jobCardDetail: { jobs } },
      });
      const result = await getJobCardDetails('token', '79');
      return result.jobCardDetail.jobs;
    }

    test('discountInPercentage != 0 forces both fields to 0 even if already valorized', async () => {
      const [job] = await detailsFor([
        {
          discountInPercentage: 10,
          partInfo: [{ partId: '1', appDiscountPercentage: 5, dmsDiscountPercentage: 3 }],
          laborInfo: [{ laborOperationId: '1', appDiscountPercentage: 7, dmsDiscountPercentage: 2 }],
        },
      ]);
      expect(job.partInfo[0]).toMatchObject({ appDiscountPercentage: 0, dmsDiscountPercentage: 0 });
      expect(job.laborInfo[0]).toMatchObject({ appDiscountPercentage: 0, dmsDiscountPercentage: 0 });
    });

    test('discountInPercentage != 0 adds missing fields with 0', async () => {
      const [job] = await detailsFor([
        {
          discountInPercentage: -15,
          partInfo: [{ partId: '1' }],
          laborInfo: [{ laborOperationId: '1' }],
        },
      ]);
      expect(job.partInfo[0]).toMatchObject({ appDiscountPercentage: 0, dmsDiscountPercentage: 0 });
      expect(job.laborInfo[0]).toMatchObject({ appDiscountPercentage: 0, dmsDiscountPercentage: 0 });
    });

    test('discountInPercentage == 0 or missing only adds missing fields, leaving existing values untouched', async () => {
      const [job] = await detailsFor([
        {
          discountInPercentage: 0,
          partInfo: [{ partId: '1', appDiscountPercentage: 5 }],
          laborInfo: [{ laborOperationId: '1' }],
        },
      ]);
      expect(job.partInfo[0]).toMatchObject({ appDiscountPercentage: 5, dmsDiscountPercentage: 0 });
      expect(job.laborInfo[0]).toMatchObject({ appDiscountPercentage: 0, dmsDiscountPercentage: 0 });

      const [job2] = await detailsFor([
        { partInfo: [{ partId: '1', appDiscountPercentage: 9, dmsDiscountPercentage: 4 }] },
      ]);
      expect(job2.partInfo[0]).toMatchObject({ appDiscountPercentage: 9, dmsDiscountPercentage: 4 });
    });

    test('does not fail when partInfo/laborInfo are missing or not arrays', async () => {
      const [job] = await detailsFor([{ discountInPercentage: 20 }]);
      expect(job.partInfo).toBeUndefined();
      expect(job.laborInfo).toBeUndefined();
    });

    test('does not fail when jobs is missing or not an array', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardDetail: {} } });
      await expect(getJobCardDetails('token', '79')).resolves.toEqual({ jobCardDetail: {} });
    });
  });

  // ── workshopReturn.workshopReturn boolean coercion ──────────────────────────

  describe('workshopReturn sanitization', () => {
    async function workshopReturnFor(rawWorkshopReturn) {
      httpsRequest.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: { jobCardDetail: { workshopReturn: { workshopReturn: rawWorkshopReturn } } },
      });
      const result = await getJobCardDetails('token', '79');
      return result.jobCardDetail.workshopReturn.workshopReturn;
    }

    test.each([
      [true, true],
      [false, false],
      ['true', true],
      ['false', false],
      ['TRUE', true],
      ['1', true],
      ['0', false],
      [1, true],
      [0, false],
    ])('coerces workshopReturn %p to boolean %p', async (raw, expected) => {
      expect(await workshopReturnFor(raw)).toBe(expected);
    });

    test('does not fail when workshopReturn is missing', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { jobCardDetail: {} } });
      await expect(getJobCardDetails('token', '79')).resolves.toEqual({ jobCardDetail: {} });
    });

    test('leaves the rest of jobCardDetail untouched', async () => {
      const body = {
        jobCardDetail: {
          workshopReturn: { workshopReturn: 'true', comeBackRepairOrder: false },
        },
      };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

      const result = await getJobCardDetails('token', '79');

      expect(result.jobCardDetail.workshopReturn).toEqual({
        workshopReturn: true,
        comeBackRepairOrder: false,
      });
    });
  });

  // ── DynamoDB persistence (readable later by djc lambda) ────────────────────

  test('saves the sanitized response body to the DynamoDB cache', async () => {
    const body = { jobCardId: '79', jobCardDetail: { roInfo: { foo: 'bar' } } };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    await getJobCardDetails('token', '79');

    expect(setCacheItem).toHaveBeenCalledTimes(1);
    const [cacheKey, value, ttlSeconds] = setCacheItem.mock.calls[0];
    expect(cacheKey).toBe('jobcard:jobcarddetails:79');
    expect(value).toEqual(body);
    expect(ttlSeconds).toBe(3600);
  });

  test('uses the numeric jobCardId (converted to string) in the cache key', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardDetails('token', 79);

    const [cacheKey] = setCacheItem.mock.calls[0];
    expect(cacheKey).toBe('jobcard:jobcarddetails:79');
  });

  test('still returns the response even if writing to the cache fails', async () => {
    const body = { jobCardId: '79' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });
    setCacheItem.mockResolvedValueOnce(body);

    await expect(getJobCardDetails('token', '79')).resolves.toEqual(body);
  });

  test('does not write to the cache when the request fails', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 404, headers: {}, body: { message: 'not found' } });

    await expect(getJobCardDetails('token', '99')).rejects.toThrow();
    expect(setCacheItem).not.toHaveBeenCalled();
  });

  test('does not write to the cache when jobCardId is missing', async () => {
    await expect(getJobCardDetails('token', '')).rejects.toThrow();
    expect(setCacheItem).not.toHaveBeenCalled();
  });


  test('sends date range and other optional filters as headers when provided', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardList('token', {
      dealerId: '0062219',
      creationStartDate: '2024-01-01',
      creationEndDate: '2024-01-31',
      deliveryStartDate: '2024-02-01',
      deliveryEndDate: '2024-02-28',
      receptionStartDate: '2024-03-01',
      receptionEndDate: '2024-03-31',
      dmsRepairOrderId: 'DMS-001',
      customerName: 'Mario Rossi',
    });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.creationStartDate).toBe('2024-01-01');
    expect(options.headers.creationEndDate).toBe('2024-01-31');
    expect(options.headers.deliveryStartDate).toBe('2024-02-01');
    expect(options.headers.deliveryEndDate).toBe('2024-02-28');
    expect(options.headers.receptionStartDate).toBe('2024-03-01');
    expect(options.headers.receptionEndDate).toBe('2024-03-31');
    expect(options.headers.dmsRepairOrderId).toBe('DMS-001');
    expect(options.headers.customerName).toBe('Mario Rossi');
  });

  test('getJobCardList works without optional params (only dealerId)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { items: [] } });

    const result = await getJobCardList('token', { dealerId: '0062219' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers.dealerId).toBe('0062219');
    expect(options.headers.vin).toBeUndefined();
    expect(result).toEqual({ items: [] });
  });

  // ── saveJobCard ──────────────────────────────────────────────────────────────

  describe('saveJobCard', () => {
    test('throws if payload is missing', async () => {
      await expect(saveJobCard('token', undefined)).rejects.toThrow('[jobCard] payload is required');
      await expect(saveJobCard('token', null)).rejects.toThrow('[jobCard] payload is required');
    });

    test('throws if payload is not an object', async () => {
      await expect(saveJobCard('token', 'not-an-object')).rejects.toThrow('[jobCard] payload is required');
    });

    test('calls httpsRequest with POST method and correct path', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { success: true } });

      await saveJobCard('token', { roInfo: { jobCardSrpId: 'JCID-1' } });

      const [options] = httpsRequest.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.path).toContain('/jobCard');
      expect(options.path).not.toContain('/jobCardList');
      expect(options.path).not.toContain('/jobCardDetails');
      expect(options.hostname).toBe('api.dgt.test');
    });

    test('sends the JSON-serialized payload as request body with Content-Type/Content-Length headers', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      const payload = { roInfo: { jobCardSrpId: 'JCID-1' } };
      await saveJobCard('token', payload);

      const [options, body] = httpsRequest.mock.calls[0];
      expect(JSON.parse(body)).toEqual(payload);
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['Content-Length']).toBe(Buffer.byteLength(JSON.stringify(payload)));
    });

    test('strips packageType/packageCharge from payload.jobs before sending (DGT rejects them with "is not allowed")', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      const payload = {
        roInfo: { jobCardSrpId: 'JCID-1' },
        jobs: [
          { jobInternalId: 'JOB-1', jobType: 'STD', packageType: 'GC', packageCharge: 'CUSTOMER' },
          { jobInternalId: 'JOB-2', packageType: 'FP', packageCharge: 'MANUFACTURER', laborInfo: [] },
        ],
      };
      await saveJobCard('token', payload);

      const [, body] = httpsRequest.mock.calls[0];
      expect(JSON.parse(body)).toEqual({
        roInfo: { jobCardSrpId: 'JCID-1' },
        jobs: [
          { jobInternalId: 'JOB-1', jobType: 'STD' },
          { jobInternalId: 'JOB-2', laborInfo: [] },
        ],
      });
      // The original payload passed in is left untouched
      expect(payload.jobs[0]).toHaveProperty('packageType', 'GC');
    });

    test('leaves payload without a jobs array untouched', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      const payload = { roInfo: { jobCardSrpId: 'JCID-1' } };
      await saveJobCard('token', payload);

      const [, body] = httpsRequest.mock.calls[0];
      expect(JSON.parse(body)).toEqual(payload);
    });

    test('includes IBM client credentials and Authorization header', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      await saveJobCard('bearer-token', { roInfo: {} });

      const [options] = httpsRequest.mock.calls[0];
      expect(options.headers['X-IBM-Client-Id']).toBe('dgt-client-id');
      expect(options.headers['X-IBM-Client-Secret']).toBe('dgt-client-secret');
      expect(options.headers.Authorization).toBe('Bearer bearer-token');
    });

    test('returns response body on 200 success', async () => {
      const body = { success: true, jobCardId: '79' };
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

      const result = await saveJobCard('token', { roInfo: {} });
      expect(result).toEqual(body);
    });

    test('returns response body on 201 success', async () => {
      const body = { success: true, jobCardId: '79' };
      httpsRequest.mockResolvedValue({ statusCode: 201, headers: {}, body });

      const result = await saveJobCard('token', { roInfo: {} });
      expect(result).toEqual(body);
    });

    test('throws on HTTP error', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: { error: 'server error' } });

      await expect(saveJobCard('token', { roInfo: {} }))
        .rejects.toThrow('[jobCard] jobCard failed: HTTP 500');
    });
  });

  // ── getCartPriceAndAvailability ────────────────────────────────────────────

  describe('getCartPriceAndAvailability', () => {
    test('builds a single WorkLine aggregating partNumbers/laborOperationCodes from all jobs and posts the DML inquiry', async () => {
      const jobCardDetail = {
        roInfo: { jobCardSrpId: 'JCID-84226', jobCardLegacyId: '93827988' },
        vehicleInfo: { identification: { vin: 'ZFACF1BJ8PJH92758' } },
        jobs: [
          {
            partInfo: [{ partNumber: '735712563' }],
            laborInfo: [{ laborOperationCode: '4110A10' }],
          },
          {
            partInfo: [{ partNumber: '00001444EQ' }],
            laborInfo: [{ laborOperationCode: '95R04A' }],
          },
        ],
      };

      const result = await getCartPriceAndAvailability(jobCardDetail);

      expect(getBearerToken).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
      expect(postDmsInquiry).toHaveBeenCalledWith('DML-TOKEN', {
        PartsInquiryHeader: {
          DocumentID: 'JCID-84226',
          CustomerIdDms: null,
          MessageType: 'WL',
          VehicleID: 'ZFACF1BJ8PJH92758',
        },
        WorkLines: [
          {
            CustomerAccountDMSID: null,
            WorkLineReference: '001',
            TransactionType: 1,
            PartsItem: [
              { PartNumber: '735712563', PartType: 'O', PartStatus: 'L' },
              { PartNumber: '00001444EQ', PartType: 'O', PartStatus: 'L' },
            ],
            LaborItem: [
              { LaborOperationID: '4110A10', LaborType: 'L' },
              { LaborOperationID: '95R04A', LaborType: 'L' },
            ],
          },
        ],
        sender: {},
      });
    });

    test('handles missing roInfo/vehicleInfo/jobs by sending null/empty values', async () => {
      await getCartPriceAndAvailability({});

      expect(postDmsInquiry).toHaveBeenCalledWith('DML-TOKEN', {
        PartsInquiryHeader: {
          DocumentID: null,
          CustomerIdDms: null,
          MessageType: 'WL',
          VehicleID: null,
        },
        WorkLines: [
          {
            CustomerAccountDMSID: null,
            WorkLineReference: '001',
            TransactionType: 1,
            PartsItem: [],
            LaborItem: [],
          },
        ],
        sender: {},
      });
    });

    test('is invoked by getDataFromDML with the sanitized jobCardDetail', async () => {
      const jobCardDetail = {
        roInfo: { jobCardSrpId: 'JCID-1' },
        vehicleInfo: { identification: { vin: 'VIN1' } },
        jobs: [],
      };

      await getDataFromDML(jobCardDetail);

      expect(postDmsInquiry).toHaveBeenCalledWith('DML-TOKEN', expect.objectContaining({
        PartsInquiryHeader: expect.objectContaining({ DocumentID: 'JCID-1', VehicleID: 'VIN1' }),
      }));
    });
  });

  // ── buildDmsSender ───────────────────────────────────────────────────────
  // Il lookup dbManager/AnagSnowflakesRepository (woc.ang_snowflakes) NON è più
  // eseguito qui: è centralizzato in dms/dmsService.js::buildApplicationArea
  // (vedi dms/__tests__/dmsService.test.js), che lo applica identicamente a
  // qualunque chiamante di postDmsInquiry. buildDmsSender si limita quindi a
  // estrarre username/vin ed a delegare la risoluzione dinamica (mainSincom/
  // market/language/dealerCountryCode/brand) a
  // dms/dmsService.js::resolveDynamicSenderFields (mockata qui), mappandone
  // il risultato sui campi del sender (incluso `market`, solo chiave di
  // lookup lato dms, non un campo Sender).

  describe('buildDmsSender', () => {
    test('returns {} when resolveDynamicSenderFields resolves nothing', async () => {
      const result = await buildDmsSender({});

      expect(result).toEqual({});
    });

    test('maps resolveDynamicSenderFields fields to the corresponding sender keys, skipping undefined ones', async () => {
      resolveDynamicSenderFields.mockResolvedValue({ mainSincom: '0062219', language: 'fr', dealerCountryCode: 'FR' });

      const result = await buildDmsSender({}, { mainSincom: '0062219', username: 'jdoe', language: 'fr', dealerCountryCode: 'FR' });

      expect(result).toEqual({
        dealerNumberId: '0062219',
        serviceId: 'jdoe',
        languageCode: 'fr',
        dealerCountryCode: 'FR',
      });
    });

    test('extracts vin from jobCardDetail.vehicleInfo.identification.vin and passes username/vin to resolveDynamicSenderFields', async () => {
      const jobCardDetail = { vehicleInfo: { identification: { vin: 'VF3CABHW6GT204366' } } };

      await buildDmsSender(jobCardDetail, { username: 'jdoe', mainSincom: '0062219', market: 'FR' });

      expect(resolveDynamicSenderFields).toHaveBeenCalledWith(
        { username: 'jdoe', vin: 'VF3CABHW6GT204366' },
        { username: 'jdoe', mainSincom: '0062219', market: 'FR' },
      );
    });

    test('includes brand from resolveDynamicSenderFields (v360) and market (pass-through key for dms centralized lookup)', async () => {
      const jobCardDetail = { vehicleInfo: { identification: { vin: 'VF3CABHW6GT204366' } } };
      resolveDynamicSenderFields.mockResolvedValue({ mainSincom: '0062219', market: 'FR', brand: 'FT' });

      const result = await buildDmsSender(jobCardDetail, { mainSincom: '0062219', market: 'FR' });

      expect(result).toEqual({
        dealerNumberId: '0062219',
        market: 'FR',
        brand: 'FT',
      });
    });

    test('omits market/brand when not available', async () => {
      const result = await buildDmsSender({}, { mainSincom: '0062219' });

      expect(result).toEqual({ dealerNumberId: '0062219' });
    });
  });

  // ── applyDataFromDml ─────────────────────────────────────────────────────

  describe('applyDataFromDml', () => {
    test('overwrites unitaryPriceExclVat/originalPriceExclVat/dmsDiscountPercentage/QuantityAvailable/availability on matching partInfo by PartNumber', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: '735712563', unitaryPriceExclVat: 50, itemQuantity: 2 }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [
          {
            PartsItem: [
              { PartNumber: '735712563', OriginalPriceExclVAT: 493.71, DiscountPercentage: 5, QuantityAvailable: 3 },
            ],
            LaborItems: [],
          },
        ],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0]).toEqual(expect.objectContaining({
        partNumber: '735712563',
        unitaryPriceExclVat: 493.71, // da source.OriginalPriceExclVAT
        originalPriceExclVat: 987.42, // itemQuantity(2) * unitaryPriceExclVat(493.71)
        dmsDiscountPercentage: 5,
        QuantityAvailable: 3,
        availability: 'green',
      }));
    });

    test('falls back to BinLocation[0].QuantityAvailable when QuantityAvailable is not top-level', () => {
      const jobCardDetail = {
        jobs: [{ partInfo: [{ partNumber: 'P1' }], laborInfo: [] }],
      };
      const dmlResponse = {
        WorkLines: [
          {
            PartsItem: [
              {
                PartNumber: 'P1',
                OriginalPriceExclVAT: 10,
                DiscountPercentage: 0,
                BinLocation: [{ QuantityAvailable: 7 }],
              },
            ],
          },
        ],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].QuantityAvailable).toBe(7);
    });

    test.each([
      [5, 3, 'red'],
      [3, 3, 'orange'],
      [1, 3, 'green'],
    ])('sets availability to %s when itemQuantity=%i vs QuantityAvailable=%i', (itemQuantity, quantityAvailable, expected) => {
      const jobCardDetail = {
        jobs: [{ partInfo: [{ partNumber: 'P1', itemQuantity }], laborInfo: [] }],
      };
      const dmlResponse = {
        WorkLines: [
          {
            PartsItem: [
              { PartNumber: 'P1', OriginalPriceExclVAT: 10, DiscountPercentage: 0, QuantityAvailable: quantityAvailable },
            ],
          },
        ],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].availability).toBe(expected);
    });

    test('leaves availability undefined when itemQuantity is missing', () => {
      const jobCardDetail = {
        jobs: [{ partInfo: [{ partNumber: 'P1' }], laborInfo: [] }],
      };
      const dmlResponse = {
        WorkLines: [
          {
            PartsItem: [
              { PartNumber: 'P1', OriginalPriceExclVAT: 10, DiscountPercentage: 0, QuantityAvailable: 3 },
            ],
          },
        ],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].availability).toBeUndefined();
    });

    test('does not overwrite partNumber/partDescription, but uses ReplacementItem data for discount/availability', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: '1610489680', partDescription: 'original desc', itemQuantity: 1, unitaryPriceExclVat: 40 }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [
          {
            PartsItem: [
              {
                PartNumber: '1610489680',
                PartNumberDescription: 'JEU DE 4 PLAQUETTES FREIN AV',
                OriginalPriceExclVAT: 100,
                DiscountPercentage: 10,
                ReplacementItem: [
                  {
                    PartNumber: '12347411',
                    PartReferenceID: '1610489680',
                    PartNumberDescription: 'PR de remplacement',
                    OriginalPriceExclVAT: 80,
                    DiscountPercentage: 0,
                    BinLocation: [{ QuantityAvailable: 0 }],
                  },
                ],
              },
            ],
          },
        ],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0]).toEqual(expect.objectContaining({
        partNumber: '1610489680',
        partDescription: 'original desc',
        unitaryPriceExclVat: 80, // da ReplacementItem[0].OriginalPriceExclVAT
        originalPriceExclVat: 80, // itemQuantity(1) * unitaryPriceExclVat(80)
        dmsDiscountPercentage: 0, // da ReplacementItem[0].DiscountPercentage
        QuantityAvailable: 0, // da ReplacementItem[0].BinLocation[0].QuantityAvailable
        availability: 'red',
      }));
    });

    test('overwrites laborDuration/dmsDiscountPercentage/laborRateAmount on matching laborInfo by laborOperationCode', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [],
            laborInfo: [{ laborOperationCode: '4110A10', laborDuration: 0.1 }],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [
          {
            PartsItem: [],
            LaborItems: [
              { LaborOperationID: '4110A10', TimeUnit: 0.25, DiscountPercentage: 0, UnitaryTimeAmount: 60 },
            ],
          },
        ],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].laborInfo[0]).toEqual(expect.objectContaining({
        laborOperationCode: '4110A10',
        laborDuration: 0.25,
        dmsDiscountPercentage: 0,
        laborRateAmount: 60,
      }));
    });

    // ── riconciliazione appDiscountPercentage/dmsDiscountPercentage ─────────

    test('wlDiscount=true, sconto DML!=0: appDiscountPercentage = -DiscountPercentage DML, dmsDiscountPercentage = DiscountPercentage DML', () => {
      const jobCardDetail = {
        jobs: [
          {
            discountInPercentage: 10, // sconto a livello di workline
            partInfo: [{ partNumber: 'P1', itemQuantity: 1, unitaryPriceExclVat: 100, appDiscountPercentage: 15 }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [{ PartNumber: 'P1', DiscountPercentage: 20 }], LaborItems: [] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].appDiscountPercentage).toBe(-20);
      expect(jobCardDetail.jobs[0].partInfo[0].dmsDiscountPercentage).toBe(20);
    });

    test('wlDiscount=true, sconto DML=0: dmsDiscountPercentage = 0 (appDiscountPercentage invariato)', () => {
      const jobCardDetail = {
        jobs: [
          {
            discountInAmountOnPriceWithVat: 5,
            partInfo: [{ partNumber: 'P1', itemQuantity: 1, unitaryPriceExclVat: 100, appDiscountPercentage: 15, dmsDiscountPercentage: 3 }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [{ PartNumber: 'P1', DiscountPercentage: 0 }], LaborItems: [] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].appDiscountPercentage).toBe(15);
      expect(jobCardDetail.jobs[0].partInfo[0].dmsDiscountPercentage).toBe(0);
    });

    test('wlDiscount=false, appDiscountPercentage!=0 e dmsDiscountPercentage=0: sottrae lo sconto DML da appDiscountPercentage', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: 'P1', itemQuantity: 1, unitaryPriceExclVat: 100, appDiscountPercentage: 15, dmsDiscountPercentage: 0 }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [{ PartNumber: 'P1', DiscountPercentage: 5 }], LaborItems: [] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].appDiscountPercentage).toBe(10); // 15 - 5
      expect(jobCardDetail.jobs[0].partInfo[0].dmsDiscountPercentage).toBe(5);
    });

    test('wlDiscount=false, appDiscountPercentage!=0 e dmsDiscountPercentage!=0: (appDiscountPercentage+dmsDiscountPercentage) - sconto DML', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: 'P1', itemQuantity: 1, unitaryPriceExclVat: 100, appDiscountPercentage: 15, dmsDiscountPercentage: 5 }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [{ PartNumber: 'P1', DiscountPercentage: 8 }], LaborItems: [] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].appDiscountPercentage).toBe(12); // (15+5) - 8
      expect(jobCardDetail.jobs[0].partInfo[0].dmsDiscountPercentage).toBe(8);
    });

    test('wlDiscount=false, appDiscountPercentage=0: dmsDiscountPercentage = sconto DML', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: 'P1', itemQuantity: 1, unitaryPriceExclVat: 100, appDiscountPercentage: 0 }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [{ PartNumber: 'P1', DiscountPercentage: 8 }], LaborItems: [] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].partInfo[0].dmsDiscountPercentage).toBe(8);
    });

    test('la stessa riconciliazione si applica a laborInfo', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [],
            laborInfo: [{ laborOperationCode: 'OP1', appDiscountPercentage: 15, dmsDiscountPercentage: 0 }],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [], LaborItems: [{ LaborOperationID: 'OP1', TimeUnit: 1, UnitaryTimeAmount: 10, DiscountPercentage: 5 }] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      expect(jobCardDetail.jobs[0].laborInfo[0].appDiscountPercentage).toBe(10); // 15 - 5
      expect(jobCardDetail.jobs[0].laborInfo[0].dmsDiscountPercentage).toBe(5);
    });

    // ── ricalcolo prezzi (part/labor) ────────────────────────────────────────

    test('ricalcola i prezzi di partInfo considerando la somma di appDiscountPercentage e dmsDiscountPercentage, con IVA', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{
              partNumber: 'P1', itemQuantity: 2, unitaryPriceExclVat: 100,
              appDiscountPercentage: 10, dmsDiscountPercentage: 0, vatPercentage: 22,
            }],
            laborInfo: [],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [{ PartNumber: 'P1', OriginalPriceExclVAT: 100, DiscountPercentage: 0 }], LaborItems: [] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      const part = jobCardDetail.jobs[0].partInfo[0];
      // originalPriceExclVat = 2 * 100 = 200; discount totale = 10 (appDiscountPercentage) + 0 (dmsDiscountPercentage, invariato: appDiscountPercentage!=0 e dmsDiscountPercentage=0 => branch che sottrae 0)
      expect(part.originalPriceExclVat).toBe(200);
      expect(part.originalPriceWithVat).toBeCloseTo(244, 5); // 200 * 1.22
      expect(part.priceExclVatAfterDiscount).toBeCloseTo(180, 5); // 200 * (1 - 10/100)
      expect(part.priceWithVatAfterDiscount).toBeCloseTo(219.6, 5); // 180 * 1.22
      expect(part.discountInAmountOnPriceWithVat).toBeCloseTo(24.4, 5); // 244 - 219.6
    });

    test('ricalcola laborRateAmount/prezzi di laborInfo considerando la somma di appDiscountPercentage e dmsDiscountPercentage, con IVA', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [],
            laborInfo: [{
              laborOperationCode: 'OP1', appDiscountPercentage: 0, dmsDiscountPercentage: 0, vatPercentage: 22,
            }],
          },
        ],
      };
      const dmlResponse = {
        WorkLines: [{ PartsItem: [], LaborItems: [{ LaborOperationID: 'OP1', TimeUnit: 2, UnitaryTimeAmount: 50, DiscountPercentage: 10 }] }],
      };

      applyDataFromDml(jobCardDetail, dmlResponse);

      const labor = jobCardDetail.jobs[0].laborInfo[0];
      // laborRateAmount = tariffa oraria (UnitaryTimeAmount) = 50
      // originalPriceExclVat = laborDuration(2) * laborRateAmount(50) = 100; discount totale = 0(app) + 10(dms) = 10
      expect(labor.laborRateAmount).toBe(50);
      expect(labor.originalPriceExclVat).toBe(100);
      expect(labor.originalPriceWithVat).toBeCloseTo(122, 5); // 100 * 1.22
      expect(labor.priceExclVatAfterDiscount).toBeCloseTo(90, 5); // 100 * (1 - 10/100)
      expect(labor.priceWithVatAfterDiscount).toBeCloseTo(109.8, 5); // 90 * 1.22
      expect(labor.discountInAmountOnPriceWithVat).toBeCloseTo(12.2, 5); // 122 - 109.8
    });

    test('leaves partInfo/laborInfo untouched when no matching PartNumber/LaborOperationID is found', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: 'UNMATCHED', originalPriceExclVat: 1 }],
            laborInfo: [{ laborOperationCode: 'UNMATCHED', laborDuration: 1 }],
          },
        ],
      };

      applyDataFromDml(jobCardDetail, { WorkLines: [] });

      expect(jobCardDetail.jobs[0].partInfo[0]).toEqual({ partNumber: 'UNMATCHED', originalPriceExclVat: 1 });
      expect(jobCardDetail.jobs[0].laborInfo[0]).toEqual({ laborOperationCode: 'UNMATCHED', laborDuration: 1 });
    });

    test('is a no-op (returns jobCardDetail unchanged) when jobs is not an array', () => {
      const jobCardDetail = { roInfo: {} };

      const result = applyDataFromDml(jobCardDetail, { WorkLines: [] });

      expect(result).toBe(jobCardDetail);
    });

    test('is invoked by getDataFromDML, enriching jobs with the DML response', async () => {
      const jobCardDetail = {
        roInfo: { jobCardSrpId: 'JCID-1' },
        vehicleInfo: { identification: { vin: 'VIN1' } },
        jobs: [
          {
            partInfo: [{ partNumber: 'P1', itemQuantity: 2, unitaryPriceExclVat: 21 }],
            laborInfo: [{ laborOperationCode: 'OP1' }],
          },
        ],
      };
      postDmsInquiry.mockResolvedValue({
        WorkLines: [
          {
            PartsItem: [{ PartNumber: 'P1', OriginalPriceExclVAT: 42, DiscountPercentage: 1, QuantityAvailable: 2 }],
            LaborItems: [{ LaborOperationID: 'OP1', TimeUnit: 0.5, DiscountPercentage: 1, UnitaryTimeAmount: 70 }],
          },
        ],
      });

      const result = await getDataFromDML(jobCardDetail);

      expect(result.jobs[0].partInfo[0]).toEqual(expect.objectContaining({
        unitaryPriceExclVat: 42, // da source.OriginalPriceExclVAT
        originalPriceExclVat: 84, // itemQuantity(2) * unitaryPriceExclVat(42)
        dmsDiscountPercentage: 1,
        QuantityAvailable: 2,
        availability: 'orange',
      }));
      expect(result.jobs[0].laborInfo[0]).toEqual(expect.objectContaining({
        laborDuration: 0.5,
        dmsDiscountPercentage: 1,
        laborRateAmount: 70,
      }));
    });
  });

  // ── getDataFromDMLFromTmp ────────────────────────────────────────────────

  describe('getDataFromDMLFromTmp', () => {
    test('throws if jobCardId is missing', async () => {
      await expect(getDataFromDMLFromTmp('')).rejects.toThrow('[jobCard] jobCardId is required');
      await expect(getDataFromDMLFromTmp(null)).rejects.toThrow('[jobCard] jobCardId is required');
      await expect(getDataFromDMLFromTmp(undefined)).rejects.toThrow('[jobCard] jobCardId is required');
    });

    test('regenerates the DynamoDB cache via getJobCardDetails when missing, then reads it', async () => {
      const regeneratedBody = {
        jobCardDetail: {
          roInfo: { jobCardSrpId: 'JCID-79' },
          vehicleInfo: { identification: { vin: 'VIN79' } },
          jobs: [],
        },
      };
      // Prima lettura fallisce (null), la seconda (dopo getJobCardDetails) ha successo
      getCacheItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(regeneratedBody);
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: regeneratedBody });
      postDmsInquiry.mockResolvedValue({ WorkLines: [] });

      const result = await getDataFromDMLFromTmp('79');

      expect(getDgtBearerToken).toHaveBeenCalledTimes(1);
      expect(httpsRequest).toHaveBeenCalledTimes(1); // getJobCardDetails -> DGT
      expect(getCacheItem).toHaveBeenCalledTimes(2);
      expect(getCacheItem).toHaveBeenCalledWith('jobcard:jobcarddetails:79');
      expect(result).toEqual(regeneratedBody);
    });

    test('throws if the DynamoDB cache still cannot be read after regeneration', async () => {
      getCacheItem.mockResolvedValue(null);
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

      await expect(getDataFromDMLFromTmp('79')).rejects.toThrow('impossibile leggere');
      expect(getDgtBearerToken).toHaveBeenCalledTimes(1);
    });

    test('uses the bearerToken passed explicitly instead of requesting a new one, when regenerating', async () => {
      const regeneratedBody = { jobCardDetail: { roInfo: {}, vehicleInfo: {}, jobs: [] } };
      getCacheItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(regeneratedBody);
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: regeneratedBody });
      postDmsInquiry.mockResolvedValue({ WorkLines: [] });

      await getDataFromDMLFromTmp('79', 'EXPLICIT-TOKEN');

      expect(getDgtBearerToken).not.toHaveBeenCalled();
    });

    test('reads the DynamoDB cache, applies getDataFromDML to jobCardDetail and returns the full body', async () => {
      const body = {
        jobCardDetail: {
          roInfo: { jobCardSrpId: 'JCID-1' },
          vehicleInfo: { identification: { vin: 'VIN1' } },
          jobs: [
            {
              partInfo: [{ partNumber: 'P1', itemQuantity: 2, unitaryPriceExclVat: 21 }],
              laborInfo: [],
            },
          ],
        },
      };
      getCacheItem.mockResolvedValue(body);
      postDmsInquiry.mockResolvedValue({
        WorkLines: [
          {
            PartsItem: [{ PartNumber: 'P1', OriginalPriceExclVAT: 42, DiscountPercentage: 1, QuantityAvailable: 2 }],
            LaborItems: [],
          },
        ],
      });

      const result = await getDataFromDMLFromTmp('79');

      expect(getCacheItem).toHaveBeenCalledWith('jobcard:jobcarddetails:79');
      expect(postDmsInquiry).toHaveBeenCalledWith('DML-TOKEN', expect.objectContaining({
        PartsInquiryHeader: expect.objectContaining({ DocumentID: 'JCID-1', VehicleID: 'VIN1' }),
      }));
      expect(result.jobCardDetail.jobs[0].partInfo[0]).toEqual(expect.objectContaining({
        unitaryPriceExclVat: 42, // da source.OriginalPriceExclVAT
        originalPriceExclVat: 84, // itemQuantity(2) * unitaryPriceExclVat(42)
        dmsDiscountPercentage: 1,
        QuantityAvailable: 2,
      }));
    });

    test('supports a cache item containing directly the jobCardDetail (no jobCardDetail wrapper)', async () => {
      const jobCardDetail = {
        roInfo: { jobCardSrpId: 'JCID-2' },
        vehicleInfo: { identification: { vin: 'VIN2' } },
        jobs: [],
      };
      getCacheItem.mockResolvedValue(jobCardDetail);
      postDmsInquiry.mockResolvedValue({ WorkLines: [] });

      const result = await getDataFromDMLFromTmp('80');

      expect(postDmsInquiry).toHaveBeenCalledWith('DML-TOKEN', expect.objectContaining({
        PartsInquiryHeader: expect.objectContaining({ DocumentID: 'JCID-2', VehicleID: 'VIN2' }),
      }));
      expect(result).toEqual(jobCardDetail);
    });
  });
});
