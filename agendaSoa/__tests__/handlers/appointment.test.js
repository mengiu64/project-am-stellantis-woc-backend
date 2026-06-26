'use strict';

jest.mock('../../src/clientFactory');

const { handler } = require('../../src/handlers/appointment');
const { buildClient } = require('../../src/clientFactory');

describe('appointment handler', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { appointment: jest.fn() };
    buildClient.mockReturnValue(mockClient);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 200 on client success with queryStringParameters', async () => {
    mockClient.appointment.mockResolvedValue({ success: true, data: { slots: [] } });
    const event = { queryStringParameters: { ccs: 'ccs1', date: '2024-01-01' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, data: { slots: [] } });
  });

  test('returns 200 on client success with JSON body', async () => {
    mockClient.appointment.mockResolvedValue({ success: true, data: {} });
    const event = { body: JSON.stringify({ ccs: 'ccs1', date: '2024-01-01' }) };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.appointment).toHaveBeenCalledWith({ ccs: 'ccs1', date: '2024-01-01' });
  });

  test('returns 502 when client returns success=false', async () => {
    mockClient.appointment.mockResolvedValue({ success: false, data: 'error msg' });
    const event = { queryStringParameters: {} };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('returns 500 when client throws', async () => {
    mockClient.appointment.mockRejectedValue(new Error('Network error'));
    const event = { queryStringParameters: {} };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('Network error');
  });

  test('merges queryStringParameters, body and params', async () => {
    mockClient.appointment.mockResolvedValue({ success: true, data: {} });
    const event = {
      queryStringParameters: { locale: 'fr_FR' },
      body: JSON.stringify({ ccs: 'ccs1' }),
      params: { pdvId: 'pdv1' },
    };
    await handler(event);
    expect(mockClient.appointment).toHaveBeenCalledWith({
      locale: 'fr_FR',
      ccs: 'ccs1',
      pdvId: 'pdv1',
    });
  });

  test('handles event with no queryStringParameters, body, or params', async () => {
    mockClient.appointment.mockResolvedValue({ success: true, data: {} });
    const res = await handler({});
    expect(res.statusCode).toBe(200);
    expect(mockClient.appointment).toHaveBeenCalledWith({});
  });

  test('response has Content-Type: application/json header', async () => {
    mockClient.appointment.mockResolvedValue({ success: true, data: {} });
    const res = await handler({});
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
