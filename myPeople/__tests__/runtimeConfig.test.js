'use strict';

const runtime = require('../../runtimeConfig');

afterEach(() => {
  delete process.env.WOC_CONFIG_SECRET_ID;
  jest.restoreAllMocks();
  jest.resetModules();
});

test('reads all myPeople integration values from the runtime secret', async () => {
  process.env.WOC_CONFIG_SECRET_ID = 'test-config';
  jest.spyOn(runtime, 'loadSettings').mockResolvedValue({
    MYPEOPLE_HOST: 'https://secret.test/',
    MYPEOPLE_USERNAME: 'secret-user', MYPEOPLE_PASSWORD: 'secret-password',
    MYPEOPLE_IBM_CLIENT_ID: 'secret-client', MYPEOPLE_IDENTIFIER: 'secret-identifier',
  });
  const config = require('../config');
  expect(await config.getMyPeopleConfig()).toEqual({
    host: 'https://secret.test', basePath: '/applications/mypeople/iursma/v1',
    username: 'secret-user', password: 'secret-password',
    ibmClientId: 'secret-client', identifier: 'secret-identifier',
  });
});

test('rejects incomplete configuration instead of falling back to environment', async () => {
  process.env.WOC_CONFIG_SECRET_ID = 'test-config';
  jest.spyOn(require('../../runtimeConfig'), 'loadSettings').mockResolvedValue({});
  await expect(require('../config').getMyPeopleConfig()).rejects.toThrow('Missing configuration keys');
});
