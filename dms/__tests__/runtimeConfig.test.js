'use strict';

jest.mock('../secretsLoader', () => ({ loadServiceUrls: jest.fn() }));

const { loadServiceUrls } = require('../secretsLoader');
const { getConfig, invalidateConfig } = require('../config');
const keys = [
  'DMS_PING_URL', 'DMS_PING_CLIENT_ID', 'DMS_PING_CLIENT_SECRET',
  'DML_BASE_URL', 'DML_SETTINGS_PATH', 'DML_INQUIRY_PATH',
  'DML_COMPANY_TYPES_PATH', 'DML_CUSTOMER_TITLES_PATH',
  'DML_IBM_CLIENT_ID', 'DML_IBM_CLIENT_SECRET', 'DML_X_TARGET_ENV',
];

beforeEach(() => {
  invalidateConfig();
  jest.clearAllMocks();
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-dms';
  process.env.SERVICE_URLS_SECRET_ID = 'test-service-urls';
});

afterEach(() => {
  invalidateConfig();
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.SERVICE_URLS_SECRET_ID;
});

test('reads all integration values including target environment from the secret', async () => {
  loadServiceUrls.mockResolvedValue(Object.fromEntries(keys.map((key) => [key, `secret-${key}`])));
  const config = await getConfig();
  expect(config.auth.clientId).toBe('secret-DMS_PING_CLIENT_ID');
  expect(config.dml.baseUrl).toBe('secret-DML_BASE_URL');
  expect(config.dml.xTargetEnv).toBe('secret-DML_X_TARGET_ENV');
});

test('requires a secret reference in Lambda', async () => {
  delete process.env.SERVICE_URLS_SECRET_ID;
  await expect(getConfig()).rejects.toThrow('SERVICE_URLS_SECRET_ID is required');
  expect(loadServiceUrls).not.toHaveBeenCalled();
});

test('propagates retrieval failures and permits a subsequent retry', async () => {
  loadServiceUrls.mockRejectedValueOnce(new Error('Secret unavailable')).mockResolvedValueOnce({});
  await expect(getConfig()).rejects.toThrow('Secret unavailable');
  await expect(getConfig()).rejects.toThrow('Missing configuration keys');
  expect(loadServiceUrls).toHaveBeenCalledTimes(2);
});
