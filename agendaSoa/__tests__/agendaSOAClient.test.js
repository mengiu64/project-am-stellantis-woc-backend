'use strict';

jest.mock('axios');
jest.mock('dotenv', () => ({ config: jest.fn() }));

const axios = require('axios');
const AgendaSOAClient = require('../src/agendaSOAClient');

describe('AgendaSOAClient', () => {
  let mockHttp;
  let client;

  beforeEach(() => {
    mockHttp = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    axios.create.mockReturnValue(mockHttp);

    client = new AgendaSOAClient({
      host: 'http://test-host',
      username: 'testuser',
      password: 'testpass',
      apiKey: 'test-api-key',
    });
  });

  afterEach(() => jest.clearAllMocks());

  // ── constructor ──────────────────────────────────────────────────────────────

  test('creates axios instance with correct baseURL and timeout', () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://test-host', timeout: 30000 })
    );
  });

  test('does not set httpsAgent on axios config when not provided', () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ httpsAgent: expect.anything() })
    );
  });

  test('passes httpsAgent to axios.create when provided', () => {
    const fakeAgent = { fake: true };
    // eslint-disable-next-line no-unused-vars
    const c = new AgendaSOAClient({ host: 'http://test-host', httpsAgent: fakeAgent });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ httpsAgent: fakeAgent })
    );
  });

  test('falls back to env vars when config not provided', () => {
    process.env.AGENDA_SOA_HOST = 'http://env-host';
    process.env.AGENDA_SOA_USERNAME = 'env-user';
    process.env.AGENDA_SOA_PASSWORD = 'env-pass';
    const c = new AgendaSOAClient({});
    expect(c.host).toBe('http://env-host');
    expect(c.username).toBe('env-user');
    expect(c.password).toBe('env-pass');
    delete process.env.AGENDA_SOA_HOST;
    delete process.env.AGENDA_SOA_USERNAME;
    delete process.env.AGENDA_SOA_PASSWORD;
  });

  // ── _basicAuthHeader ─────────────────────────────────────────────────────────

  test('_basicAuthHeader returns correct Basic auth header', () => {
    const header = client._basicAuthHeader();
    const expected = Buffer.from('testuser:testpass').toString('base64');
    expect(header.Authorization).toBe(`Basic ${expected}`);
  });

  // ── _processResponse ─────────────────────────────────────────────────────────

  test('_processResponse returns success=true for 200', () => {
    const result = client._processResponse({ status: 200, data: { key: 'val' } });
    expect(result).toEqual({ success: true, data: { key: 'val' } });
  });

  test('_processResponse returns success=true for 201', () => {
    const result = client._processResponse({ status: 201, data: {} });
    expect(result.success).toBe(true);
  });

  test('_processResponse returns success=false for 400', () => {
    const result = client._processResponse({ status: 400, data: { status: 'BAD_REQUEST', message: 'invalid' } });
    expect(result.success).toBe(false);
    expect(result.data).toContain('400');
  });

  test('_processResponse returns success=false for 500', () => {
    const result = client._processResponse({ status: 500, data: {} });
    expect(result.success).toBe(false);
    expect(result.data).toContain('GENERIC');
  });

  // ── appointment ──────────────────────────────────────────────────────────────

  test('appointment calls GET with API-Key header', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: { grillePlanningReceptionnairePresentations: [] } });
    const params = { ccs: 'ccs1', date: '20240101', pdvId: 'pdv1', locale: 'fr_FR', ldapId: 'user1' };
    const result = await client.appointment(params);
    expect(mockHttp.get).toHaveBeenCalledWith(
      'planningrest/planning/v1/appointment/data/',
      expect.objectContaining({
        headers: expect.objectContaining({ 'API-Key': 'test-api-key' }),
        params,
      })
    );
    expect(result.success).toBe(true);
  });

  test('appointment returns success=false on non-2xx status', async () => {
    mockHttp.get.mockResolvedValue({ status: 503, data: { message: 'Service Unavailable' } });
    const result = await client.appointment({});
    expect(result.success).toBe(false);
  });

  // ── availableHours ───────────────────────────────────────────────────────────

  test('availableHours calls GET with correct path including id', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: { heureRdvMap: ['800', '900'] } });
    await client.availableHours({ id: 'pdv1' });
    expect(mockHttp.get).toHaveBeenCalledWith(
      'vendorrest/pdvs/v1/pdv1/availablehours/',
      expect.any(Object)
    );
  });

  test('availableHours pads 4-char hour strings (e.g. "7:00" → "07:00")', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: { heureRdvMap: ['7:00', '10:00'] } });
    const result = await client.availableHours({ id: 'pdv1' });
    expect(result.data).toContain('07:00');
    expect(result.data).toContain('10:00');
  });

  test('availableHours handles array response (no heureRdvMap)', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: ['07:00', '08:00'] });
    const result = await client.availableHours({ id: 'pdv1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['07:00', '08:00']);
  });

  test('availableHours returns failure when HTTP error', async () => {
    mockHttp.get.mockResolvedValue({ status: 401, data: { message: 'Unauthorized' } });
    const result = await client.availableHours({ id: 'pdv1' });
    expect(result.success).toBe(false);
  });

  // ── cCSList ──────────────────────────────────────────────────────────────────

  test('cCSList calls GET with correct path', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: [] });
    await client.cCSList({ id: 'pdv1' });
    expect(mockHttp.get).toHaveBeenCalledWith(
      'vendorrest/pdvs/v1/pdv1/ccslist/',
      expect.any(Object)
    );
  });

  test('cCSList maps response fields correctly', async () => {
    const rawItem = {
      personnelId: 'user1',
      prenom: 'Jean',
      nom: 'Dupont',
      ownerPdv: 'pdv1',
      isCcsShared: false,
      parentPdvLogo: null,
      isSharedCCSDeleted: false,
      deletedDate: null,
      dte: 'DTE1',
    };
    mockHttp.get.mockResolvedValue({ status: 200, data: [rawItem] });
    const result = await client.cCSList({ id: 'pdv1' });
    expect(result.success).toBe(true);
    expect(result.data[0]).toEqual({
      LOGINNAME: 'user1',
      FIRSTNAME: 'Jean',
      LASTNAME: 'Dupont',
      NAME: 'Jean Dupont',
      OWNER_PDV: 'pdv1',
      IS_CCS_SHARED: false,
      PARENT_PDV_LOGO: null,
      IS_SHARED_DELETED: false,
      DELETED_DATE: null,
      DTE: 'DTE1',
    });
  });

  test('cCSList returns empty array when data is not an array', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: null });
    const result = await client.cCSList({ id: 'pdv1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('cCSList returns success=false on HTTP error', async () => {
    mockHttp.get.mockResolvedValue({ status: 404, data: { message: 'Not found' } });
    const result = await client.cCSList({ id: 'pdv1' });
    expect(result.success).toBe(false);
  });

  // ── data ─────────────────────────────────────────────────────────────────────

  test('data calls GET with correct path including id', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: { plaDtoList: [{ id: '1' }] } });
    await client.data({ id: 'rdv1' });
    expect(mockHttp.get).toHaveBeenCalledWith(
      'appointmentrest/rdvs/v1/rdv1/data/',
      expect.any(Object)
    );
  });

  test('data returns plaDtoList from response', async () => {
    const list = [{ id: '1', status: 'confirmed' }];
    mockHttp.get.mockResolvedValue({ status: 200, data: { plaDtoList: list } });
    const result = await client.data({ id: 'rdv1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(list);
  });

  test('data returns full data when plaDtoList is absent', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: { someOtherField: 'value' } });
    const result = await client.data({ id: 'rdv1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ someOtherField: 'value' });
  });

  test('data returns success=false on HTTP error', async () => {
    mockHttp.get.mockResolvedValue({ status: 500, data: {} });
    const result = await client.data({ id: 'rdv1' });
    expect(result.success).toBe(false);
  });

  // ── getAvHoursForRec ─────────────────────────────────────────────────────────

  test('getAvHoursForRec filters busy times from appointment planning', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({
      success: true,
      data: ['07:00', '08:00', '09:00', '10:00'],
    });
    jest.spyOn(client, 'appointment').mockResolvedValue({
      success: true,
      data: {
        grillePlanningReceptionnairePresentations: [
          {
            id: 'ccs1',
            tranches: [
              { rdv: { reception_date: '26/06/2026 à 08h00' } },
              { rdv: { reception_date: '26/06/2026 à 10h00' } },
            ],
          },
        ],
      },
    });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['07:00', '09:00']);
  });

  test('getAvHoursForRec returns all hours when no appointment for ccs', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({
      success: true,
      data: ['07:00', '08:00'],
    });
    jest.spyOn(client, 'appointment').mockResolvedValue({
      success: true,
      data: { grillePlanningReceptionnairePresentations: [] },
    });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['07:00', '08:00']);
  });

  test('getAvHoursForRec returns failure when availableHours fails', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({ success: false, data: 'err' });
    jest.spyOn(client, 'appointment').mockResolvedValue({ success: true, data: {} });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(false);
  });

  test('getAvHoursForRec returns failure when appointment fails', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({ success: true, data: ['07:00'] });
    jest.spyOn(client, 'appointment').mockResolvedValue({ success: false, data: 'err' });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(false);
  });

  test('getAvHoursForRec converts YYYYMMDD date to YYYY-MM-DD for availableHours call', async () => {
    const avSpy = jest.spyOn(client, 'availableHours').mockResolvedValue({ success: true, data: [] });
    jest.spyOn(client, 'appointment').mockResolvedValue({
      success: true,
      data: { grillePlanningReceptionnairePresentations: [] },
    });
    await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(avSpy).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-06-26' }));
  });

  test('getAvHoursForRec passes already-formatted date unchanged to availableHours', async () => {
    const avSpy = jest.spyOn(client, 'availableHours').mockResolvedValue({ success: true, data: [] });
    jest.spyOn(client, 'appointment').mockResolvedValue({
      success: true,
      data: { grillePlanningReceptionnairePresentations: [] },
    });
    await client.getAvHoursForRec('pdv1', '2026-06-26', 'ccs1', 'fr_FR', 'ldap1');
    expect(avSpy).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-06-26' }));
  });

  // ── interceptors ─────────────────────────────────────────────────────────────

  test('request interceptor passes request through unchanged', () => {
    const [callback] = mockHttp.interceptors.request.use.mock.calls[0];
    const req = { method: 'GET', url: '/test', headers: {} };
    expect(callback(req)).toBe(req);
  });

  test('response interceptor success callback passes response through', () => {
    const [successCb] = mockHttp.interceptors.response.use.mock.calls[0];
    const res = { status: 200, data: { grillePlanningReceptionnairePresentations: [] } };
    expect(successCb(res)).toBe(res);
  });

  test('response interceptor error callback rejects with the error', async () => {
    const [, errorCb] = mockHttp.interceptors.response.use.mock.calls[0];
    await expect(errorCb(new Error('network failure'))).rejects.toThrow('network failure');
  });

  // ── _get validateStatus ───────────────────────────────────────────────────────

  test('_get passes validateStatus that always returns true', async () => {
    let capturedOpts;
    mockHttp.get.mockImplementation((_url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({ status: 200, data: {} });
    });
    await client._get('/test');
    expect(capturedOpts.validateStatus()).toBe(true);
    expect(capturedOpts.validateStatus(500)).toBe(true);
  });

  // ── _getWithApiKey validateStatus ─────────────────────────────────────────────

  test('_getWithApiKey passes validateStatus that always returns true', async () => {
    let capturedOpts;
    mockHttp.get.mockImplementation((_url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({ status: 200, data: {} });
    });
    await client._getWithApiKey('/test');
    expect(capturedOpts.validateStatus()).toBe(true);
  });

  // ── _post ─────────────────────────────────────────────────────────────────────

  test('_post calls http.post with body and correct headers', async () => {
    mockHttp.post.mockResolvedValue({ status: 200, data: { result: 'ok' } });
    const result = await client._post('/endpoint', { key: 'val' });
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/endpoint',
      { key: 'val' },
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ result: 'ok' });
  });

  test('_post validateStatus always returns true', async () => {
    let capturedOpts;
    mockHttp.post.mockImplementation((_url, _body, opts) => {
      capturedOpts = opts;
      return Promise.resolve({ status: 201, data: {} });
    });
    await client._post('/endpoint', {});
    expect(capturedOpts.validateStatus()).toBe(true);
    expect(capturedOpts.validateStatus(500)).toBe(true);
  });

  test('_post returns success=false on HTTP error', async () => {
    mockHttp.post.mockResolvedValue({ status: 500, data: { message: 'server error' } });
    const result = await client._post('/endpoint', {});
    expect(result.success).toBe(false);
  });

  // ── cCSList catch ─────────────────────────────────────────────────────────────

  test('cCSList returns success=false when http throws', async () => {
    mockHttp.get.mockRejectedValue(new Error('network error'));
    const result = await client.cCSList({ id: 'pdv1' });
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).toBe('network error');
  });

  // ── default parameter branches ────────────────────────────────────────────────

  test('AgendaSOAClient constructor works with no arguments (default config = {})', () => {
    process.env.AGENDA_SOA_HOST = 'http://default-host';
    process.env.AGENDA_SOA_USERNAME = 'default-user';
    process.env.AGENDA_SOA_PASSWORD = 'default-pass';
    const c = new AgendaSOAClient();
    expect(c.host).toBe('http://default-host');
    expect(c.username).toBe('default-user');
    delete process.env.AGENDA_SOA_HOST;
    delete process.env.AGENDA_SOA_USERNAME;
    delete process.env.AGENDA_SOA_PASSWORD;
  });

  test('_post works with no body argument (default body = {})', async () => {
    mockHttp.post.mockResolvedValue({ status: 200, data: {} });
    const result = await client._post('/endpoint');
    expect(mockHttp.post).toHaveBeenCalledWith('/endpoint', {}, expect.any(Object));
    expect(result.success).toBe(true);
  });

  // ── availableHours edge cases ─────────────────────────────────────────────────

  test('availableHours handles plain object data (no heureRdvMap, not an array)', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: { '07:00': '07:00', '08:00': '08:00' } });
    const result = await client.availableHours({ id: 'pdv1' });
    expect(result.success).toBe(true);
    expect(result.data).toContain('07:00');
  });

  test('availableHours handles null data (raw ?? {} fallback)', async () => {
    mockHttp.get.mockResolvedValue({ status: 200, data: null });
    const result = await client.availableHours({ id: 'pdv1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  // ── getAvHoursForRec edge cases ───────────────────────────────────────────────

  test('getAvHoursForRec handles null apptResult.data (planning ?? [] fallback)', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({ success: true, data: ['07:00'] });
    jest.spyOn(client, 'appointment').mockResolvedValue({ success: true, data: null });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['07:00']);
  });

  test('getAvHoursForRec skips tranche with null tranches (tranches ?? [])', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({ success: true, data: ['07:00'] });
    jest.spyOn(client, 'appointment').mockResolvedValue({
      success: true,
      data: {
        grillePlanningReceptionnairePresentations: [
          { id: 'ccs1', tranches: null },
        ],
      },
    });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['07:00']);
  });

  test('getAvHoursForRec skips tranche with no rdv (receptionDate is undefined)', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({ success: true, data: ['07:00', '08:00'] });
    jest.spyOn(client, 'appointment').mockResolvedValue({
      success: true,
      data: {
        grillePlanningReceptionnairePresentations: [
          { id: 'ccs1', tranches: [{ rdv: null }, { rdv: { reception_date: '26/06/2026 à 08h00' } }] },
        ],
      },
    });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['07:00']);
  });

  test('getAvHoursForRec skips tranche with reception_date missing " à " separator', async () => {
    jest.spyOn(client, 'availableHours').mockResolvedValue({ success: true, data: ['07:00', '08:00'] });
    jest.spyOn(client, 'appointment').mockResolvedValue({
      success: true,
      data: {
        grillePlanningReceptionnairePresentations: [
          { id: 'ccs1', tranches: [{ rdv: { reception_date: 'INVALID_FORMAT' } }] },
        ],
      },
    });
    const result = await client.getAvHoursForRec('pdv1', '20260626', 'ccs1', 'fr_FR', 'ldap1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['07:00', '08:00']);
  });
});
