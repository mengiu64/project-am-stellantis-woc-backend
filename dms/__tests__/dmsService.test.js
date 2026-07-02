'use strict';

jest.mock('../config', () => ({
  auth: {
    url: 'https://auth.test/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dmy',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
  dml: {
    baseUrl: 'https://api.dml.test',
    basePath: '/dms',
    inquiryBasePath: '/inquiry/DML/1.0',
    ibmClientId: 'ibm-id',
    ibmClientSecret: 'ibm-secret',
    xTargetEnv: 'stage',
  },
  sender: {
    componentId:          '1.0.0',
    dealerNumberId:       '0710736',
    dealerNumberIdSource: '0710736',
    dealerCountryCode:    'DE',
    languageCode:         'de-DE',
    physicalSiteId:       '00007532',
    serviceId:            'DE-0710736.D001',
    currencyId:           'EUR',
    brand:                'AP',
  },
}));
jest.mock('../httpClient');

const { httpsRequest } = require('../httpClient');
const { getDmsSettings, postDmsInquiry, buildTypeSection } = require('../dmsService');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SENDER = {
  ComponentID:          '1.0.0',
  DealerNumberID:       '0710736',
  DealerNumberIDSource: '0710736',
  DealerCountryCode:    'DE',
  LanguageCode:         'de-DE',
  PhysicalSiteID:       '00007532',
  ServiceID:            'DE-0710736.D001',
  CurrencyID:           'EUR',
  Brand:                'AP',
};

const APPLICATION_AREA = {
  Sender:           SENDER,
  CreationDateTime: '2024-11-18T11:47:23.487Z',
  BODID:            '11a8988f-75d2-404e-af15-e3efa26cb1da',
};

/** Minimal body — enough to pass validation */
const baseInquiryBody = () => ({
  ApplicationArea:    APPLICATION_AREA,
  PartsInquiryHeader: {
    DocumentID:    '84564621',
    CustomerIdDms: '854265',
    MessageType:   'LFP',
    VehicleID:     '3C4NJCBH7KT831816',
  },
});

/** Full LFP body matching LFP_1_Request.json */
const lfpBody = () => ({
  ApplicationArea:    APPLICATION_AREA,
  PartsInquiryHeader: { DocumentID: '84564621', CustomerIdDms: '854265', MessageType: 'LFP', VehicleID: '3C4NJCBH7KT831816' },
  UpSelling: { Packages: [{ Code: 'ABS0010021' }] },
});

/** Full WL body matching WL_Request.json */
const wlBody = () => ({
  ApplicationArea:    APPLICATION_AREA,
  PartsInquiryHeader: { DocumentID: '84564621', CustomerIdDms: '854265', MessageType: 'WL', VehicleID: '3C4NJCBH7KT831816' },
  WorkLines: [{
    CustomerAccountDMSID: '00123',
    WorkLineReference:    '002',
    TransactionType:      1,
    PartsItem: [{ PartNumber: 'K2AMV5012AD', PartType: 'L', PartStatus: 'O' }],
    LaborItem: [{ LaborOperationID: '0010A14', LaborType: 'L' }],
  }],
});

/** Full MP body matching MP_Request.json */
const mpBody = () => ({
  ApplicationArea:    APPLICATION_AREA,
  PartsInquiryHeader: { DocumentID: '84564621', CustomerIdDms: '854265', MessageType: 'MP', VehicleID: '3C4NJCBH7KT831816' },
  SpareParts: { PartsItem: [{ PartNumber: 'ABS0010021' }, { PartNumber: 'ABS0010022' }] },
});

describe('dmsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('throws if country is missing', async () => {
    await expect(getDmsSettings('token', { brand: 'FT', dealer: '0062230' }))
      .rejects.toThrow('[dms] country is required');
  });

  test('throws if brand is missing', async () => {
    await expect(getDmsSettings('token', { country: 'fr', dealer: '0062230' }))
      .rejects.toThrow('[dms] brand is required');
  });

  test('throws if dealer is missing', async () => {
    await expect(getDmsSettings('token', { country: 'fr', brand: 'FT' }))
      .rejects.toThrow('[dms] dealer is required');
  });

  test('calls httpsRequest with correct method GET and Authorization header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { dmsData: true } });

    await getDmsSettings('my-token', { country: 'fr', brand: 'FT', dealer: '0062230' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer my-token');
    expect(options.headers['X-IBM-Client-Id']).toBe('ibm-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('ibm-secret');
    expect(options.headers['X-Target-Env']).toBe('stage');
  });

  test('includes country, brand, dealer in query string', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.path).toContain('country=fr');
    expect(options.path).toContain('brand=FT');
    expect(options.path).toContain('dealer=0062230');
  });

  test('returns response body on success', async () => {
    const expectedBody = { setting1: 'value1', setting2: 'value2' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' });
    expect(result).toEqual(expectedBody);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 403, headers: {}, body: { error: 'forbidden' } });

    await expect(getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' }))
      .rejects.toThrow('[dms] settings failed: HTTP 403');
  });

  test('calls settings endpoint on correct hostname', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getDmsSettings('token', { country: 'fr', brand: 'FT', dealer: '0062230' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.hostname).toBe('api.dml.test');
    expect(options.path).toContain('/dms/settings');
  });
});

describe('postDmsInquiry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('throws if MessageType is missing', async () => {
    const body = baseInquiryBody();
    delete body.PartsInquiryHeader.MessageType;
    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] PartsInquiryHeader.MessageType is required');
  });

  test('throws if MessageType is invalid', async () => {
    const body = baseInquiryBody();
    body.PartsInquiryHeader.MessageType = 'INVALID';
    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] MessageType must be one of: LFP, WL, MP');
  });

  test('throws if DocumentID is missing', async () => {
    const body = baseInquiryBody();
    delete body.PartsInquiryHeader.DocumentID;
    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] PartsInquiryHeader.DocumentID is required');
  });

  test('throws if CustomerIdDms is missing', async () => {
    const body = baseInquiryBody();
    delete body.PartsInquiryHeader.CustomerIdDms;
    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] PartsInquiryHeader.CustomerIdDms is required');
  });

  test('throws if VehicleID is missing', async () => {
    const body = baseInquiryBody();
    delete body.PartsInquiryHeader.VehicleID;
    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] PartsInquiryHeader.VehicleID is required');
  });

  test.each(['LFP', 'WL', 'MP'])('accepts valid MessageType %s', async (type) => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    const body = baseInquiryBody();
    body.PartsInquiryHeader.MessageType = type;
    await expect(postDmsInquiry('token', body)).resolves.toBeDefined();
  });

  test('calls httpsRequest with method POST and correct path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    await postDmsInquiry('my-token', baseInquiryBody());

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.path).toBe('/inquiry/DML/1.0/inquiry');
    expect(options.hostname).toBe('api.dml.test');
  });

  test('sets Content-Type and Authorization headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    await postDmsInquiry('my-token', baseInquiryBody());

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers.Authorization).toBe('Bearer my-token');
    expect(options.headers['X-IBM-Client-Id']).toBe('ibm-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('ibm-secret');
    expect(options.headers['X-Target-Env']).toBe('stage');
  });

  test('passes serialised body as second argument to httpsRequest', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    const reqBody = baseInquiryBody();
    await postDmsInquiry('token', reqBody);

    const [, payload] = httpsRequest.mock.calls[0];
    expect(JSON.parse(payload)).toEqual(reqBody);
  });

  test('returns response body on success', async () => {
    const expected = { DmsInquiryHeader: { MessageType: 'LFP' } };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expected });

    const result = await postDmsInquiry('token', baseInquiryBody());
    expect(result).toEqual(expected);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: { error: 'server error' } });

    await expect(postDmsInquiry('token', baseInquiryBody()))
      .rejects.toThrow('[dms] inquiry failed: HTTP 500');
  });
});

// ── postDmsInquiry — real example bodies ─────────────────────────────────────

describe('postDmsInquiry — real example bodies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('LFP request: sends UpSelling.Packages in body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    await postDmsInquiry('token', lfpBody());

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader.MessageType).toBe('LFP');
    expect(sent.UpSelling.Packages).toEqual([{ Code: 'ABS0010021' }]);
    expect(sent.ApplicationArea.Sender.DealerNumberID).toBe('0710736');
  });

  test('WL request: sends WorkLines in body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    await postDmsInquiry('token', wlBody());

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader.MessageType).toBe('WL');
    expect(sent.WorkLines).toHaveLength(1);
    expect(sent.WorkLines[0].WorkLineReference).toBe('002');
    expect(sent.WorkLines[0].PartsItem[0].PartNumber).toBe('K2AMV5012AD');
    expect(sent.WorkLines[0].LaborItem[0].LaborOperationID).toBe('0010A14');
  });

  test('MP request: sends SpareParts.PartsItem in body', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    await postDmsInquiry('token', mpBody());

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader.MessageType).toBe('MP');
    expect(sent.SpareParts.PartsItem).toHaveLength(2);
    expect(sent.SpareParts.PartsItem[0].PartNumber).toBe('ABS0010021');
    expect(sent.SpareParts.PartsItem[1].PartNumber).toBe('ABS0010022');
  });
});

// ── buildTypeSection ──────────────────────────────────────────────────────────

describe('buildTypeSection', () => {
  test('LFP → returns UpSelling.Packages as empty array', () => {
    expect(buildTypeSection('LFP')).toEqual({ UpSelling: { Packages: [] } });
  });

  test('WL → returns WorkLines as empty array', () => {
    expect(buildTypeSection('WL')).toEqual({ WorkLines: [] });
  });

  test('MP → returns SpareParts.PartsItem as empty array', () => {
    expect(buildTypeSection('MP')).toEqual({ SpareParts: { PartsItem: [] } });
  });

  test('unknown type → returns empty object', () => {
    expect(buildTypeSection('UNKNOWN')).toEqual({});
    expect(buildTypeSection(undefined)).toEqual({});
  });
});
