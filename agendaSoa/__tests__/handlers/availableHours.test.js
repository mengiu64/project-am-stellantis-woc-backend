'use strict';

jest.mock('../../src/clientFactory');

const { handler } = require('../../src/handlers/availableHours');
const { buildClient } = require('../../src/clientFactory');

describe('availableHours handler', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { availableHours: jest.fn() };
    buildClient.mockReturnValue(mockClient);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 400 if id is missing (no params at all)', async () => {
    const res = await handler({});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('id');
  });

  test('returns 400 if id is missing from queryStringParameters', async () => {
    const res = await handler({ queryStringParameters: { other: 'value' } });
    expect(res.statusCode).toBe(400);
  });

  test('returns 200 on client success', async () => {
    mockClient.availableHours.mockResolvedValue({ success: true, data: ['08:00', '09:00'] });
    const event = { queryStringParameters: { id: 'pdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, data: ['08:00', '09:00'] });
  });

  test('returns 502 when client returns success=false', async () => {
    mockClient.availableHours.mockResolvedValue({ success: false, data: 'upstream error' });
    const event = { queryStringParameters: { id: 'pdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
  });

  test('returns 500 when client throws', async () => {
    mockClient.availableHours.mockRejectedValue(new Error('timeout'));
    const event = { queryStringParameters: { id: 'pdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('timeout');
  });

  test('passes id from params', async () => {
    mockClient.availableHours.mockResolvedValue({ success: true, data: [] });
    const event = { params: { id: 'pdv-from-params' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.availableHours).toHaveBeenCalledWith({ id: 'pdv-from-params' });
  });

  test('response has Content-Type: application/json header', async () => {
    mockClient.availableHours.mockResolvedValue({ success: true, data: [] });
    const res = await handler({ queryStringParameters: { id: 'pdv1' } });
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
