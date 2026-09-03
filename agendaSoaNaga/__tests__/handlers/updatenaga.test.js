'use strict';

jest.mock('../../src/clientFactory');

const { handler } = require('../../src/handlers/updatenaga');
const { buildClient } = require('../../src/clientFactory');

describe('updatenaga handler', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { updatenaga: jest.fn() };
    buildClient.mockReturnValue(mockClient);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 400 if apptId is missing', async () => {
    const res = await handler({ body: '{}' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('apptId');
  });

  test('reads apptId from event.pathParameters', async () => {
    mockClient.updatenaga.mockResolvedValue({ success: true, data: {} });
    const event = {
      pathParameters: { apptId: 'appt-123' },
      body: JSON.stringify({ vin: 'VIN1' }),
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.updatenaga).toHaveBeenCalledWith({ vin: 'VIN1' }, 'appt-123');
  });

  test('reads apptId from event.params as fallback', async () => {
    mockClient.updatenaga.mockResolvedValue({ success: true, data: {} });
    const event = {
      params: { apptId: 'appt-456' },
      body: JSON.stringify({ vin: 'VIN2' }),
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.updatenaga).toHaveBeenCalledWith({ vin: 'VIN2' }, 'appt-456');
  });

  test('returns 200 on client success', async () => {
    mockClient.updatenaga.mockResolvedValue({ success: true, data: { updated: true } });
    const event = {
      pathParameters: { apptId: 'appt-1' },
      body: '{}',
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, data: { updated: true } });
  });

  test('returns 502 when client returns success=false', async () => {
    mockClient.updatenaga.mockResolvedValue({ success: false, data: 'conflict' });
    const event = { pathParameters: { apptId: 'appt-1' }, body: '{}' };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
  });

  test('returns 500 when client throws', async () => {
    mockClient.updatenaga.mockRejectedValue(new Error('update failed'));
    const event = { pathParameters: { apptId: 'appt-1' }, body: '{}' };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('update failed');
  });

  test('returns 400 on invalid JSON body (malformed input)', async () => {
    const event = { pathParameters: { apptId: 'appt-1' }, body: '{invalid}' };
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('uses event.params body as fallback when body absent', async () => {
    mockClient.updatenaga.mockResolvedValue({ success: true, data: {} });
    const event = { params: { apptId: 'appt-1', vin: 'VIN3' } };
    await handler(event);
    expect(mockClient.updatenaga).toHaveBeenCalledWith(
      { apptId: 'appt-1', vin: 'VIN3' },
      'appt-1'
    );
  });

  test('response has Content-Type: application/json header', async () => {
    mockClient.updatenaga.mockResolvedValue({ success: true, data: {} });
    const res = await handler({ pathParameters: { apptId: 'a1' }, body: '{}' });
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
