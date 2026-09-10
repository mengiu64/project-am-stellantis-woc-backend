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
    settingsPath: '/ps-dev/extra/dml/dms-settings/v1/settings',
    inquiryPath: '/ps-dev/extra/dml/aftersales/v1/inquiry',
    companyTypesPath: '/ps-dev/extra/dml/configurations/v1/company-types',
    customerTitlesPath: '/ps-dev/extra/dml/configurations/v1/customer-titles',
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
jest.mock('../../dbManager/db', () => ({ getPool: jest.fn() }));
jest.mock('../../dbManager/AnagSnowflakesRepository', () => ({ getPhysicalSiteAndSincom: jest.fn() }));

const { httpsRequest } = require('../httpClient');
const { getPool } = require('../../dbManager/db');
const { getPhysicalSiteAndSincom } = require('../../dbManager/AnagSnowflakesRepository');
const { getDmsSettings, getCompanyTypes, getCustomerTitles, postDmsInquiry, buildTypeSection, buildUpSellingPackages, buildWorkLines, buildApplicationArea } = require('../dmsService');

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

/** Minimal body — enough to pass validation for a given MessageType (default LFP) */
const baseInquiryBody = (type = 'LFP') => ({
  ApplicationArea:    APPLICATION_AREA,
  PartsInquiryHeader: {
    DocumentID:    '84564621',
    CustomerIdDms: '854265',
    MessageType:   type,
    VehicleID:     '3C4NJCBH7KT831816',
  },
  ...buildTypeSection(type),
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
    expect(options.path).toContain('/ps-dev/extra/dml/dms-settings/v1/settings');
  });
});

describe.each([
  ['getCompanyTypes', () => getCompanyTypes, '/ps-dev/extra/dml/configurations/v1/company-types', 'company-types'],
  ['getCustomerTitles', () => getCustomerTitles, '/ps-dev/extra/dml/configurations/v1/customer-titles', 'customer-titles'],
])('%s', (_name, getFn, expectedPath, label) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('throws if country is missing', async () => {
    await expect(getFn()('token', { language: 'fr' }))
      .rejects.toThrow('[dms] country is required');
  });

  test('throws if language is missing', async () => {
    await expect(getFn()('token', { country: 'fr' }))
      .rejects.toThrow('[dms] language is required');
  });

  test('calls httpsRequest with correct method GET and Authorization header', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { data: true } });

    await getFn()('my-token', { country: 'fr', language: 'fr' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer my-token');
    expect(options.headers['X-IBM-Client-Id']).toBe('ibm-id');
    expect(options.headers['X-IBM-Client-Secret']).toBe('ibm-secret');
    expect(options.headers['X-Target-Env']).toBe('stage');
  });

  test('includes country and language in query string', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getFn()('token', { country: 'FR', language: 'fr' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.path).toContain('country=FR');
    expect(options.path).toContain('language=fr');
  });

  test('returns response body on success', async () => {
    const expectedBody = { value: 'value1' };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: expectedBody });

    const result = await getFn()('token', { country: 'fr', language: 'fr' });
    expect(result).toEqual(expectedBody);
  });

  test('throws on HTTP error', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 403, headers: {}, body: { error: 'forbidden' } });

    await expect(getFn()('token', { country: 'fr', language: 'fr' }))
      .rejects.toThrow(`[dms] ${label} failed: HTTP 403`);
  });

  test('does not retry on non-transient HTTP errors (e.g. 403): only 1 call', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 403, headers: {}, body: { error: 'forbidden' } });

    await expect(getFn()('token', { country: 'fr', language: 'fr' })).rejects.toThrow();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  test('retries on transient HTTP errors (502/503/504) and succeeds once the gateway recovers', async () => {
    httpsRequest
      .mockResolvedValueOnce({ statusCode: 502, headers: {}, body: { message: 'Internal server error' } })
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: { success: true, data: [] } });

    const result = await getFn()('token', { country: 'fr', language: 'fr' });

    expect(result).toEqual({ success: true, data: [] });
    expect(httpsRequest).toHaveBeenCalledTimes(2);
  });

  test('gives up after exhausting retries on persistent transient errors (502/503/504)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 502, headers: {}, body: { message: 'Internal server error' } });

    await expect(getFn()('token', { country: 'fr', language: 'fr' }))
      .rejects.toThrow(`[dms] ${label} failed: HTTP 502`);
    expect(httpsRequest).toHaveBeenCalledTimes(3);
  });

  test('returns { success: false, data: [] } on HTTP 404 (no data for the given params), does not throw', async () => {
    httpsRequest.mockResolvedValue({
      statusCode: 404,
      headers: {},
      body: { success: false, message: `No ${label} found for the given parameters` },
    });

    const result = await getFn()('token', { country: 'fr', language: 'fr' });
    expect(result).toEqual({ success: false, data: [] });
  });

  test('calls endpoint on correct hostname and path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await getFn()('token', { country: 'fr', language: 'fr' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.hostname).toBe('api.dml.test');
    expect(options.path).toContain(expectedPath);
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

  test('sends DocumentID as empty string when missing (not required, but always present in payload)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    const body = baseInquiryBody();
    delete body.PartsInquiryHeader.DocumentID;

    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader).toHaveProperty('DocumentID', '');
  });

  test('sends DocumentID as empty string when explicitly null', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    const body = baseInquiryBody();
    body.PartsInquiryHeader.DocumentID = null;

    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader).toHaveProperty('DocumentID', '');
  });

  test('sends CustomerIdDms as null when missing (not required, but always present in payload)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    const body = baseInquiryBody();
    delete body.PartsInquiryHeader.CustomerIdDms;

    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader).toHaveProperty('CustomerIdDms', null);
  });

  test('throws if VehicleID is missing', async () => {
    const body = baseInquiryBody();
    delete body.PartsInquiryHeader.VehicleID;
    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] PartsInquiryHeader.VehicleID is required');
  });

  test.each(['LFP', 'WL', 'MP'])('accepts valid MessageType %s', async (type) => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    const body = baseInquiryBody(type);
    await expect(postDmsInquiry('token', body)).resolves.toBeDefined();
  });

  test('calls httpsRequest with method POST and correct path', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    await postDmsInquiry('my-token', baseInquiryBody());

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.path).toBe('/ps-dev/extra/dml/aftersales/v1/inquiry');
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

// ── postDmsInquiry — ApplicationArea owned by the lambda ─────────────────────
// Il payload non è più interamente delegato a chi chiama la lambda: se il
// chiamante non fornisce già un ApplicationArea, questo viene generato
// internamente da postDmsInquiry() usando config.sender.

describe('postDmsInquiry — ApplicationArea built internally', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('builds ApplicationArea from config.sender when caller omits it', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      PartsInquiryHeader: {
        DocumentID: '84564621',
        CustomerIdDms: '854265',
        MessageType: 'WL',
        VehicleID: '3C4NJCBH7KT831816',
      },
      WorkLines: [],
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.ApplicationArea.Sender).toEqual(SENDER);
    expect(sent.ApplicationArea.BODID).toEqual(expect.any(String));
    expect(sent.ApplicationArea.CreationDateTime).toEqual(expect.any(String));
  });

  test('generates a different BODID on each call when ApplicationArea is omitted', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      PartsInquiryHeader: {
        DocumentID: '84564621',
        CustomerIdDms: '854265',
        MessageType: 'WL',
        VehicleID: '3C4NJCBH7KT831816',
      },
      WorkLines: [],
    };
    await postDmsInquiry('token', body);
    await postDmsInquiry('token', body);

    const [, firstPayload] = httpsRequest.mock.calls[0];
    const [, secondPayload] = httpsRequest.mock.calls[1];
    expect(JSON.parse(firstPayload).ApplicationArea.BODID)
      .not.toEqual(JSON.parse(secondPayload).ApplicationArea.BODID);
  });

  test('does not overwrite ApplicationArea when caller provides one', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await postDmsInquiry('token', baseInquiryBody());

    const [, payload] = httpsRequest.mock.calls[0];
    expect(JSON.parse(payload).ApplicationArea).toEqual(APPLICATION_AREA);
  });

  test('overrides Sender fields from body.sender with the real dealer/brand/market of the request', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      PartsInquiryHeader: {
        DocumentID: '84564621',
        CustomerIdDms: '854265',
        MessageType: 'WL',
        VehicleID: '3C4NJCBH7KT831816',
      },
      WorkLines: [],
      sender: {
        dealerNumberId: '0710740',
        dealerNumberIdSource: '0710740',
        dealerCountryCode: 'IT',
        languageCode: 'it-IT',
        physicalSiteId: 'SITE99',
        brand: 'FT',
      },
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.ApplicationArea.Sender).toEqual({
      // ComponentID/ServiceID/CurrencyID non sovrascritti: restano il default
      // di config.sender perché non presenti in body.sender.
      ComponentID: '1.0.0',
      DealerNumberID: '0710740',
      DealerNumberIDSource: '0710740',
      DealerCountryCode: 'IT',
      LanguageCode: 'it-IT',
      PhysicalSiteID: 'SITE99',
      ServiceID: 'DE-0710736.D001',
      CurrencyID: 'EUR',
      Brand: 'FT',
    });
  });

  test('does not send body.sender as-is on the wire (consumed to build ApplicationArea)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      PartsInquiryHeader: {
        DocumentID: '84564621',
        CustomerIdDms: '854265',
        MessageType: 'WL',
        VehicleID: '3C4NJCBH7KT831816',
      },
      WorkLines: [],
      sender: { brand: 'FT' },
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    expect(JSON.parse(payload).sender).toBeUndefined();
  });

  test('ignores body.sender null/undefined field values, keeping config.sender defaults for those', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      PartsInquiryHeader: {
        DocumentID: '84564621',
        CustomerIdDms: '854265',
        MessageType: 'WL',
        VehicleID: '3C4NJCBH7KT831816',
      },
      WorkLines: [],
      sender: { brand: 'FT', dealerCountryCode: undefined, languageCode: null },
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sender = JSON.parse(payload).ApplicationArea.Sender;
    expect(sender.Brand).toBe('FT');
    expect(sender.DealerCountryCode).toBe('DE');
    expect(sender.LanguageCode).toBe('de-DE');
  });

  test('ignores body.sender when caller already provides ApplicationArea', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await postDmsInquiry('token', { ...baseInquiryBody(), sender: { brand: 'IGNORED' } });

    const [, payload] = httpsRequest.mock.calls[0];
    expect(JSON.parse(payload).ApplicationArea).toEqual(APPLICATION_AREA);
  });
});

// ── buildApplicationArea / postDmsInquiry — physicalSiteId/dealerNumberIdSource
// dinamici centralizzati (woc.ang_snowflakes) ────────────────────────────────
// Logica precedentemente duplicata in jobcard/jobCardService.js::buildDmsSender
// e pkManager/PkManager.js::_buildDmsSender, ora centralizzata qui: qualunque
// chiamante di postDmsInquiry (jobcard, pkManager, pkFavorite, ...) beneficia
// dello stesso identico meccanismo/stessi criteri passando dealerNumberId +
// market (solo chiave di lookup, non un campo Sender) + brand in body.sender.

describe('buildApplicationArea — dynamic physicalSiteId/dealerNumberIdSource (woc.ang_snowflakes)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    getPool.mockResolvedValue({ fakePool: true });
  });

  afterEach(() => console.warn.mockRestore());

  test('does not perform DB lookup when market is missing', async () => {
    const area = await buildApplicationArea({ dealerNumberId: '0710740', brand: 'FT' });
    expect(getPhysicalSiteAndSincom).not.toHaveBeenCalled();
    expect(area.Sender.PhysicalSiteID).toBe('00007532'); // default statico di config.sender
  });

  test('does not perform DB lookup when brand is missing', async () => {
    const area = await buildApplicationArea({ dealerNumberId: '0710740', market: '1000' });
    expect(getPhysicalSiteAndSincom).not.toHaveBeenCalled();
    expect(area.Sender.PhysicalSiteID).toBe('00007532');
  });

  test('does not perform DB lookup when dealerNumberId is missing', async () => {
    const area = await buildApplicationArea({ market: '1000', brand: 'FT' });
    expect(getPhysicalSiteAndSincom).not.toHaveBeenCalled();
    expect(area.Sender.PhysicalSiteID).toBe('00007532');
  });

  test('performs DB lookup and overrides physicalSiteId/dealerNumberIdSource when all three are present', async () => {
    getPhysicalSiteAndSincom.mockResolvedValue({ physicalSiteId: 'SITE-DYN', dealerNumberIdSource: 'SRC-DYN' });

    const area = await buildApplicationArea({ dealerNumberId: '0710740', market: '1000', brand: 'FT' });

    expect(getPhysicalSiteAndSincom).toHaveBeenCalledWith({ fakePool: true }, {
      mainSincom: '0710740',
      market: '1000',
      brand: 'FT',
    });
    expect(area.Sender.PhysicalSiteID).toBe('SITE-DYN');
    expect(area.Sender.DealerNumberIDSource).toBe('SRC-DYN');
  });

  test('does not send `market` on the wire as a Sender field', async () => {
    getPhysicalSiteAndSincom.mockResolvedValue({ physicalSiteId: 'SITE-DYN', dealerNumberIdSource: 'SRC-DYN' });

    const area = await buildApplicationArea({ dealerNumberId: '0710740', market: '1000', brand: 'FT' });

    expect(area.Sender.market).toBeUndefined();
    expect(area.Sender.Market).toBeUndefined();
  });

  test('falls back to existing values when the DB lookup fails, without throwing', async () => {
    getPhysicalSiteAndSincom.mockRejectedValue(new Error('DB down'));

    const area = await buildApplicationArea({ dealerNumberId: '0710740', dealerNumberIdSource: '0710740', market: '1000', brand: 'FT' });

    expect(area.Sender.PhysicalSiteID).toBe('00007532');
    expect(area.Sender.DealerNumberIDSource).toBe('0710740'); // valore esplicito passato in senderOverrides, non sovrascritto
    expect(console.warn).toHaveBeenCalled();
  });

  test('falls back to existing values when the DB lookup resolves null fields', async () => {
    getPhysicalSiteAndSincom.mockResolvedValue({ physicalSiteId: null, dealerNumberIdSource: null });

    const area = await buildApplicationArea({ dealerNumberId: '0710740', market: '1000', brand: 'FT' });

    expect(area.Sender.PhysicalSiteID).toBe('00007532');
  });

  test('postDmsInquiry propagates body.sender.market through to buildApplicationArea', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
    getPhysicalSiteAndSincom.mockResolvedValue({ physicalSiteId: 'SITE-DYN', dealerNumberIdSource: 'SRC-DYN' });

    await postDmsInquiry('token', {
      PartsInquiryHeader: { DocumentID: '1', CustomerIdDms: '2', MessageType: 'WL', VehicleID: 'VIN' },
      WorkLines: [],
      sender: { dealerNumberId: '0710740', market: '1000', brand: 'FT' },
    });

    expect(getPhysicalSiteAndSincom).toHaveBeenCalledWith({ fakePool: true }, {
      mainSincom: '0710740',
      market: '1000',
      brand: 'FT',
    });
    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.ApplicationArea.Sender.PhysicalSiteID).toBe('SITE-DYN');
    expect(sent.sender).toBeUndefined();
  });
});

// ── postDmsInquiry — LFP UpSelling.Packages built from package ──────────
// Per LFP il chiamante non deve conoscere lo schema DML (Packages come array
// di oggetti { Code }): passa solo package (stringa o array di identificativi,
// codice o nome) e la lambda costruisce UpSelling.Packages, esattamente come
// fa per ApplicationArea.

describe('postDmsInquiry — UpSelling built from package (LFP)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  const lfpHeaderOnlyBody = () => ({
    PartsInquiryHeader: {
      DocumentID: '84564621',
      CustomerIdDms: '854265',
      MessageType: 'LFP',
      VehicleID: '3C4NJCBH7KT831816',
    },
  });

  test('builds UpSelling.Packages from package when UpSelling is omitted', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = { ...lfpHeaderOnlyBody(), package: ['ABC', 'DEF'] };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.UpSelling).toEqual({ Packages: [{ Code: 'ABC' }, { Code: 'DEF' }] });
  });

  test('does not leak package in the outgoing payload', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = { ...lfpHeaderOnlyBody(), package: ['ABC'] };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    expect(JSON.parse(payload).package).toBeUndefined();
  });

  test('does not overwrite UpSelling when caller already provides it, even with package set', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      ...lfpHeaderOnlyBody(),
      UpSelling: { Packages: [{ Code: 'ALREADY-BUILT' }] },
      package: ['IGNORED'],
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    expect(JSON.parse(payload).UpSelling).toEqual({ Packages: [{ Code: 'ALREADY-BUILT' }] });
  });

  test('still rejects LFP when neither UpSelling nor package are provided', async () => {
    await expect(postDmsInquiry('token', lfpHeaderOnlyBody()))
      .rejects.toThrow('[dms] MessageType LFP requires body.UpSelling');
  });

  test('accepts a single string for package (not just an array)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = { ...lfpHeaderOnlyBody(), package: 'FORFAIT' };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.UpSelling).toEqual({ Packages: [{ Code: 'FORFAIT' }] });
  });
});

// ── postDmsInquiry — PartsInquiryHeader built from flat root-level fields ────
// Scorciatoia "flat": il chiamante può passare DocumentID/CustomerIdDms/
// MessageType/VehicleID direttamente a livello root del body (senza annidarli
// in PartsInquiryHeader), utile per chiamare la lambda HTTP senza conoscere lo
// schema DML.

describe('postDmsInquiry — PartsInquiryHeader built from flat fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test('builds PartsInquiryHeader from flat root-level fields when omitted', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      DocumentID: '84564621',
      CustomerIdDms: '854265',
      MessageType: 'LFP',
      VehicleID: '3C4NJCBH7KT831816',
      package: 'FORFAIT',
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader).toEqual({
      DocumentID: '84564621',
      CustomerIdDms: '854265',
      MessageType: 'LFP',
      VehicleID: '3C4NJCBH7KT831816',
    });
  });

  test('does not leak flat root-level fields in the outgoing payload', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      DocumentID: '84564621',
      CustomerIdDms: '854265',
      MessageType: 'LFP',
      VehicleID: '3C4NJCBH7KT831816',
      package: 'FORFAIT',
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.DocumentID).toBeUndefined();
    expect(sent.CustomerIdDms).toBeUndefined();
    expect(sent.MessageType).toBeUndefined();
    expect(sent.VehicleID).toBeUndefined();
  });

  test('defaults CustomerIdDms to null when omitted from the flat root-level fields', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      DocumentID: '84564621',
      MessageType: 'LFP',
      VehicleID: '3C4NJCBH7KT831816',
      package: 'FORFAIT',
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader).toHaveProperty('CustomerIdDms', null);
  });

  test('does not overwrite PartsInquiryHeader when caller already provides it, even with flat fields set', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      PartsInquiryHeader: {
        DocumentID: 'NESTED-DOC',
        CustomerIdDms: 'NESTED-CUST',
        MessageType: 'LFP',
        VehicleID: 'NESTED-VIN',
      },
      // These flat fields should be ignored since PartsInquiryHeader is already provided.
      DocumentID: 'FLAT-DOC',
      CustomerIdDms: 'FLAT-CUST',
      VehicleID: 'FLAT-VIN',
      package: 'FORFAIT',
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader).toEqual({
      DocumentID: 'NESTED-DOC',
      CustomerIdDms: 'NESTED-CUST',
      MessageType: 'LFP',
      VehicleID: 'NESTED-VIN',
    });
  });

  test('still rejects when neither PartsInquiryHeader nor flat fields are provided', async () => {
    await expect(postDmsInquiry('token', { package: 'FORFAIT' }))
      .rejects.toThrow('[dms] PartsInquiryHeader.MessageType is required');
  });
});

// ── postDmsInquiry — WL WorkLines built from workLines (semplificate) ───────
// Per WL il chiamante non deve conoscere lo schema DML nidificato (WorkLines
// con PartsItem/LaborItem, PartType/PartStatus/LaborType): passa solo
// workLines semplificate (workLineReference + partNumbers/laborOperationIds)
// più un customerAccountDmsId unico ripetuto su ogni riga, e la lambda
// costruisce WorkLines, esattamente come fa per UpSelling.Packages (LFP).

describe('postDmsInquiry — WorkLines built from workLines (WL)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  const wlHeaderOnlyBody = () => ({
    PartsInquiryHeader: {
      DocumentID: '84564621',
      CustomerIdDms: '854265',
      MessageType: 'WL',
      VehicleID: '3C4NJCBH7KT831816',
    },
  });

  test('builds WorkLines from workLines when WorkLines is omitted', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      ...wlHeaderOnlyBody(),
      customerAccountDmsId: null,
      workLines: [
        { workLineReference: '054065705406', partNumbers: ['12667457', '1684471080'], laborOperationIds: ['0602153'] },
        { workLineReference: '054065705406', partNumbers: ['K2AMV5012AD'], laborOperationIds: [] },
      ],
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.WorkLines).toEqual([
      {
        CustomerAccountDMSID: null,
        WorkLineReference: '054065705406',
        TransactionType: 1,
        PartsItem: [
          { PartNumber: '12667457', PartType: 'L', PartStatus: 'O' },
          { PartNumber: '1684471080', PartType: 'L', PartStatus: 'O' },
        ],
        LaborItem: [{ LaborOperationID: '0602153', LaborType: 'L' }],
      },
      {
        CustomerAccountDMSID: null,
        WorkLineReference: '054065705406',
        TransactionType: 1,
        PartsItem: [{ PartNumber: 'K2AMV5012AD', PartType: 'L', PartStatus: 'O' }],
        LaborItem: [],
      },
    ]);
  });

  test('applies the shared customerAccountDmsId to every generated WorkLine', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      ...wlHeaderOnlyBody(),
      customerAccountDmsId: '00123',
      workLines: [
        { workLineReference: '001', partNumbers: ['A'], laborOperationIds: [] },
        { workLineReference: '002', partNumbers: ['B'], laborOperationIds: [] },
      ],
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.WorkLines.map((wl) => wl.CustomerAccountDMSID)).toEqual(['00123', '00123']);
  });

  test('does not leak workLines/customerAccountDmsId in the outgoing payload', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const body = {
      ...wlHeaderOnlyBody(),
      customerAccountDmsId: '00123',
      workLines: [{ workLineReference: '001', partNumbers: ['A'], laborOperationIds: [] }],
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.workLines).toBeUndefined();
    expect(sent.customerAccountDmsId).toBeUndefined();
  });

  test('does not overwrite WorkLines when caller already provides it, even with workLines set', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    const prebuilt = [{
      CustomerAccountDMSID: '00123',
      WorkLineReference: '002',
      TransactionType: 1,
      PartsItem: [{ PartNumber: 'K2AMV5012AD', PartType: 'L', PartStatus: 'O' }],
      LaborItem: [{ LaborOperationID: '0010A14', LaborType: 'L' }],
    }];
    const body = {
      ...wlHeaderOnlyBody(),
      WorkLines: prebuilt,
      workLines: [{ workLineReference: 'IGNORED', partNumbers: [], laborOperationIds: [] }],
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    expect(JSON.parse(payload).WorkLines).toEqual(prebuilt);
  });

  test('still rejects WL when neither WorkLines nor workLines are provided', async () => {
    await expect(postDmsInquiry('token', wlHeaderOnlyBody()))
      .rejects.toThrow('[dms] MessageType WL requires body.WorkLines');
  });

  test('sends CustomerIdDms and CustomerAccountDMSID as null when omitted from a flat WL body (not required, but always present in payload)', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    // Body flat come inviato dal chiamante HTTP: nessun CustomerIdDms né
    // customerAccountDmsId — entrambi non obbligatori, ma il DML si aspetta
    // comunque le chiavi presenti (CustomerIdDms in PartsInquiryHeader,
    // CustomerAccountDMSID in ogni WorkLines).
    const body = {
      DocumentID: '84564621',
      VehicleID: '3C4NJCBH7KT831816',
      MessageType: 'WL',
      workLines: [
        { workLineReference: '002', partNumbers: ['K2AMV5012AD'], laborOperationIds: ['0010A14'] },
      ],
    };
    await postDmsInquiry('token', body);

    const [, payload] = httpsRequest.mock.calls[0];
    const sent = JSON.parse(payload);
    expect(sent.PartsInquiryHeader).toHaveProperty('CustomerIdDms', null);
    expect(sent.WorkLines[0]).toHaveProperty('CustomerAccountDMSID', null);
  });
});

// ── postDmsInquiry — type-specific section owned by the lambda ──────────────
// In base al MessageType deve essere usata la sezione corretta del payload
// (LFP → UpSelling, WL → WorkLines, MP → SpareParts): la lambda valida che sia
// presente la sezione giusta e che non ce ne siano altre, invece di fidarsi
// ciecamente di quanto costruito dal chiamante.

describe('postDmsInquiry — type-specific section validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => console.log.mockRestore());

  test.each([
    ['LFP', 'UpSelling'],
    ['WL', 'WorkLines'],
    ['MP', 'SpareParts'],
  ])('rejects MessageType %s when body.%s is missing', async (type, expectedKey) => {
    const body = baseInquiryBody(type);
    delete body[expectedKey];

    await expect(postDmsInquiry('token', body))
      .rejects.toThrow(`[dms] MessageType ${type} requires body.${expectedKey}`);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('rejects MessageType WL when body contains SpareParts instead of WorkLines', async () => {
    const body = baseInquiryBody('WL');
    delete body.WorkLines;
    body.SpareParts = { PartsItem: [] };

    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] MessageType WL requires body.WorkLines');
  });

  test('rejects MessageType WL when body also includes UpSelling', async () => {
    const body = baseInquiryBody('WL');
    body.UpSelling = { Packages: [] };

    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] MessageType WL must not include: UpSelling');
  });

  test('rejects MessageType LFP when body also includes WorkLines and SpareParts', async () => {
    const body = baseInquiryBody('LFP');
    body.WorkLines = [];
    body.SpareParts = { PartsItem: [] };

    await expect(postDmsInquiry('token', body))
      .rejects.toThrow('[dms] MessageType LFP must not include: WorkLines, SpareParts');
  });

  test.each(['LFP', 'WL', 'MP'])('accepts MessageType %s with only its own section', async (type) => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await expect(postDmsInquiry('token', baseInquiryBody(type))).resolves.toBeDefined();
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

describe('buildUpSellingPackages', () => {
  test('maps an array of codes to Packages objects', () => {
    expect(buildUpSellingPackages(['ABC', 'DEF'])).toEqual({
      Packages: [{ Code: 'ABC' }, { Code: 'DEF' }],
    });
  });

  test('defaults to an empty Packages array when called without arguments', () => {
    expect(buildUpSellingPackages()).toEqual({ Packages: [] });
  });
});

describe('buildWorkLines', () => {
  test('maps simplified work lines to the full DML WorkLines structure', () => {
    const result = buildWorkLines(
      [{ workLineReference: '002', partNumbers: ['K2AMV5012AD'], laborOperationIds: ['0010A14'] }],
      '00123'
    );

    expect(result).toEqual([{
      CustomerAccountDMSID: '00123',
      WorkLineReference: '002',
      TransactionType: 1,
      PartsItem: [{ PartNumber: 'K2AMV5012AD', PartType: 'L', PartStatus: 'O' }],
      LaborItem: [{ LaborOperationID: '0010A14', LaborType: 'L' }],
    }]);
  });

  test('repeats the same customerAccountDmsId across multiple lines, preserving duplicate references', () => {
    const result = buildWorkLines(
      [
        { workLineReference: '054065705406', partNumbers: ['A'] },
        { workLineReference: '054065705406', partNumbers: ['B'] },
      ],
      null
    );

    expect(result.map((wl) => wl.CustomerAccountDMSID)).toEqual([null, null]);
    expect(result.map((wl) => wl.WorkLineReference)).toEqual(['054065705406', '054065705406']);
  });

  test('lets a line override the shared customerAccountDmsId', () => {
    const result = buildWorkLines(
      [{ workLineReference: '001', customerAccountDmsId: 'OVERRIDE', partNumbers: [] }],
      'DEFAULT'
    );

    expect(result[0].CustomerAccountDMSID).toBe('OVERRIDE');
  });

  test('defaults missing partNumbers/laborOperationIds to empty arrays and TransactionType to 1', () => {
    expect(buildWorkLines([{ workLineReference: '001' }])).toEqual([{
      CustomerAccountDMSID: null,
      WorkLineReference: '001',
      TransactionType: 1,
      PartsItem: [],
      LaborItem: [],
    }]);
  });

  test('defaults to an empty array when called without arguments', () => {
    expect(buildWorkLines()).toEqual([]);
  });

  test('throws when a work line is missing workLineReference', () => {
    expect(() => buildWorkLines([{ partNumbers: ['A'] }]))
      .toThrow('[dms] workLines[0].workLineReference is required');
  });
});
