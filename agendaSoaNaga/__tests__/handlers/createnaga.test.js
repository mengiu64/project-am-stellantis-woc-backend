'use strict';

jest.mock('../../src/clientFactory');

const { handler } = require('../../src/handlers/createnaga');
const { buildClient } = require('../../src/clientFactory');

describe('createnaga handler', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { createnaga: jest.fn() };
    buildClient.mockReturnValue(mockClient);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 200 on client success with JSON body', async () => {
    const payload = { vin: 'VIN123', date: '2024-01-01' };
    mockClient.createnaga.mockResolvedValue({ success: true, data: { id: 'appt1' } });
    const event = { body: JSON.stringify(payload) };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.createnaga).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual({ success: true, data: { id: 'appt1' } });
  });

  test('uses event.params as fallback when body is absent', async () => {
    const params = { vin: 'VIN456' };
    mockClient.createnaga.mockResolvedValue({ success: true, data: {} });
    const event = { params };
    await handler(event);
    expect(mockClient.createnaga).toHaveBeenCalledWith(params);
  });

  test('returns empty object when both body and params are absent', async () => {
    mockClient.createnaga.mockResolvedValue({ success: true, data: {} });
    await handler({});
    expect(mockClient.createnaga).toHaveBeenCalledWith({});
  });

  test('returns 502 when client returns success=false', async () => {
    mockClient.createnaga.mockResolvedValue({ success: false, data: 'upstream error' });
    const event = { body: '{}' };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
  });

  test('returns 500 when client throws', async () => {
    mockClient.createnaga.mockRejectedValue(new Error('NAGA service down'));
    const event = { body: '{}' };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('NAGA service down');
  });

  test('returns 500 on invalid JSON body', async () => {
    const event = { body: 'not-valid-json' };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
  });

  test('response has Content-Type: application/json header', async () => {
    mockClient.createnaga.mockResolvedValue({ success: true, data: {} });
    const res = await handler({ body: '{}' });
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
