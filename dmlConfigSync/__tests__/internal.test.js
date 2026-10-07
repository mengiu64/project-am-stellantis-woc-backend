'use strict';

jest.mock('../db', () => ({ getPool: jest.fn() }));
jest.mock('../DmlConfigRepository', () => ({ getDmlConfiguration: jest.fn() }));
jest.mock('../DmsSettingsRepository', () => ({ getDmsSettings: jest.fn(), registerDealer: jest.fn() }));
const { getPool } = require('../db');
const configuration = require('../DmlConfigRepository');
const settings = require('../DmsSettingsRepository');
const { handler } = require('../internal');
test.each(['getDmlConfiguration', 'getDmsSettings', 'registerDealer'])('dispatches cache operation %s in owning service', async (op) => {
  const pool = {};
  getPool.mockResolvedValue(pool);
  const fn = configuration[op] || settings[op];
  fn.mockResolvedValue({ result: true });
  const params = { country: 'fr', language: 'fr' };
  const response = await handler({
    path: `/internal/dmlconfigsync/${op}`, httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } }, body: JSON.stringify({ args: [params] }),
  });
  expect(JSON.parse(response.body).data).toEqual({ result: true });
  expect(fn).toHaveBeenCalledWith(pool, params);
});
