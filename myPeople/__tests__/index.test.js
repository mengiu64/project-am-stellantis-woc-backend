'use strict';

jest.mock('../myPeopleService', () => ({
  readUserProfiles: jest.fn(),
}));

const { readUserProfiles } = require('../myPeopleService');
const { handler } = require('../index');

describe('myPeople lambda handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('direct invocation with { username, identifier }', async () => {
    readUserProfiles.mockResolvedValue({ success: true });

    const event = { username: '0073741.d235', identifier: 'ID-1' };
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(readUserProfiles).toHaveBeenCalledWith({ username: '0073741.d235', identifier: 'ID-1' });
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  test('API Gateway event — reads username/identifier from queryStringParameters', async () => {
    readUserProfiles.mockResolvedValue({ profiles: [] });

    const event = {
      rawPath: '/api/mypeople/readUserProfiles',
      queryStringParameters: { username: '0073741.d235', identifier: 'ID-2' },
    };
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(readUserProfiles).toHaveBeenCalledWith({ username: '0073741.d235', identifier: 'ID-2' });
  });

  test('merges a JSON body over queryStringParameters', async () => {
    readUserProfiles.mockResolvedValue({});

    const event = {
      queryStringParameters: { username: 'from-query', identifier: 'from-query-id' },
      body: JSON.stringify({ identifier: 'from-body-id' }),
    };
    await handler(event);

    expect(readUserProfiles).toHaveBeenCalledWith({ username: 'from-query', identifier: 'from-body-id' });
  });

  test('ignores an invalid (non-JSON) body without throwing', async () => {
    readUserProfiles.mockResolvedValue({});

    const event = {
      queryStringParameters: { username: 'user1', identifier: 'id1' },
      body: 'not-json',
    };
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(readUserProfiles).toHaveBeenCalledWith({ username: 'user1', identifier: 'id1' });
  });

  test('returns 400 when a required parameter is missing', async () => {
    readUserProfiles.mockRejectedValue(new Error('[myPeople] username is required'));

    const res = await handler({ identifier: 'id1' });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('username is required');
  });

  test('returns 502 on a downstream/upstream failure', async () => {
    readUserProfiles.mockRejectedValue(new Error('[myPeople] readUserProfiles failed: HTTP 500 - {}'));

    const res = await handler({ username: 'user1', identifier: 'id1' });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  test('handles an event with no queryStringParameters and no body gracefully', async () => {
    readUserProfiles.mockRejectedValue(new Error('[myPeople] username is required'));

    const res = await handler({});

    expect(res.statusCode).toBe(400);
    expect(readUserProfiles).toHaveBeenCalledWith({});
  });
});
