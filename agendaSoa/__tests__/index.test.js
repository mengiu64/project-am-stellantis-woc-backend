'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/handlers/appointment', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/availableHours', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/cCSList', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/data', () => ({ handler: jest.fn() }));

const { handler } = require('../index');
const appointment   = require('../src/handlers/appointment');
const availableHours = require('../src/handlers/availableHours');
const cCSList       = require('../src/handlers/cCSList');
const data          = require('../src/handlers/data');

describe('agendaSoa Lambda dispatcher (index.js)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('routes event.action=appointment to appointment handler', async () => {
    appointment.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'appointment', queryStringParameters: {} };
    const res = await handler(event, {});
    expect(appointment.handler).toHaveBeenCalledWith(event, {});
    expect(res.statusCode).toBe(200);
  });

  test('routes event.action=availableHours to availableHours handler', async () => {
    availableHours.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'availableHours' };
    await handler(event, {});
    expect(availableHours.handler).toHaveBeenCalledWith(event, {});
  });

  test('routes event.action=cCSList to cCSList handler', async () => {
    cCSList.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'cCSList' };
    await handler(event, {});
    expect(cCSList.handler).toHaveBeenCalledWith(event, {});
  });

  test('routes event.action=data to data handler', async () => {
    data.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'data' };
    await handler(event, {});
    expect(data.handler).toHaveBeenCalledWith(event, {});
  });

  test('uses event.httpMethod as fallback when action is absent', async () => {
    appointment.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { httpMethod: 'appointment' };
    await handler(event, {});
    expect(appointment.handler).toHaveBeenCalledWith(event, {});
  });

  test('returns 400 for unknown action', async () => {
    const event = { action: 'unknown' };
    const res = await handler(event, {});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('unknown');
  });

  test('returns 400 when action is missing', async () => {
    const res = await handler({}, {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('response has Content-Type header', async () => {
    const res = await handler({ action: 'unknown' }, {});
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
