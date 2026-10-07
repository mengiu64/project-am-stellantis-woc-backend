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
  getSyncStatus: jest.fn(),
}));

const fs = require('fs');
const { callService } = require('../../serviceClient');
const { getBearerToken } = require('../authService');
const { saveJobCard } = require('../jobCardService');
const { recordSyncActivity, getSyncStatus } = require('../JobcardSyncActivityRepository');
const { handler } = require('../index');

describe('djc REST appointment consumer', () => {
  const saved = { success: true, message: 'saved' };
  const syncStatus = { ack: 'OK', techReason: '', businessReason: '' };
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

  test('appends ack/techReason/businessReason read by the tracked jobcardid after saving', async () => {
    const dgtSaved = { statusCode: 200, success: true, message: 'Job Card Transaction Successful', jobCardId: 'JCID-84521' };
    const outcome = { ack: 'KO', techReason: 'FAILED', businessReason: 'FAILED - DMS unavailable' };
    saveJobCard.mockResolvedValueOnce(dgtSaved);
    getSyncStatus.mockResolvedValueOnce(outcome);

    const result = await handler({ action: 'saveJobcard', body: { payload: payload() } });

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(JSON.stringify({ ...dgtSaved, ...outcome }));
    expect(getSyncStatus).toHaveBeenCalledTimes(1);
    expect(getSyncStatus).toHaveBeenCalledWith('SRP-1');
    expect(getSyncStatus.mock.invocationCallOrder[0]).toBeGreaterThan(saveJobCard.mock.invocationCallOrder[0]);
  });

  test('does not read the sync outcome when the DGT save fails', async () => {
    saveJobCard.mockRejectedValueOnce(new Error('[djc] saveJobCard failed: HTTP 500'));

    const result = await handler({ action: 'saveJobcard', body: payload() });

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ success: false, message: '[djc] saveJobCard failed: HTTP 500' });
    expect(getSyncStatus).not.toHaveBeenCalled();
  });
});
