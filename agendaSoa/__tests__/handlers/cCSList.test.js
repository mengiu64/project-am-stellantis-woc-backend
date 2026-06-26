'use strict';

jest.mock('../../src/clientFactory');

const { handler } = require('../../src/handlers/cCSList');
const { buildClient } = require('../../src/clientFactory');

describe('cCSList handler', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { cCSList: jest.fn() };
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
    const mockData = [{ LOGINNAME: 'user1', FIRSTNAME: 'John', LASTNAME: 'Doe' }];
    mockClient.cCSList.mockResolvedValue({ success: true, data: mockData });
    const event = { queryStringParameters: { id: 'pdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual(mockData);
  });

  test('returns 502 when client returns success=false', async () => {
    mockClient.cCSList.mockResolvedValue({ success: false, data: 'error' });
    const event = { queryStringParameters: { id: 'pdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
  });

  test('returns 500 when client throws', async () => {
    mockClient.cCSList.mockRejectedValue(new Error('service unavailable'));
    const event = { queryStringParameters: { id: 'pdv1' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('service unavailable');
  });

  test('passes id from body JSON string', async () => {
    mockClient.cCSList.mockResolvedValue({ success: true, data: [] });
    const event = { body: JSON.stringify({ id: 'pdv-body' }) };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.cCSList).toHaveBeenCalledWith({ id: 'pdv-body' });
  });

  test('response has Content-Type: application/json header', async () => {
    mockClient.cCSList.mockResolvedValue({ success: true, data: [] });
    const res = await handler({ queryStringParameters: { id: 'pdv1' } });
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
