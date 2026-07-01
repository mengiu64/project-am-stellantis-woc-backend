'use strict';

jest.mock('../../src/clientFactory');

const { handler } = require('../../src/handlers/getAvHoursForRec');
const { buildClient } = require('../../src/clientFactory');

describe('getAvHoursForRec handler', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { getAvHoursForRec: jest.fn() };
    buildClient.mockReturnValue(mockClient);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 400 when all required params are missing', async () => {
    const res = await handler({});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('pdvId');
    expect(body.message).toContain('date');
    expect(body.message).toContain('ccs');
    expect(body.message).toContain('locale');
  });

  test('returns 400 when some required params are missing', async () => {
    const res = await handler({ queryStringParameters: { pdvId: 'PDV1', date: '20250601' } });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('ccs');
    expect(body.message).toContain('locale');
  });

  test('returns 200 and filtered hours on success', async () => {
    const freeHours = ['08:00', '09:00', '10:00'];
    mockClient.getAvHoursForRec.mockResolvedValue({ success: true, data: freeHours });
    const event = { queryStringParameters: { pdvId: 'PDV1', date: '20250601', ccs: 'CCS1', locale: 'fr_FR' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, data: freeHours });
    expect(mockClient.getAvHoursForRec).toHaveBeenCalledWith('PDV1', '20250601', 'CCS1', 'fr_FR', undefined);
  });

  test('passes optional ldapId to client', async () => {
    mockClient.getAvHoursForRec.mockResolvedValue({ success: true, data: [] });
    const event = { params: { pdvId: 'PDV1', date: '2025-06-01', ccs: 'CCS1', locale: 'fr_FR', ldapId: 'U123' } };
    await handler(event);
    expect(mockClient.getAvHoursForRec).toHaveBeenCalledWith('PDV1', '2025-06-01', 'CCS1', 'fr_FR', 'U123');
  });

  test('returns 502 when client returns success=false', async () => {
    mockClient.getAvHoursForRec.mockResolvedValue({ success: false, data: 'upstream error' });
    const event = { queryStringParameters: { pdvId: 'PDV1', date: '20250601', ccs: 'CCS1', locale: 'fr_FR' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
  });

  test('returns 500 when client throws', async () => {
    mockClient.getAvHoursForRec.mockRejectedValue(new Error('timeout'));
    const event = { queryStringParameters: { pdvId: 'PDV1', date: '20250601', ccs: 'CCS1', locale: 'fr_FR' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('timeout');
  });

  test('reads params from body JSON string', async () => {
    mockClient.getAvHoursForRec.mockResolvedValue({ success: true, data: [] });
    const event = { body: JSON.stringify({ pdvId: 'PDV1', date: '20250601', ccs: 'CCS1', locale: 'fr_FR' }) };
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(mockClient.getAvHoursForRec).toHaveBeenCalledWith('PDV1', '20250601', 'CCS1', 'fr_FR', undefined);
  });

  test('response has Content-Type: application/json header', async () => {
    mockClient.getAvHoursForRec.mockResolvedValue({ success: true, data: [] });
    const event = { queryStringParameters: { pdvId: 'PDV1', date: '20250601', ccs: 'CCS1', locale: 'fr_FR' } };
    const res = await handler(event);
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
