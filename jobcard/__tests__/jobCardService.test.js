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

const fs = require('fs');
const { httpsRequest } = require('../httpClient');
const { getJobCardList, getJobCardListCurrent, getJobCardDetails, saveJobCard } = require('../jobCardService');

describe('jobCardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
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
        status: overrides.status ?? 'BOOKED',
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

      expect(receptionOpts.headers.receptionStartDate).toBe('2026-05-20T00:00:00.000Z');
      expect(receptionOpts.headers.receptionEndDate).toBe('2026-05-21T00:00:00.000Z');

      expect(deliveryOpts.headers.deliveryStartDate).toBe('2026-05-20T00:00:00.000Z');
      expect(deliveryOpts.headers.deliveryEndDate).toBe('2026-05-21T00:00:00.000Z');

      expect(createdOpts.headers.creationStartDate).toBe('2026-05-13T00:00:00.000Z');
      expect(createdOpts.headers.creationEndDate).toBe('2026-05-20T23:59:59.999Z');
    });

    test('merges arrayReception, arrayDelivery and arrayCreated without duplicates', async () => {
      const cardA = jobCard({ jobCardSrpId: 'A' });
      const cardB = jobCard({ jobCardSrpId: 'B' });
      const cardC = jobCard({ jobCardSrpId: 'C' });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [cardA, cardB] } }) // reception
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [cardB] } })        // delivery (dup of B)
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [cardC] } });        // created

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList).toHaveLength(3);
      expect(result.jobCardList.map((c) => c.jobCardSrpId)).toEqual(['A', 'B', 'C']);
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

    test('excludes arrayCreated entries with status "CREATED"', async () => {
      const createdStatus = jobCard({ jobCardSrpId: 'G', status: 'CREATED' });
      const otherStatus    = jobCard({ jobCardSrpId: 'H', status: 'BOOKED' });

      httpsRequest
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [] } })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { jobCardList: [createdStatus, otherStatus] } });

      const result = await getJobCardListCurrent('token', '0062219', '2026-05-20');

      expect(result.jobCardList.map((c) => c.jobCardSrpId)).toEqual(['H']);
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
});
