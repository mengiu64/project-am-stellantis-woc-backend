'use strict';

jest.mock('../../serviceClient', () => ({ callService: jest.fn(), isInternalRequest: jest.fn() }), { virtual: true });
jest.mock('../internal', () => ({ handler: jest.fn() }), { virtual: true });
jest.mock('../authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../jobCardService', () => ({
  getJobCardList: jest.fn(),
  getJobCardListCurrent: jest.fn(),
  getJobCardDetails: jest.fn(),
  saveJobCard: jest.fn(),
  sanitizeJobCardPayload: jest.fn((payload) => payload),
  getDataFromDMLFromTmp: jest.fn(),
}));
jest.mock('../JobcardSyncActivityRepository', () => ({
  ...jest.requireActual('../JobcardSyncActivityRepository'),
  recordSyncActivity: jest.fn(),
  getSyncStatus: jest.fn(),
  getLastPayload: jest.fn(),
}));

const { callService, isInternalRequest } = require('../../serviceClient');
const { handler: internalHandler } = require('../internal');
const { getBearerToken } = require('../authService');
const {
  saveJobCard, getJobCardDetails, getJobCardList, getJobCardListCurrent, getDataFromDMLFromTmp,
} = require('../jobCardService');
const { recordSyncActivity, getSyncStatus, getLastPayload } = require('../JobcardSyncActivityRepository');
const { handler } = require('../index');

describe('jobcard REST consumers', () => {
  const saved = { success: true, message: 'saved' };
  const syncStatus = { ack: 'OK', techReason: '', businessReason: '' };
  const savedWithSyncStatus = { ...saved, ...syncStatus };
  const session = { pdvId: 'PDV', locale: 'it', username: 'trusted', brandvehic_reftech: 'FT' };
  const appointment = {
    appointmentInternalId: 'AP-1',
    reception: { receptionServiceAdvisorId: 'SA', receptionDateTime: '2026-09-10T08:15:00Z' },
  };
  const makePayload = (appointments = [appointment]) => ({
    appointments: appointments.map((value) => ({ ...value })),
    vehicleInfo: { identification: { vin: 'VIN-1' } },
    jobs: [{ jobDescription: 'Service' }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    getBearerToken.mockResolvedValue('local-dgt-token');
    isInternalRequest.mockReturnValue(false);
    saveJobCard.mockResolvedValue(saved);
    recordSyncActivity.mockResolvedValue({ jobcardid: 'SRP-1', creationdate: new Date('2026-09-30T10:00:00Z') });
    getSyncStatus.mockResolvedValue(syncStatus);
    callService.mockImplementation(async (service, operation) => {
      if (service === 'session') return session;
      if (operation === 'createnaga') return { success: true, data: { rdvId: 'NEW-AP' } };
      return { success: true, data: { isValid: true } };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('dispatches private REST events before public action resolution and authentication', async () => {
    const event = { body: 'internal payload' };
    const response = { statusCode: 200, body: '{"result":true}' };
    isInternalRequest.mockReturnValue(true);
    internalHandler.mockResolvedValue(response);
    await expect(handler(event)).resolves.toBe(response);
    expect(internalHandler).toHaveBeenCalledWith(event);
    expect(getBearerToken).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
  });

  test('uses trusted session identity and sends the original NAGA domain body', async () => {
    const payload = makePayload();
    const response = await handler({
      action: 'saveJobcard', body: { payload, username: 'spoofed' },
      requestContext: { authorizer: { sub: 'trusted' } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(savedWithSyncStatus);
    expect(saveJobCard).toHaveBeenCalledWith('local-dgt-token', payload);
    expect(callService).toHaveBeenCalledWith('session', 'getData', { args: ['trusted'] });
    expect(callService).toHaveBeenCalledWith('agendasoanaga', 'updatenaga', expect.objectContaining({
      apptId: 'AP-1', pdvid: 'PDV', locale: 'it', user: 'trusted', idVINSF: 'VIN-1',
      recepDate: '2026-09-10T00:00:00.000Z', recepHours: '0815',
      intervention: [expect.objectContaining({ nom: 'Service' })],
    }));
  });

  test.each([{}, null, false])('never trusts the body when authorizer is present (%p)', async (authorizer) => {
    await handler({
      action: 'saveJobcard', body: { payload: makePayload(), username: 'spoofed' },
      requestContext: { authorizer },
    });
    expect(callService).not.toHaveBeenCalledWith('session', 'getData', expect.anything());
  });

  test('allows body identity only for direct invocation without authorizer', async () => {
    await handler({ action: 'saveJobcard', body: { payload: makePayload(), username: 'local' } });
    expect(callService).toHaveBeenCalledWith('session', 'getData', { args: ['local'] });
  });

  test('creates missing appointment IDs from unwrapped domain results before update', async () => {
    const payload = makePayload([{ ...appointment, appointmentInternalId: null }]);
    await handler({ action: 'saveJobcard', body: { payload, username: 'local' } });
    expect(callService).toHaveBeenCalledWith('agendasoanaga', 'createnaga', expect.objectContaining({
      pdvid: 'PDV', vehiculeId: 'VIN-1', recepDate: '20260910', source: 'WiAdvisor',
    }));
    expect(payload.appointments[0].appointmentInternalId).toBe('NEW-AP');
    expect(callService).toHaveBeenCalledWith('agendasoanaga', 'updatenaga', expect.objectContaining({ apptId: 'NEW-AP' }));
  });

  test('logs a warning and skips update when creation has no appointment ID', async () => {
    callService.mockResolvedValue({ success: false, data: { errorMessage: 'invalid' } });
    const result = await handler({
      action: 'saveJobcard', body: { payload: makePayload([{ appointmentInternalId: null }]) },
    });
    expect(result.statusCode).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('updatenaga saltato'));
    expect(callService).not.toHaveBeenCalledWith('agendasoanaga', 'updatenaga', expect.anything());
  });

  test.each(['Private REST timeout', 'Private REST HTTP 503'])('session %s is explicitly logged and best-effort', async (message) => {
    callService.mockImplementation(async (service) => {
      if (service === 'session') throw new Error(message);
      return { success: true };
    });
    const result = await handler({ action: 'saveJobcard', body: { payload: makePayload(), username: 'local' } });
    expect(JSON.parse(result.body)).toEqual(savedWithSyncStatus);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('session getData'), message);
    expect(callService).toHaveBeenCalledWith('agendasoanaga', 'updatenaga', expect.objectContaining({ pdvid: null }));
  });

  test.each(['Private REST timeout', 'Private REST HTTP 502'])('appointment %s does not fail saving or stop following appointments', async (message) => {
    callService.mockRejectedValueOnce(new Error(message)).mockResolvedValue({ success: true });
    const result = await handler({ action: 'saveJobcard', body: makePayload([appointment, { appointmentInternalId: 'AP-2' }]) });
    expect(JSON.parse(result.body)).toEqual(savedWithSyncStatus);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sync error'), message);
    expect(callService).toHaveBeenCalledTimes(2);
  });

  test('does not fetch session when there are no appointments', async () => {
    await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });
    expect(callService).not.toHaveBeenCalled();
  });

  test.each(['details', 'dml'])('%s preserves trusted identity passed to DMS enrichment', async (action) => {
    await handler({
      action, body: { jobCardId: 'JC-1', username: 'spoofed' },
      requestContext: { authorizer: {} },
    });
    const service = action === 'details' ? getJobCardDetails : getDataFromDMLFromTmp;
    expect(service.mock.calls[0][2]).toEqual(expect.objectContaining({ username: null }));
  });

  test('saveJobcard appends ack/techReason/businessReason read by the tracked jobcardid after saving', async () => {
    const dgtSaved = { statusCode: 200, success: true, message: 'Job Card Transaction Successful', jobCardId: 'JCID-84521' };
    const outcome = { ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS unavailable' };
    saveJobCard.mockResolvedValueOnce(dgtSaved);
    getSyncStatus.mockResolvedValueOnce(outcome);

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(JSON.stringify({ ...dgtSaved, ...outcome }));
    expect(getSyncStatus).toHaveBeenCalledTimes(1);
    expect(getSyncStatus).toHaveBeenCalledWith('SRP-1');
    expect(getSyncStatus.mock.invocationCallOrder[0]).toBeGreaterThan(saveJobCard.mock.invocationCallOrder[0]);
  });

  test('saveJobcard does not read the sync outcome when the DGT save fails', async () => {
    saveJobCard.mockRejectedValueOnce(new Error('[jobCard] saveJobCard failed: HTTP 500'));

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: '[jobCard] saveJobCard failed: HTTP 500' });
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  test.each([
    [{ jobCardId: 'JCID-84506' }, 'JCID-84506'],
    [{ id: 'JCID-84507' }, 'JCID-84507'],
  ])('details puts ack/techReason/businessReason right before jobCardDetail (%p)', async (body, jobCardId) => {
    const jobCardDetail = { roInfo: { jobCardSrpId: jobCardId } };
    const details = {
      dmsAvailable: true, statusCode: 200, success: true, message: 'Job card retrieved successfully', jobCardDetail,
    };
    getJobCardDetails.mockResolvedValueOnce(details);

    const response = await handler({ action: 'details', body });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(JSON.stringify({
      dmsAvailable: true, statusCode: 200, success: true, message: 'Job card retrieved successfully',
      ...syncStatus, jobCardDetail,
    }));
    expect(getJobCardDetails).toHaveBeenCalledWith('local-dgt-token', jobCardId, expect.objectContaining({ username: null }));
    expect(getSyncStatus).toHaveBeenCalledWith(jobCardId);
    expect(details).not.toHaveProperty('ack');
  });

  test('details does not read the sync outcome when the DGT call fails', async () => {
    getJobCardDetails.mockRejectedValueOnce(new Error('[jobCard] getJobCardDetails failed: HTTP 404'));

    const response = await handler({ action: 'details', body: { jobCardId: 'JCID-84506' } });

    expect(response.statusCode).toBe(502);
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  test.each([
    ['list', getJobCardList],
    ['listCurrent', getJobCardListCurrent],
    ['dml', getDataFromDMLFromTmp],
  ])('%s response is returned without the sync outcome', async (action, service) => {
    const serviceResult = { success: true, data: [] };
    service.mockResolvedValueOnce(serviceResult);

    const response = await handler({ action, body: { jobCardId: 'JCID-84506', dealerId: 'DE87630' } });

    expect(JSON.parse(response.body)).toEqual(serviceResult);
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  test.each([
    [{
      httpMethod: 'GET',
      path: '/api/repairorder/lastPayload',
      queryStringParameters: { jobCardId: 'JCID-84521' },
      body: null,
      requestContext: { authorizer: { sub: 'trusted' } },
    }, 'JCID-84521'],
    [{ action: 'lastPayload', body: { id: 'JCID-84522' } }, 'JCID-84522'],
  ])('lastPayload returns the last payload sent to DGT and its sync outcome, reading only the DB (case %#)', async (event, jobCardId) => {
    const payload = { roInfo: { jobCardSrpId: jobCardId }, jobs: [{ jobDescription: 'Service' }] };
    const outcome = { ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS unavailable' };
    getLastPayload.mockResolvedValueOnce({ jobCardId, ...outcome, payload });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    // toBe sulla stringa JSON: verifica anche l'ordine (ack/techReason/businessReason tra jobCardId e payload)
    expect(response.body).toBe(JSON.stringify({
      statusCode: 200,
      success: true,
      message: 'Job card payload retrieved successfully',
      jobCardId,
      ack: 'KO',
      techReason: 'FAILED',
      businessReason: 'FAILED - DMS unavailable',
      payload,
    }));
    expect(getLastPayload).toHaveBeenCalledWith(jobCardId);
    [getBearerToken, getJobCardDetails, saveJobCard, recordSyncActivity, getSyncStatus, callService]
      .forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test('lastPayload returns 404 when the jobcard has no recorded payload', async () => {
    getLastPayload.mockResolvedValueOnce(null);

    const response = await handler({ action: 'lastPayload', body: { jobCardId: ' JCID-404 ' } });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      success: false, message: '[jobCard] payload not found for jobCardId JCID-404',
    });
  });

  test('lastPayload returns 400 when jobCardId is missing from the query string', async () => {
    getLastPayload.mockImplementationOnce(jest.requireActual('../JobcardSyncActivityRepository').getLastPayload);

    const response = await handler({ httpMethod: 'GET', path: '/api/repairorder/lastPayload', queryStringParameters: null });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: '[jobCard] jobCardId is required' });
  });

  test('lastPayload returns 502 on DB errors', async () => {
    getLastPayload.mockRejectedValueOnce(new Error('connection refused'));

    const response = await handler({ action: 'lastPayload', body: { jobCardId: 'JCID-84521' } });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: 'connection refused' });
  });

  test('only isRecordNotFound maps to 404: upstream errors with statusCode 404 stay 502', async () => {
    getJobCardDetails.mockRejectedValueOnce(Object.assign(new Error('[jobCard] getJobCardDetails failed: HTTP 404'), { statusCode: 404 }));

    const response = await handler({ action: 'details', body: { jobCardId: 'JCID-84506' } });

    expect(response.statusCode).toBe(502);
  });
});
