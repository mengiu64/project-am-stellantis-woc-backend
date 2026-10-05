'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
  GetSecretValueCommand: jest.fn((input) => input),
}));
const { loadSettings, requireSettings, resetCache } = require('..');

beforeEach(() => {
  resetCache();
  mockSend.mockReset();
  delete process.env.WOC_CONFIG_SECRET_ID;
  delete process.env.WOC_INTERNAL_CONFIG_SECRET_ID;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
});
afterAll(() => {
  delete process.env.WOC_CONFIG_SECRET_ID;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.WOC_INTERNAL_CONFIG_SECRET_ID;
});

test('local invocation uses environment without contacting AWS', async () => {
  expect(await loadSettings()).toBe(process.env);
  expect(mockSend).not.toHaveBeenCalled();
});
test('Lambda requires a secret reference', async () => {
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'test';
  await expect(loadSettings()).rejects.toThrow('WOC_CONFIG_SECRET_ID is required');
});
test('secret is authoritative and concurrent reads share the request', async () => {
  process.env.WOC_CONFIG_SECRET_ID = 'config';
  mockSend.mockResolvedValue({ SecretString: '{"HOST":"secret-host"}' });
  const [a, b] = await Promise.all([loadSettings(), loadSettings()]);
  expect(a).toEqual({ HOST: 'secret-host' });
  expect(b).toBe(a);
  expect(await loadSettings()).toBe(a);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith({ SecretId: 'config' });
});

test('caches integration and shared REST secrets independently in the same container', async () => {
  process.env.WOC_CONFIG_SECRET_ID = 'integration';
  process.env.WOC_INTERNAL_CONFIG_SECRET_ID = 'internal-api';
  mockSend.mockImplementation(async ({ SecretId }) => ({ SecretString: JSON.stringify({ source: SecretId }) }));
  const [integration, transport] = await Promise.all([
    loadSettings(), loadSettings('WOC_INTERNAL_CONFIG_SECRET_ID'),
  ]);
  expect(integration).toEqual({ source: 'integration' });
  expect(transport).toEqual({ source: 'internal-api' });
  expect(await loadSettings('WOC_INTERNAL_CONFIG_SECRET_ID')).toBe(transport);
  expect(mockSend).toHaveBeenCalledTimes(2);
});
test('failure propagates without secret values and a subsequent invocation retries', async () => {
  process.env.WOC_CONFIG_SECRET_ID = 'config';
  mockSend.mockRejectedValueOnce(new Error('AccessDenied')).mockResolvedValueOnce({ SecretString: '{}' });
  await expect(loadSettings()).rejects.toThrow('Cannot retrieve configuration secret');
  expect(await loadSettings()).toEqual({});
  expect(mockSend).toHaveBeenCalledTimes(2);
});
test.each([undefined, 'bad', 'null', '[]', 'true', '"text"'])('rejects invalid secret %s', async (value) => {
  process.env.WOC_CONFIG_SECRET_ID = 'config';
  mockSend.mockResolvedValue({ SecretString: value });
  await expect(loadSettings()).rejects.toThrow('Configuration secret must contain');
});
test.each([undefined, null, ''])('reports missing key without printing values %s', (value) => {
  expect(() => requireSettings({ A: value, PASSWORD: 'private' }, ['A', 'B'])).toThrow('A, B');
});
test('accepts false and zero as valid settings', () => {
  const settings = { A: false, B: 0, C: 'value' };
  expect(requireSettings(settings, ['A', 'B', 'C'])).toBe(settings);
});
