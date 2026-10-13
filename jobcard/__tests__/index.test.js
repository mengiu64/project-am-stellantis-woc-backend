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
  getDealerConfiguration: jest.fn(),
}));
jest.mock('../JobcardSyncActivityRepository', () => ({
  ...jest.requireActual('../JobcardSyncActivityRepository'),
  recordSyncActivity: jest.fn(),
  recordDjcSynch: jest.fn(),
  getSyncStatus: jest.fn(),
  getLastPayload: jest.fn(),
  deleteSynch: jest.fn(),
}));

const { callService, isInternalRequest } = require('../../serviceClient');
const { handler: internalHandler } = require('../internal');
const { getBearerToken } = require('../authService');
const {
  saveJobCard, getJobCardDetails, getJobCardList, getJobCardListCurrent, getDataFromDMLFromTmp, getDealerConfiguration,
} = require('../jobCardService');
const {
  recordSyncActivity, recordDjcSynch, getSyncStatus, getLastPayload, deleteSynch,
} = require('../JobcardSyncActivityRepository');
const { handler } = require('../index');

describe('jobcard REST consumers', () => {
  const saved = { success: true, message: 'saved' };
  const syncStatus = { djcsynch: true, ack: 'OK', techReason: '', businessReason: '' };
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
    recordDjcSynch.mockResolvedValue(true);
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

  test('saveJobcard records djcsynch from the DGT success flag and appends djcsynch/ack/techReason/businessReason', async () => {
    const dgtSaved = { statusCode: 200, success: true, message: 'Job Card Transaction Successful', jobCardId: 'JCID-84521' };
    // djcsynch letto dal DB ignorato: la risposta usa l'esito della chiamata appena eseguita
    const outcome = { djcsynch: null, ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS unavailable' };
    saveJobCard.mockResolvedValueOnce(dgtSaved);
    getSyncStatus.mockResolvedValueOnce(outcome);

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(200);
    // toBe sulla stringa JSON: verifica anche l'ordine (djcsynch subito prima di ack)
    expect(response.body).toBe(JSON.stringify({ ...dgtSaved, ...outcome, djcsynch: true }));
    expect(Object.keys(JSON.parse(response.body))).toEqual([
      'statusCode', 'success', 'message', 'jobCardId', 'djcsynch', 'ack', 'techReason', 'businessReason',
    ]);
    expect(recordDjcSynch).toHaveBeenCalledTimes(1);
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', true);
    expect(getSyncStatus).toHaveBeenCalledTimes(1);
    expect(getSyncStatus).toHaveBeenCalledWith('SRP-1');
    const order = [recordSyncActivity, getBearerToken, saveJobCard, recordDjcSynch, getSyncStatus]
      .map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test.each([
    [{ statusCode: 200, success: false, message: 'Job Card Transaction Failed' }],
    [{ statusCode: 200, success: 'true', message: 'Job Card Transaction Successful' }],
    [{ statusCode: 200, message: 'no success flag' }],
  ])('saveJobcard records and returns djcsynch false when DGT does not answer success: true (%p)', async (dgtSaved) => {
    saveJobCard.mockResolvedValueOnce(dgtSaved);

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(JSON.stringify({ ...dgtSaved, ...syncStatus, djcsynch: false }));
    expect(recordDjcSynch).toHaveBeenCalledTimes(1);
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', false);
  });

  test('saveJobcard records djcsynch false and returns the unchanged error when the DGT save fails', async () => {
    saveJobCard.mockRejectedValueOnce(new Error('[jobCard] saveJobCard failed: HTTP 500'));

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: '[jobCard] saveJobCard failed: HTTP 500' });
    expect(recordDjcSynch).toHaveBeenCalledTimes(1);
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', false);
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  test('saveJobcard records djcsynch false when the DGT token cannot be obtained', async () => {
    getBearerToken.mockRejectedValueOnce(new Error('[auth] token request failed: HTTP 401'));

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: '[auth] token request failed: HTTP 401' });
    expect(saveJobCard).not.toHaveBeenCalled();
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', false);
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  test('saveJobcard neither calls DGT nor records djcsynch when the payload cannot be recorded', async () => {
    recordSyncActivity.mockRejectedValueOnce(new Error('connection refused'));

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(502);
    [getBearerToken, saveJobCard, recordDjcSynch, getSyncStatus].forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  describe('saveJobcard blocked while the previous push waits for its ack (SYNC_ACK_PENDING)', () => {
    const ackPendingError = () => Object.assign(
      new Error('[jobCard] save blocked for jobCardId SRP-1: previous synchronization not acknowledged yet'),
      { isAckPending: true, jobCardId: 'SRP-1' },
    );
    const apiEvent = (payload, queryStringParameters, sub = 'trusted') => ({
      httpMethod: 'POST',
      path: '/api/repairorder/saveJobcard',
      queryStringParameters,
      body: JSON.stringify(payload),
      requestContext: { authorizer: { sub } },
    });

    test('answers 409 SYNC_ACK_PENDING without calling DGT/Naga nor recording djcsynch', async () => {
      recordSyncActivity.mockRejectedValueOnce(ackPendingError());

      const response = await handler(apiEvent(makePayload()));

      expect(response.statusCode).toBe(409);
      expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(response.body)).toEqual({
        success: false,
        code: 'SYNC_ACK_PENDING',
        message: '[jobCard] save blocked for jobCardId SRP-1: previous synchronization not acknowledged yet',
        djcsynch: true,
        ack: '',
        techReason: '',
        businessReason: '',
      });
      expect(recordSyncActivity).toHaveBeenCalledWith(makePayload(), { force: false });
      [getBearerToken, saveJobCard, recordDjcSynch, getSyncStatus, callService].forEach((fn) => expect(fn).not.toHaveBeenCalled());
      expect(console.warn).not.toHaveBeenCalled();
    });

    test('?force=true forces the save, strips force from the payload and logs the authorizer sub', async () => {
      const payload = makePayload([]);

      const response = await handler(apiEvent(payload, { force: 'true' }));

      expect(response.statusCode).toBe(200);
      expect(recordSyncActivity).toHaveBeenCalledWith(payload, { force: true });
      expect(saveJobCard).toHaveBeenCalledWith('local-dgt-token', payload);
      expect(saveJobCard.mock.calls[0][1]).not.toHaveProperty('force');
      expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', true);
      expect(console.warn).toHaveBeenCalledWith('[jobCard] saveJobcard forced jobcardid=SRP-1 sub=trusted');
    });

    test.each([
      [{ force: 'false' }],
      [{ force: 'TRUE' }],
      [undefined],
    ])('query string %p does not force the save', async (query) => {
      await handler(apiEvent(makePayload([]), query));
      expect(recordSyncActivity).toHaveBeenCalledWith(makePayload([]), { force: false });
      expect(saveJobCard.mock.calls[0][1]).not.toHaveProperty('force');
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('forced'));
    });

    test('ignores force in the JSON body of an API Gateway request', async () => {
      await handler(apiEvent({ ...makePayload([]), force: true }));
      expect(recordSyncActivity).toHaveBeenCalledWith(makePayload([]), { force: false });
      expect(saveJobCard).toHaveBeenCalledWith('local-dgt-token', makePayload([]));
    });

    test.each([true, 'true'])('direct invocation accepts body.force (%p) and never logs a body identity as sub', async (force) => {
      const payload = makePayload([]);

      const response = await handler({ action: 'saveJobcard', body: { payload, force, username: 'local' } });

      expect(response.statusCode).toBe(200);
      expect(recordSyncActivity).toHaveBeenCalledWith(payload, { force: true });
      expect(console.warn).toHaveBeenCalledWith('[jobCard] saveJobcard forced jobcardid=SRP-1 sub=n/a');
    });

    test('direct invocation with an unwrapped payload strips force before saving', async () => {
      const payload = makePayload([]);

      await handler({ action: 'saveJobcard', body: { ...payload, force: false } });

      expect(recordSyncActivity).toHaveBeenCalledWith(payload, { force: false });
      expect(saveJobCard).toHaveBeenCalledWith('local-dgt-token', payload);
    });
  });

  test('saveJobcard still answers with the DGT outcome when recording djcsynch fails (best-effort)', async () => {
    recordDjcSynch.mockResolvedValueOnce(false);

    const response = await handler({ action: 'saveJobcard', body: { payload: makePayload([]), username: 'local' } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(savedWithSyncStatus);
  });

  test.each([
    [{ jobCardId: 'JCID-84506' }, 'JCID-84506'],
    [{ id: 'JCID-84507' }, 'JCID-84507'],
  ])('details puts djcsynch/ack/techReason/businessReason right before jobCardDetail (%p)', async (body, jobCardId) => {
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
    expect(recordDjcSynch).not.toHaveBeenCalled();
  });

  test.each([false, null])('details returns djcsynch as read from the DB (%p)', async (djcsynch) => {
    getJobCardDetails.mockResolvedValueOnce({ success: true, jobCardDetail: {} });
    getSyncStatus.mockResolvedValueOnce({ ...syncStatus, djcsynch });

    const response = await handler({ action: 'details', body: { jobCardId: 'JCID-84506' } });

    expect(JSON.parse(response.body)).toEqual({ success: true, ...syncStatus, djcsynch, jobCardDetail: {} });
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
    const outcome = { djcsynch: false, ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS unavailable' };
    getLastPayload.mockResolvedValueOnce({ jobCardId, ...outcome, payload });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    // toBe sulla stringa JSON: verifica anche l'ordine (djcsynch/ack/techReason/businessReason/deleted tra jobCardId e payload)
    expect(response.body).toBe(JSON.stringify({
      statusCode: 200,
      success: true,
      message: 'Job card payload retrieved successfully',
      jobCardId,
      djcsynch: false,
      ack: 'KO',
      techReason: 'FAILED',
      businessReason: 'FAILED - DMS unavailable',
      deleted: false,
      payload,
    }));
    expect(getLastPayload).toHaveBeenCalledWith(jobCardId);
    [getBearerToken, getJobCardDetails, saveJobCard, recordSyncActivity, recordDjcSynch, getSyncStatus, deleteSynch, callService]
      .forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test.each([
    [{
      httpMethod: 'GET',
      path: '/api/repairorder/lastPayload',
      queryStringParameters: { jobCardId: 'JCID-84521' },
      body: null,
      requestContext: { authorizer: { sub: 'trusted' } },
    }, 'JCID-84521'],
    [{ action: 'lastPayload', body: { jobCardId: 'JCID-84522' } }, 'JCID-84522'],
  ])('lastPayload deletes the row after reading the payload when djcsynch is false and the sync outcome is empty (case %#)', async (event, jobCardId) => {
    const payload = { roInfo: { jobCardSrpId: jobCardId }, jobs: [{ jobDescription: 'Service' }] };
    getLastPayload.mockResolvedValueOnce({
      jobCardId, djcsynch: false, ack: '', techReason: '', businessReason: '', payload,
    });
    deleteSynch.mockResolvedValueOnce({ jobCardId, deleted: true });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(JSON.stringify({
      statusCode: 200,
      success: true,
      message: 'Job card payload retrieved successfully',
      jobCardId,
      djcsynch: false,
      ack: '',
      techReason: '',
      businessReason: '',
      deleted: true,
      payload,
    }));
    expect(deleteSynch).toHaveBeenCalledTimes(1);
    expect(deleteSynch).toHaveBeenCalledWith(jobCardId);
    expect(getLastPayload.mock.invocationCallOrder[0]).toBeLessThan(deleteSynch.mock.invocationCallOrder[0]);
    [getBearerToken, saveJobCard, callService].forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test.each([
    ['djcsynch null (DGT outcome not known yet)', { djcsynch: null, ack: '', techReason: '', businessReason: '' }],
    ['djcsynch true', { djcsynch: true, ack: '', techReason: '', businessReason: '' }],
    ['sync outcome recorded by synch-status', {
      djcsynch: false, ack: 'OK', techReason: 'SUCCESS_WITHOUT_UPDATE', businessReason: '',
    }],
  ])('lastPayload keeps the row when it cannot be deleted: %s', async (_label, outcome) => {
    getLastPayload.mockResolvedValueOnce({ jobCardId: 'JCID-84521', ...outcome, payload: { jobs: [] } });

    const response = await handler({ action: 'lastPayload', body: { jobCardId: 'JCID-84521' } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ...outcome, deleted: false, payload: { jobs: [] } });
    expect(deleteSynch).not.toHaveBeenCalled();
  });

  test.each([
    ['the sync outcome changed before the DELETE', {
      jobCardId: 'JCID-84521', deleted: false, djcsynch: false, ack: 'OK', techReason: '', businessReason: '',
    }],
    ['the row was already deleted', null],
  ])('lastPayload returns deleted: false when the conditional DELETE removes nothing: %s', async (_label, outcome) => {
    getLastPayload.mockResolvedValueOnce({
      jobCardId: 'JCID-84521', djcsynch: false, ack: '', techReason: '', businessReason: '', payload: { jobs: [] },
    });
    deleteSynch.mockResolvedValueOnce(outcome);

    const response = await handler({ action: 'lastPayload', body: { jobCardId: 'JCID-84521' } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ success: true, deleted: false, payload: { jobs: [] } });
    expect(deleteSynch).toHaveBeenCalledWith('JCID-84521');
  });

  test('lastPayload still returns the payload when the DELETE fails (best-effort, logged)', async () => {
    getLastPayload.mockResolvedValueOnce({
      jobCardId: 'JCID-84521', djcsynch: false, ack: '', techReason: '', businessReason: '', payload: { jobs: [] },
    });
    deleteSynch.mockRejectedValueOnce(new Error('permission denied for table jobcard_sync_activity'));

    const response = await handler({ action: 'lastPayload', body: { jobCardId: 'JCID-84521' } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ success: true, deleted: false, payload: { jobs: [] } });
    expect(console.warn).toHaveBeenCalledWith(
      '[jobCard] jobcard_sync_activity eliminazione (lastPayload) fallita jobcardid=JCID-84521: permission denied for table jobcard_sync_activity',
    );
  });

  test('lastPayload returns 404 when the jobcard has no recorded payload', async () => {
    getLastPayload.mockResolvedValueOnce(null);

    const response = await handler({ action: 'lastPayload', body: { jobCardId: ' JCID-404 ' } });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      success: false, message: '[jobCard] payload not found for jobCardId JCID-404',
    });
    expect(deleteSynch).not.toHaveBeenCalled();
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
    expect(deleteSynch).not.toHaveBeenCalled();
  });

  test.each([
    [{
      httpMethod: 'POST',
      path: '/api/repairorder/deleteSynch',
      queryStringParameters: null,
      body: JSON.stringify({ jobCardId: 'JCID-84521' }),
      requestContext: { authorizer: { sub: 'trusted' } },
    }, 'JCID-84521'],
    [{
      rawPath: '/api/repairorder/deleteSynch',
      body: JSON.stringify({ id: 'JCID-84522' }),
      requestContext: { http: { method: 'post' } },
    }, 'JCID-84522'],
    [{ action: 'deleteSynch', body: { jobCardId: 'JCID-84523' } }, 'JCID-84523'],
  ])('deleteSynch deletes the sync activity row, reading only the DB (case %#)', async (event, jobCardId) => {
    deleteSynch.mockResolvedValueOnce({ jobCardId, deleted: true });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      statusCode: 200, success: true, message: 'Job card sync activity deleted successfully', jobCardId,
    });
    expect(deleteSynch).toHaveBeenCalledWith(jobCardId);
    [getBearerToken, getJobCardDetails, saveJobCard, recordSyncActivity, recordDjcSynch, getSyncStatus, getLastPayload, callService]
      .forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test('deleteSynch returns 404 when the jobcard has no sync activity row', async () => {
    deleteSynch.mockResolvedValueOnce(null);

    const response = await handler({ action: 'deleteSynch', body: { jobCardId: ' JCID-404 ' } });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      success: false, message: '[jobCard] sync activity not found for jobCardId JCID-404',
    });
  });

  test('deleteSynch returns 409 with the current outcome when the row cannot be deleted', async () => {
    // businessReason con "is required" (testo libero DMS): resta 409, non 400.
    deleteSynch.mockResolvedValueOnce({
      jobCardId: 'JCID-84521', deleted: false, djcsynch: false, ack: 'KO', techReason: 'REFUSED', businessReason: 'REFUSED - plate is required',
    });

    const response = await handler({
      httpMethod: 'POST', path: '/api/repairorder/deleteSynch', body: JSON.stringify({ jobCardId: 'JCID-84521' }),
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      message: '[jobCard] sync activity for jobCardId JCID-84521 cannot be deleted: djcsynch must be false and '
        + 'ack/techReason/businessReason empty (current: {"djcsynch":false,"ack":"KO","techReason":"REFUSED",'
        + '"businessReason":"REFUSED - plate is required"})',
    });
  });

  test('deleteSynch returns 400 when jobCardId is missing from the body', async () => {
    deleteSynch.mockImplementationOnce(jest.requireActual('../JobcardSyncActivityRepository').deleteSynch);

    const response = await handler({ httpMethod: 'POST', path: '/api/repairorder/deleteSynch', body: '{}' });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: '[jobCard] jobCardId is required' });
  });

  test('deleteSynch returns 502 on DB errors', async () => {
    deleteSynch.mockRejectedValueOnce(new Error('permission denied for table jobcard_sync_activity'));

    const response = await handler({ action: 'deleteSynch', body: { jobCardId: 'JCID-84521' } });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({
      success: false, message: 'permission denied for table jobcard_sync_activity',
    });
  });

  test.each([
    [{
      httpMethod: 'GET',
      path: '/api/repairorder/deleteSynch',
      queryStringParameters: { jobCardId: 'JCID-84521' },
      body: null,
    }, 'GET'],
    [{
      rawPath: '/api/repairorder/deleteSynch',
      rawQueryString: 'jobCardId=JCID-84521',
      queryStringParameters: { jobCardId: 'JCID-84521' },
      requestContext: { http: { method: 'GET' } },
    }, 'GET'],
    [{
      httpMethod: 'DELETE',
      path: '/api/repairorder/deleteSynch',
      queryStringParameters: { jobCardId: 'JCID-84521' },
      body: null,
    }, 'DELETE'],
  ])('deleteSynch returns 405 without touching the DB for non-POST API Gateway requests (case %#)', async (event, method) => {
    const response = await handler(event);

    expect(response.statusCode).toBe(405);
    expect(response.headers).toEqual({ 'Content-Type': 'application/json', Allow: 'POST' });
    expect(JSON.parse(response.body)).toEqual({
      success: false, message: `Method not allowed: "${method}". Valid methods for deleteSynch: POST`,
    });
    expect(deleteSynch).not.toHaveBeenCalled();
  });

  test.each([
    [{
      httpMethod: 'GET',
      path: '/api/repairorder/getDealerConfiguration',
      queryStringParameters: { market: '1000', oic: '00007584' },
      body: null,
    }, '1000', '00007584'],
    [{ action: 'getDealerConfiguration', body: { market: '1000', oic: '00007584' } }, '1000', '00007584'],
  ])('getDealerConfiguration returns the dealer configuration, reading only dbManager via REST interno (case %#)', async (event, market, oic) => {
    const configuration = { vehicleInspection: [{ type: 'TIRES' }], package: { Mechanical: [{}] } };
    getDealerConfiguration.mockResolvedValueOnce(configuration);

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(configuration);
    expect(getDealerConfiguration).toHaveBeenCalledWith(market, oic);
    [getBearerToken, getJobCardDetails, saveJobCard, recordSyncActivity, recordDjcSynch, getSyncStatus, callService]
      .forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test('getDealerConfiguration returns 400 when market is missing', async () => {
    getDealerConfiguration.mockRejectedValueOnce(new Error('[jobCard] market is required'));

    const response = await handler({ action: 'getDealerConfiguration', body: { oic: '00007584' } });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: '[jobCard] market is required' });
  });

  test('getDealerConfiguration returns 502 on dbManager errors', async () => {
    getDealerConfiguration.mockRejectedValueOnce(new Error('connection refused'));

    const response = await handler({ action: 'getDealerConfiguration', body: { market: '1000', oic: '00007584' } });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({ success: false, message: 'connection refused' });
  });

  test('only isRecordNotFound maps to 404: upstream errors with statusCode 404 stay 502', async () => {
    getJobCardDetails.mockRejectedValueOnce(Object.assign(new Error('[jobCard] getJobCardDetails failed: HTTP 404'), { statusCode: 404 }));

    const response = await handler({ action: 'details', body: { jobCardId: 'JCID-84506' } });

    expect(response.statusCode).toBe(502);
  });
});
