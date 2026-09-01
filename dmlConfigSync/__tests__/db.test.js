'use strict';

jest.mock('http');
jest.mock('pg');
jest.mock('../config', () => ({
  db: {
    host: 'db.test.local',
    port: undefined,
    name: undefined,
    user: undefined,
    password: undefined,
    ssl: true,
  },
  secrets: {
    dbSecretId: 'sm-test-aurora-app',
    extensionPort: 2773,
  },
}));

const http = require('http');
const { Pool } = require('pg');
const config = require('../config');
const db = require('../db');

function buildMockRes(statusCode, body) {
  return {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(Buffer.from(body));
      if (event === 'end') cb();
    }),
  };
}

describe('db.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db._resetPool();
    process.env.AWS_SESSION_TOKEN = 'test-session-token';
    config.db.port = undefined;
    config.db.name = undefined;
    config.db.user = undefined;
    config.db.password = undefined;
  });

  afterEach(() => {
    db._resetPool();
    delete process.env.AWS_SESSION_TOKEN;
  });

  describe('fetchSecretJson', () => {
    test('resolves with the parsed SecretString on HTTP 200', async () => {
      const secret = { username: 'wiadvisor_app', password: 'pw', dbname: 'wiadvisor', port: 5432 };
      const mockRes = buildMockRes(200, JSON.stringify({ SecretString: JSON.stringify(secret) }));
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      const result = await db.fetchSecretJson('sm-test-aurora-app');
      expect(result).toEqual(secret);

      const [options] = http.get.mock.calls[0];
      expect(options.hostname).toBe('localhost');
      expect(options.port).toBe(2773);
      expect(options.path).toBe('/secretsmanager/get?secretId=sm-test-aurora-app');
      expect(options.headers['X-Aws-Parameters-Secrets-Token']).toBe('test-session-token');
    });

    test('rejects when the extension returns a non-200 status', async () => {
      const mockRes = buildMockRes(500, 'internal error');
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await expect(db.fetchSecretJson('sm-test-aurora-app')).rejects.toThrow(/HTTP 500/);
    });

    test('rejects on invalid JSON', async () => {
      const mockRes = buildMockRes(200, 'not-json');
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await expect(db.fetchSecretJson('sm-test-aurora-app')).rejects.toThrow(/invalid response/);
    });

    test('rejects when the http request errors', async () => {
      const err = new Error('ECONNREFUSED');
      http.get.mockImplementation(() => ({ on: jest.fn((event, cb) => { if (event === 'error') cb(err); }) }));

      await expect(db.fetchSecretJson('sm-test-aurora-app')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('getPool', () => {
    test('fetches credentials from Secrets Manager when user/password are not set via env', async () => {
      const secret = { username: 'wiadvisor_app', password: 'pw', dbname: 'wiadvisor', port: 5432 };
      const mockRes = buildMockRes(200, JSON.stringify({ SecretString: JSON.stringify(secret) }));
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await db.getPool();

      expect(http.get).toHaveBeenCalledTimes(1);
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        host: 'db.test.local',
        port: 5432,
        database: 'wiadvisor',
        user: 'wiadvisor_app',
        password: 'pw',
        ssl: { rejectUnauthorized: false },
      }));
    });

    test('uses env-provided user/password directly, without calling Secrets Manager', async () => {
      config.db.user = 'local_user';
      config.db.password = 'local_pw';
      config.db.name = 'local_db';
      config.db.port = 5433;

      await db.getPool();

      expect(http.get).not.toHaveBeenCalled();
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        host: 'db.test.local',
        port: 5433,
        database: 'local_db',
        user: 'local_user',
        password: 'local_pw',
      }));
    });

    test('disables ssl when config.db.ssl is false', async () => {
      config.db.user = 'u';
      config.db.password = 'p';
      config.db.ssl = false;

      await db.getPool();

      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ ssl: false }));
      config.db.ssl = true;
    });

    test('caches the pool across multiple calls (Secrets Manager/Pool built only once)', async () => {
      config.db.user = 'u';
      config.db.password = 'p';

      const poolA = await db.getPool();
      const poolB = await db.getPool();

      expect(poolA).toBe(poolB);
      expect(Pool).toHaveBeenCalledTimes(1);
    });

    test('resets the cache on failure, allowing a retry on the next call', async () => {
      http.get.mockImplementation(() => ({ on: jest.fn((event, cb) => { if (event === 'error') cb(new Error('boom')); }) }));

      await expect(db.getPool()).rejects.toThrow('boom');

      const secret = { username: 'wiadvisor_app', password: 'pw', dbname: 'wiadvisor', port: 5432 };
      const mockRes = buildMockRes(200, JSON.stringify({ SecretString: JSON.stringify(secret) }));
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await expect(db.getPool()).resolves.toBeDefined();
    });
  });
});
