'use strict';

const runtime = require('../../runtimeConfig');
const { PkManager } = require('../PkManager');

afterEach(() => {
  delete process.env.WOC_CONFIG_SECRET_ID;
  jest.restoreAllMocks();
});

test('loads business defaults from its secret, preserves explicit overrides and caches initialization', async () => {
  process.env.WOC_CONFIG_SECRET_ID = 'test-config';
  const spy = jest.spyOn(runtime, 'loadSettings').mockResolvedValue({
    EPER_CODDEALER: 'secret-dealer', EPER_CODMARKET: 'secret-market',
    MP_LANGUAGE_CODE: 'secret-language', DOCSOA_CODEPDV: 'secret-pdv',
  });
  const manager = new PkManager({ eper: { coddealer: 'request-dealer' } });
  await manager._loadConfig();
  await manager._loadConfig();
  expect(manager.wsConfig.eper.coddealer).toBe('request-dealer');
  expect(manager.wsConfig.eper.codmarket).toBe('secret-market');
  expect(manager.wsConfig.menupricing.languageCode).toBe('secret-language');
  expect(manager.wsConfig.docsoa.codePdv).toBe('secret-pdv');
  expect(spy).toHaveBeenCalledTimes(1);
});

test('propagates secret retrieval errors instead of using environment values', async () => {
  process.env.WOC_CONFIG_SECRET_ID = 'test-config';
  jest.spyOn(runtime, 'loadSettings').mockRejectedValue(new Error('Cannot retrieve configuration secret'));
  await expect(new PkManager()._loadConfig()).rejects.toThrow('Cannot retrieve configuration secret');
});

test('requires a configuration secret when running in Lambda', async () => {
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-pkmanager';
  try {
    await expect(new PkManager()._loadConfig()).rejects.toThrow('WOC_CONFIG_SECRET_ID is required');
  } finally {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  }
});
