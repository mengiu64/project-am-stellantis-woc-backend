'use strict';

jest.mock('../config', () => ({
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
}));
jest.mock('../httpClient');
jest.mock('fs');
jest.mock('../../dms/authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../../dms/dmsService', () => ({ postDmsInquiry: jest.fn() }));

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getBearerToken } = require('../../dms/authService');
const { postDmsInquiry } = require('../../dms/dmsService');
const { getJobCardList, getJobCardListCurrent, getJobCardDetails, saveJobCard, getCartPriceAndAvailability, applyDataFromDml, getDataFromDML, getDataFromDMLFromTmp } = require('../jobCardService');

describe('jobCardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    getBearerToken.mockResolvedValue('DML-TOKEN');
    postDmsInquiry.mockResolvedValue({ success: true });
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

  // ── /tmp persistence (readable later by djc lambda) ─────────────────────────

  test('saves the sanitized response body to /tmp/<jobCardId>.json', async () => {
    const body = { jobCardId: '79', jobCardDetail: { roInfo: { foo: 'bar' } } };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    await getJobCardDetails('token', '79');

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content, encoding] = fs.writeFileSync.mock.calls[0];
    expect(filePath).toBe('/tmp/79.json');
    expect(JSON.parse(content)).toEqual(body);
    expect(encoding).toBe('utf8');
  });

  test('uses the numeric jobCardId (converted to string) as the file name', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getJobCardDetails('token', 79);

    const [filePath] = fs.writeFileSync.mock.calls[0];
    expect(filePath).toBe('/tmp/79.json');
  });

  test('still returns the response even if writing to /tmp fails', async () => {
    const body = { jobCardId: '79' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    await expect(getJobCardDetails('token', '79')).resolves.toEqual(body);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('impossibile salvare jobCardDetails'));
  });

  test('does not write to /tmp when the request fails', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 404, headers: {}, body: { message: 'not found' } });

    await expect(getJobCardDetails('token', '99')).rejects.toThrow();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('does not write to /tmp when jobCardId is missing', async () => {
    await expect(getJobCardDetails('token', '')).rejects.toThrow();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
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

  // ── applyDataFromDml ─────────────────────────────────────────────────────

  describe('applyDataFromDml', () => {
    test('overwrites originalPriceExclVat/dmsDiscountPercentage/QuantityAvailable/availability on matching partInfo by PartNumber', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: '735712563', originalPriceExclVat: 1, itemQuantity: 2 }],
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
        originalPriceExclVat: 493.71,
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

    test('uses ReplacementItem data (including partNumber/partDescription) when the PartsItem has a replacement', () => {
      const jobCardDetail = {
        jobs: [
          {
            partInfo: [{ partNumber: '1610489680', partDescription: 'original desc', itemQuantity: 1 }],
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
        partNumber: '12347411',
        partDescription: 'PR de remplacement',
        originalPriceExclVat: 80,
        dmsDiscountPercentage: 0,
        QuantityAvailable: 0,
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
            partInfo: [{ partNumber: 'P1', itemQuantity: 2 }],
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
        originalPriceExclVat: 42,
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

    test('throws if /tmp/<jobCardId>.json cannot be read', async () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      await expect(getDataFromDMLFromTmp('79')).rejects.toThrow('impossibile leggere');
    });

    test('reads /tmp/<jobCardId>.json, applies getDataFromDML to jobCardDetail and returns the full body', async () => {
      const body = {
        jobCardDetail: {
          roInfo: { jobCardSrpId: 'JCID-1' },
          vehicleInfo: { identification: { vin: 'VIN1' } },
          jobs: [
            {
              partInfo: [{ partNumber: 'P1', itemQuantity: 2 }],
              laborInfo: [],
            },
          ],
        },
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(body));
      postDmsInquiry.mockResolvedValue({
        WorkLines: [
          {
            PartsItem: [{ PartNumber: 'P1', OriginalPriceExclVAT: 42, DiscountPercentage: 1, QuantityAvailable: 2 }],
            LaborItems: [],
          },
        ],
      });

      const result = await getDataFromDMLFromTmp('79');

      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('79.json'), 'utf8');
      expect(postDmsInquiry).toHaveBeenCalledWith('DML-TOKEN', expect.objectContaining({
        PartsInquiryHeader: expect.objectContaining({ DocumentID: 'JCID-1', VehicleID: 'VIN1' }),
      }));
      expect(result.jobCardDetail.jobs[0].partInfo[0]).toEqual(expect.objectContaining({
        originalPriceExclVat: 42,
        dmsDiscountPercentage: 1,
        QuantityAvailable: 2,
      }));
    });

    test('supports a /tmp file containing directly the jobCardDetail (no jobCardDetail wrapper)', async () => {
      const jobCardDetail = {
        roInfo: { jobCardSrpId: 'JCID-2' },
        vehicleInfo: { identification: { vin: 'VIN2' } },
        jobs: [],
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(jobCardDetail));
      postDmsInquiry.mockResolvedValue({ WorkLines: [] });

      const result = await getDataFromDMLFromTmp('80');

      expect(postDmsInquiry).toHaveBeenCalledWith('DML-TOKEN', expect.objectContaining({
        PartsInquiryHeader: expect.objectContaining({ DocumentID: 'JCID-2', VehicleID: 'VIN2' }),
      }));
      expect(result).toEqual(jobCardDetail);
    });
  });
});
