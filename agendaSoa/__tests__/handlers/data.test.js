'use strict';

jest.mock('../../src/clientFactory');

const { handler } = require('../../src/handlers/data');
const { buildClient } = require('../../src/clientFactory');

describe('data handler', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { data: jest.fn() };
    buildClient.mockReturnValue(mockClient);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 400 if id is missing', async () => {
    const res = await handler({});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('id');
  });

  test('returns 200 on client success', async () => {
    const mockData = [{ plaDtoId: '123', status: 'active' }];
    mockClient.data.mockResolvedValue({ success: true, data: mockData });
    const event = { queryStringParameters: { id: 'rdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual(mockData);
  });

  test('returns 502 when client returns success=false', async () => {
    mockClient.data.mockResolvedValue({ success: false, data: '404: NOT_FOUND: ERROR' });
    const event = { queryStringParameters: { id: 'rdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
  });

  test('returns 500 when client throws', async () => {
    mockClient.data.mockRejectedValue(new Error('unexpected error'));
    const event = { queryStringParameters: { id: 'rdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('unexpected error');
  });

  test('passes id from pathParameters', async () => {
    mockClient.data.mockResolvedValue({ success: true, data: [] });
    const event = { params: { id: 'rdv-path' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.data).toHaveBeenCalledWith({ id: 'rdv-path' });
  });

  test('response body is valid JSON string', async () => {
    mockClient.data.mockResolvedValue({ success: true, data: [] });
    const res = await handler({ queryStringParameters: { id: 'rdv1' } });
    expect(() => JSON.parse(res.body)).not.toThrow();
  });
});
