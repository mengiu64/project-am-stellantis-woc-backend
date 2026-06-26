'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/handlers/createnaga', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/updatenaga', () => ({ handler: jest.fn() }));

const { handler } = require('../index');
const createnaga = require('../src/handlers/createnaga');
const updatenaga = require('../src/handlers/updatenaga');

describe('agendaSoaNaga Lambda dispatcher (index.js)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('routes event.action=createnaga to createnaga handler', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'createnaga', body: '{}' };
    const res = await handler(event, {});
    expect(createnaga.handler).toHaveBeenCalledWith(event, {});
    expect(res.statusCode).toBe(200);
  });

  test('routes event.action=updatenaga to updatenaga handler', async () => {
    updatenaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { action: 'updatenaga', body: '{}' };
    await handler(event, {});
    expect(updatenaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('uses event.httpMethod as fallback when action is absent', async () => {
    createnaga.handler.mockResolvedValue({ statusCode: 200, body: '{}' });
    const event = { httpMethod: 'createnaga' };
    await handler(event, {});
    expect(createnaga.handler).toHaveBeenCalledWith(event, {});
  });

  test('returns 400 for unknown action', async () => {
    const event = { action: 'deletenaga' };
    const res = await handler(event, {});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('deletenaga');
  });

  test('returns 400 when action is missing', async () => {
    const res = await handler({}, {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('error response lists valid actions', async () => {
    const res = await handler({ action: 'bad' }, {});
    const body = JSON.parse(res.body);
    expect(body.message).toContain('createnaga');
    expect(body.message).toContain('updatenaga');
  });

  test('response has Content-Type header', async () => {
    const res = await handler({ action: 'bad' }, {});
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
