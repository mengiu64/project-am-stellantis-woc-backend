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
jest.mock('../JobcardSyncActivityRepository', () => ({ recordSyncActivity: jest.fn() }));

const { callService, isInternalRequest } = require('../../serviceClient');
const { handler: internalHandler } = require('../internal');
const { getBearerToken } = require('../authService');
const { saveJobCard, getJobCardDetails, getDataFromDMLFromTmp } = require('../jobCardService');
const { handler } = require('../index');

describe('jobcard REST consumers', () => {
  const saved = { success: true, message: 'saved' };
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
    expect(JSON.parse(response.body)).toEqual(saved);
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
    expect(JSON.parse(result.body)).toEqual(saved);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('session getData'), message);
    expect(callService).toHaveBeenCalledWith('agendasoanaga', 'updatenaga', expect.objectContaining({ pdvid: null }));
  });

  test.each(['Private REST timeout', 'Private REST HTTP 502'])('appointment %s does not fail saving or stop following appointments', async (message) => {
    callService.mockRejectedValueOnce(new Error(message)).mockResolvedValue({ success: true });
    const result = await handler({ action: 'saveJobcard', body: makePayload([appointment, { appointmentInternalId: 'AP-2' }]) });
    expect(JSON.parse(result.body)).toEqual(saved);
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
});
