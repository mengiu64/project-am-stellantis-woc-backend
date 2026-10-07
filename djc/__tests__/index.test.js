'use strict';

jest.mock('../../serviceClient', () => ({ callService: jest.fn() }), { virtual: true });
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../DjcManager', () => ({ DjcManager: {} }));
jest.mock('../authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../jobCardService', () => ({
  saveJobCard: jest.fn(),
  sanitizeJobCardPayload: jest.fn((payload) => payload),
}));
jest.mock('../JobcardSyncActivityRepository', () => ({
  ...jest.requireActual('../JobcardSyncActivityRepository'),
  recordSyncActivity: jest.fn(),
  recordDjcSynch: jest.fn(),
  getSyncStatus: jest.fn(),
}));

const fs = require('fs');
const { callService } = require('../../serviceClient');
const { getBearerToken } = require('../authService');
const { saveJobCard } = require('../jobCardService');
const { recordSyncActivity, recordDjcSynch, getSyncStatus } = require('../JobcardSyncActivityRepository');
const { handler } = require('../index');

describe('djc REST appointment consumer', () => {
  const saved = { success: true, message: 'saved' };
  const syncStatus = { djcsynch: true, ack: 'OK', techReason: '', businessReason: '' };
  const savedWithSyncStatus = { ...saved, ...syncStatus };
  const payload = () => ({
    appointments: [{
      appointmentInternalId: 'AP-1',
      reception: { receptionDateTime: '2026-09-10T08:15:00Z' },
    }],
    jobs: [{ jobDescription: 'Service' }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => '{}');
    getBearerToken.mockResolvedValue('local-dgt-token');
    saveJobCard.mockResolvedValue(saved);
    recordSyncActivity.mockResolvedValue({ jobcardid: 'SRP-1', creationdate: new Date('2026-09-30T10:00:00Z') });
    recordDjcSynch.mockResolvedValue(true);
    getSyncStatus.mockResolvedValue(syncStatus);
    callService.mockResolvedValue({ success: true, data: { isValid: true } });
  });

  afterEach(() => jest.restoreAllMocks());

  test('sends the unchanged domain payload and preserves the save response', async () => {
    const body = payload();
    const result = await handler({ action: 'saveJobcard', body });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(savedWithSyncStatus);
    expect(saveJobCard).toHaveBeenCalledWith('local-dgt-token', body);
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', true);
    expect(callService).toHaveBeenCalledWith('agendasoanaga', 'updatenaga', expect.objectContaining({
      apptId: 'AP-1', recepDate: '2026-09-10T00:00:00.000Z', recepHours: '0815',
      pdvid: null, user: null, idVINSF: null, source: 'WiAdvisor',
      intervention: [{ nom: 'Service' }],
    }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('updatenaga result'), { success: true, data: { isValid: true } });
  });

  test.each(['Private REST timeout', 'Private REST HTTP 500'])('logs %s without failing saving or skipping other appointments', async (message) => {
    callService.mockRejectedValueOnce(new Error(message)).mockResolvedValue({ success: true });
    const body = payload();
    body.appointments.push({ appointmentInternalId: 'AP-2' });
    const result = await handler({ action: 'saveJobcard', body });
    expect(JSON.parse(result.body)).toEqual(savedWithSyncStatus);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('updatenaga error'), message);
    expect(callService).toHaveBeenCalledTimes(2);
  });

  test('skips appointments with no existing ID', async () => {
    await handler({ action: 'saveJobcard', body: { appointments: [{}] } });
    expect(callService).not.toHaveBeenCalled();
  });

  test('records djcsynch from the DGT success flag and appends djcsynch/ack/techReason/businessReason after saving', async () => {
    const dgtSaved = { statusCode: 200, success: true, message: 'Job Card Transaction Successful', jobCardId: 'JCID-84521' };
    const outcome = { djcsynch: null, ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS unavailable' };
    saveJobCard.mockResolvedValueOnce(dgtSaved);
    getSyncStatus.mockResolvedValueOnce(outcome);

    const result = await handler({ action: 'saveJobcard', body: { payload: payload() } });

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(JSON.stringify({ ...dgtSaved, djcsynch: true, ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS unavailable' }));
    expect(recordDjcSynch).toHaveBeenCalledTimes(1);
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', true);
    expect(getSyncStatus).toHaveBeenCalledTimes(1);
    expect(getSyncStatus).toHaveBeenCalledWith('SRP-1');
    const order = [recordSyncActivity, getBearerToken, saveJobCard, recordDjcSynch, callService, getSyncStatus]
      .map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test.each([
    { statusCode: 200, success: false, message: 'Job Card Transaction Failed' },
    { statusCode: 200, success: 'true', message: 'Job Card Transaction Successful' },
    { statusCode: 200, message: 'no success flag' },
  ])('records and returns djcsynch false when DGT does not answer success: true (%p)', async (dgtSaved) => {
    saveJobCard.mockResolvedValueOnce(dgtSaved);

    const result = await handler({ action: 'saveJobcard', body: payload() });

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(JSON.stringify({ ...dgtSaved, ...syncStatus, djcsynch: false }));
    expect(recordDjcSynch).toHaveBeenCalledTimes(1);
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', false);
  });

  test('records djcsynch false and returns the unchanged error when the DGT save fails', async () => {
    saveJobCard.mockRejectedValueOnce(new Error('[djc] saveJobCard failed: HTTP 500'));

    const result = await handler({ action: 'saveJobcard', body: payload() });

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ success: false, message: '[djc] saveJobCard failed: HTTP 500' });
    expect(recordDjcSynch).toHaveBeenCalledTimes(1);
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', false);
    expect(callService).not.toHaveBeenCalled();
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  test('records djcsynch false when the DGT token cannot be obtained', async () => {
    getBearerToken.mockRejectedValueOnce(new Error('[djc] token request failed'));

    const result = await handler({ action: 'saveJobcard', body: payload() });

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ success: false, message: '[djc] token request failed' });
    expect(saveJobCard).not.toHaveBeenCalled();
    expect(recordDjcSynch).toHaveBeenCalledWith('SRP-1', false);
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  test('neither calls DGT nor records djcsynch when the payload cannot be recorded', async () => {
    recordSyncActivity.mockRejectedValueOnce(new Error('connection refused'));

    const result = await handler({ action: 'saveJobcard', body: payload() });

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ success: false, message: 'connection refused' });
    expect(getBearerToken).not.toHaveBeenCalled();
    expect(saveJobCard).not.toHaveBeenCalled();
    expect(recordDjcSynch).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
  });

  test('still answers with the DGT outcome when recording djcsynch fails (best-effort)', async () => {
    recordDjcSynch.mockResolvedValueOnce(false);
    getSyncStatus.mockResolvedValueOnce({ djcsynch: null, ack: 'OK', techReason: '', businessReason: '' });

    const result = await handler({ action: 'saveJobcard', body: payload() });

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(JSON.stringify(savedWithSyncStatus));
  });
});
