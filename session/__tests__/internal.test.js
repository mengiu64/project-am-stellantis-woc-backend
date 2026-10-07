'use strict';

jest.mock('../src/sessionContextCache', () => ({
  getCachedSessionData: jest.fn(), getCachedSessionContext: jest.fn(),
}));
const cache = require('../src/sessionContextCache');
const { handler } = require('../internal');
test.each([['getData', 'getCachedSessionData'], ['getContext', 'getCachedSessionContext']])('serves %s from the owning session cache', async (operation, fn) => {
  cache[fn].mockResolvedValue({ sincom: '123' });
  const response = await handler({
    path: `/internal/session/${operation}`, httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } }, body: '{"args":["user"]}',
  });
  expect(JSON.parse(response.body).data).toEqual({ sincom: '123' });
  expect(cache[fn]).toHaveBeenCalledWith('user');
});
