'use strict';

jest.mock('../myPeopleService', () => ({ readUserProfiles: jest.fn() }));
const { readUserProfiles } = require('../myPeopleService');
const { handler } = require('../internal');
test('serves user profiles over authenticated internal REST', async () => {
  readUserProfiles.mockResolvedValue({ User: { name: 'user' } });
  const response = await handler({
    path: '/internal/mypeople/readUserProfiles', httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } },
    body: '{"args":[{"username":"user"}]}',
  });
  expect(JSON.parse(response.body).data).toEqual({ User: { name: 'user' } });
  expect(readUserProfiles).toHaveBeenCalledWith({ username: 'user' });
});
