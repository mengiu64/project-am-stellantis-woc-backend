'use strict';

jest.mock('../../serviceClient', () => ({ callService: jest.fn() }), { virtual: true });
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../DjcManager', () => ({ DjcManager: {} }));
jest.mock('../authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../jobCardService', () => ({
  saveJobCard: jest.fn(),
  sanitizeJobCardPayload: jest.fn((payload) => payload),
}));
jest.mock('../JobcardSyncActivityRepository', () => ({ recordSyncActivity: jest.fn() }));

const fs = require('fs');
const { callService } = require('../../serviceClient');
const { getBearerToken } = require('../authService');
const { saveJobCard } = require('../jobCardService');
const { handler } = require('../index');

describe('djc REST appointment consumer', () => {
  const saved = { success: true, message: 'saved' };
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
    callService.mockResolvedValue({ success: true, data: { isValid: true } });
  });

  afterEach(() => jest.restoreAllMocks());

  test('sends the unchanged domain payload and preserves the save response', async () => {
    const body = payload();
    const result = await handler({ action: 'saveJobcard', body });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(saved);
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
    expect(JSON.parse(result.body)).toEqual(saved);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('updatenaga error'), message);
    expect(callService).toHaveBeenCalledTimes(2);
  });

  test('skips appointments with no existing ID', async () => {
    await handler({ action: 'saveJobcard', body: { appointments: [{}] } });
    expect(callService).not.toHaveBeenCalled();
  });
});
