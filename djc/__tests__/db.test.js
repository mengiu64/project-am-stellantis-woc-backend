'use strict';

jest.mock('http');
jest.mock('pg');

const http = require('http');
const { Pool } = require('pg');
const db = require('../db');

const ENV_KEYS = [
  'DJC_DB_HOST', 'DJC_DB_PORT', 'DJC_DB_NAME', 'DJC_DB_USER', 'DJC_DB_PASSWORD',
  'DJC_DB_SSL', 'DJC_DB_SECRET_ID', 'PARAMETERS_SECRETS_EXTENSION_HTTP_PORT', 'AWS_SESSION_TOKEN',
];

function buildMockRes(statusCode, body) {
  return {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(Buffer.from(body));
      if (event === 'end') cb();
    }),
  };
}

function mockSecretResponse(secret) {
  const mockRes = buildMockRes(200, JSON.stringify({ SecretString: JSON.stringify(secret) }));
  http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });
}

describe('djc/db.js', () => {
  const savedEnv = {};

  beforeAll(() => {
    ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    db._resetPool();
    ENV_KEYS.forEach((k) => { delete process.env[k]; });
    process.env.DJC_DB_HOST = 'db.test.local';
    process.env.AWS_SESSION_TOKEN = 'test-session-token';
  });

  afterAll(() => {
    db._resetPool();
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  describe('fetchSecretJson', () => {
    test('resolves with the parsed SecretString on HTTP 200', async () => {
      const secret = { username: 'wiadvisor_app', password: 'pw' };
      mockSecretResponse(secret);

      await expect(db.fetchSecretJson('sm-test', 2773)).resolves.toEqual(secret);

      const [options] = http.get.mock.calls[0];
      expect(options.hostname).toBe('localhost');
      expect(options.port).toBe(2773);
      expect(options.path).toBe('/secretsmanager/get?secretId=sm-test');
      expect(options.headers['X-Aws-Parameters-Secrets-Token']).toBe('test-session-token');
    });

    test('rejects when the extension returns a non-200 status', async () => {
      const mockRes = buildMockRes(500, 'internal error');
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await expect(db.fetchSecretJson('sm-test', 2773)).rejects.toThrow(/HTTP 500/);
    });

    test('rejects on invalid JSON', async () => {
      const mockRes = buildMockRes(200, 'not-json');
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await expect(db.fetchSecretJson('sm-test', 2773)).rejects.toThrow(/invalid response/);
    });

    test('rejects when the http request errors', async () => {
      const err = new Error('ECONNREFUSED');
      http.get.mockImplementation(() => ({ on: jest.fn((event, cb) => { if (event === 'error') cb(err); }) }));

      await expect(db.fetchSecretJson('sm-test', 2773)).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('getPool', () => {
    test('uses proxy metadata from the secret when no host is configured', async () => {
      delete process.env.DJC_DB_HOST;
      process.env.DJC_DB_SECRET_ID = 'test-db-secret';
      mockSecretResponse({
        username: 'app', password: 'pw', host: 'cluster.test', port: 5432, dbname: 'cluster-db',
        proxyhost: 'proxy.test', proxyport: 5433, proxydbname: 'proxy-db',
      });
      await db.getPool();
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ host: 'proxy.test', port: 5433, database: 'proxy-db' }));
      db._resetPool();
      mockSecretResponse({ username: 'app', password: 'pw', host: 'cluster.test' });
      await expect(db.getPool()).rejects.toThrow('proxyhost');
    });

    test('fetches credentials from Secrets Manager (default secret id/port) when user/password are not set', async () => {
      mockSecretResponse({ username: 'wiadvisor_app', password: 'pw', dbname: 'wiadvisor', port: 5432 });

      await db.getPool();

      const [options] = http.get.mock.calls[0];
      expect(options.port).toBe(2773);
      expect(options.path).toBe('/secretsmanager/get?secretId=sm-np-bsn0027990-dev-aurora-app');
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        host: 'db.test.local',
        port: 5432,
        database: 'wiadvisor',
        user: 'wiadvisor_app',
        password: 'pw',
        max: 3,
        ssl: { rejectUnauthorized: false },
      }));
    });

    test('uses DJC_DB_SECRET_ID and extension port from env', async () => {
      process.env.DJC_DB_SECRET_ID = 'sm-custom';
      process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT = '9999';
      mockSecretResponse({ username: 'u', password: 'p' });

      await db.getPool();

      const [options] = http.get.mock.calls[0];
      expect(options.port).toBe(9999);
      expect(options.path).toBe('/secretsmanager/get?secretId=sm-custom');
      // dbname/port assenti dal secret -> default
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ port: 5432, database: 'wiadvisor' }));
    });

    test('uses env-provided user/password/name/port directly, without Secrets Manager, and disables TLS', async () => {
      process.env.DJC_DB_USER = 'local_user';
      process.env.DJC_DB_PASSWORD = 'local_pw';
      process.env.DJC_DB_NAME = 'local_db';
      process.env.DJC_DB_PORT = '5433';
      process.env.DJC_DB_SSL = 'false';

      await db.getPool();

      expect(http.get).not.toHaveBeenCalled();
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        host: 'db.test.local',
        port: 5433,
        database: 'local_db',
        user: 'local_user',
        password: 'local_pw',
        ssl: false,
      }));
    });

    test('caches the pool across calls', async () => {
      process.env.DJC_DB_USER = 'u';
      process.env.DJC_DB_PASSWORD = 'p';

      const first = await db.getPool();
      const second = await db.getPool();

      expect(first).toBe(second);
      expect(Pool).toHaveBeenCalledTimes(1);
    });

    test('rejects when DJC_DB_HOST is missing and allows a retry afterwards', async () => {
      delete process.env.DJC_DB_HOST;
      await expect(db.getPool()).rejects.toThrow(/DJC_DB_HOST/);
      expect(Pool).not.toHaveBeenCalled();

      process.env.DJC_DB_HOST = 'db.test.local';
      process.env.DJC_DB_USER = 'u';
      process.env.DJC_DB_PASSWORD = 'p';
      await db.getPool();
      expect(Pool).toHaveBeenCalledTimes(1);
    });
  });
});
