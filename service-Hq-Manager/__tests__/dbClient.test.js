'use strict';

/**
 * Unit test per shared/dbClient.js (connessione Aurora PostgreSQL via RDS Proxy).
 * Mock di @aws-sdk/client-secrets-manager, @aws-sdk/client-ssm e pg per evitare
 * qualunque chiamata di rete reale.
 *
 * NB: smClient/ssmClient sono istanziati UNA SOLA VOLTA a require-time del modulo
 * (singleton di modulo), quindi qui il modulo viene richiesto una sola volta (in
 * cima al file) e lo stato interno (cachedPool/cachedDbSecretArn/
 * cachedRdsProxyEndpoint) viene azzerato tra un test e l'altro con
 * dbClient.invalidatePool() (esportata proprio per questo scopo), invece di
 * jest.resetModules() (che romperebbe il riferimento ai mock già richiesti qui).
 */

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  GetSecretValueCommand: jest.fn((input) => ({ input })),
}));
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  GetParameterCommand: jest.fn((input) => ({ input })),
}));
jest.mock('pg');

const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { SSMClient } = require('@aws-sdk/client-ssm');
const { Pool } = require('pg');
const dbClient = require('../shared/dbClient');

const ORIGINAL_ENV = { ...process.env };

// Istanza (unica, creata a require-time del modulo) del client Secrets Manager/SSM
// mockato — recuperata una volta e riusata in tutti i test.
const smSend = SecretsManagerClient.mock.results[0].value.send;
const ssmSend = SSMClient.mock.results[0].value.send;

// Ogni chiamata a getPool() che non pesca dalla cache crea un nuovo `new Pool(...)`:
// la factory qui sotto traccia l'ultima istanza creata, così i test possono
// configurarne/verificarne il comportamento (connect/end/on/query).
let lastPoolInstance;
function makePoolInstance() {
  lastPoolInstance = {
    connect: jest.fn().mockResolvedValue({ release: jest.fn() }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    query: jest.fn(),
  };
  return lastPoolInstance;
}

function setupSsmDefaults() {
  ssmSend.mockImplementation(async (command) => {
    const paramName = command.input.Name;
    if (paramName === 'dummy-secret-arn-param') {
      return { Parameter: { Value: 'arn:aws:secretsmanager:eu-west-1:111111111111:secret:dummy-secret' } };
    }
    if (paramName === 'dummy-rds-proxy-endpoint-param') {
      return { Parameter: { Value: 'proxy.dummy.eu-west-1.rds.amazonaws.com' } };
    }
    throw new Error(`Parametro SSM inatteso: ${paramName}`);
  });
}

function setupSecretsManagerDefaults() {
  smSend.mockResolvedValue({
    SecretString: JSON.stringify({
      dbname: 'wiadvisor',
      engine: 'postgres',
      password: 'secret-pw',
      port: 5432,
      username: 'wiadvisor_app',
    }),
  });
}

describe('shared/dbClient', () => {
  beforeEach(() => {
    dbClient.invalidatePool();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DB_LOCAL_MODE;
    delete process.env.DB_HOST;
    delete process.env.DB_SSL;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_PORT;
    delete process.env.DB_SECRET_ARN_PARAM;
    delete process.env.RDS_PROXY_ENDPOINT_PARAM;

    Pool.mockImplementation(makePoolInstance);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── Modalità remota (RDS Proxy + Secrets Manager via SSM) ─────────────────

  describe('modalità remota (default, DB_LOCAL_MODE non impostato)', () => {
    beforeEach(() => {
      process.env.DB_SECRET_ARN_PARAM = 'dummy-secret-arn-param';
      process.env.RDS_PROXY_ENDPOINT_PARAM = 'dummy-rds-proxy-endpoint-param';
      setupSsmDefaults();
      setupSecretsManagerDefaults();
    });

    test('recupera ARN secret + endpoint da SSM e credenziali da Secrets Manager, poi crea il Pool con ssl abilitato', async () => {
      const pool = await dbClient.getPool();

      expect(pool).toBe(lastPoolInstance);
      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'proxy.dummy.eu-west-1.rds.amazonaws.com',
          port: 5432,
          database: 'wiadvisor',
          user: 'wiadvisor_app',
          password: 'secret-pw',
          ssl: true,
          connectionTimeoutMillis: 5000,
          max: 1,
        }),
      );
      expect(lastPoolInstance.connect).toHaveBeenCalledTimes(1);
    });

    test('errore se DB_SECRET_ARN_PARAM non è configurato', async () => {
      delete process.env.DB_SECRET_ARN_PARAM;
      await expect(dbClient.getPool()).rejects.toThrow(
        "Variabile d'ambiente DB_SECRET_ARN_PARAM non configurata",
      );
    });

    test('errore se RDS_PROXY_ENDPOINT_PARAM non è configurato', async () => {
      delete process.env.RDS_PROXY_ENDPOINT_PARAM;
      await expect(dbClient.getPool()).rejects.toThrow(
        "Variabile d'ambiente RDS_PROXY_ENDPOINT_PARAM non configurata",
      );
    });

    test('errore se il secret non contiene SecretString', async () => {
      smSend.mockResolvedValue({});
      await expect(dbClient.getPool()).rejects.toThrow('Il secret non contiene SecretString');
    });

    test('riusa il pool tra invocazioni (warm start): SSM/Secrets Manager interrogati una sola volta', async () => {
      const first = await dbClient.getPool();
      const second = await dbClient.getPool();

      expect(first).toBe(second);
      expect(Pool).toHaveBeenCalledTimes(1);
      expect(ssmSend).toHaveBeenCalledTimes(2); // 1 getDbSecretArn + 1 getRdsProxyEndpoint
      expect(smSend).toHaveBeenCalledTimes(1);
    });

    test('invalidatePool() forza il refresh: SSM/Secrets Manager/Pool richiamati di nuovo', async () => {
      await dbClient.getPool();
      dbClient.invalidatePool();
      await dbClient.getPool();

      expect(Pool).toHaveBeenCalledTimes(2);
      expect(ssmSend).toHaveBeenCalledTimes(4);
      expect(smSend).toHaveBeenCalledTimes(2);
    });

    test('se pool.connect() fallisce, invalida il pool, chiama pool.end() e propaga l\'errore', async () => {
      Pool.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('connection refused')),
        end: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        query: jest.fn(),
      }));
      const failedInstance = () => Pool.mock.results[0].value;

      await expect(dbClient.getPool()).rejects.toThrow('connection refused');
      expect(failedInstance().end).toHaveBeenCalledTimes(1);

      // Il pool fallito non è stato messo in cache: la chiamata successiva ne crea uno nuovo.
      Pool.mockImplementationOnce(makePoolInstance);
      const pool = await dbClient.getPool();
      expect(pool).toBe(lastPoolInstance);
      expect(Pool).toHaveBeenCalledTimes(2);
    });

    test('pool.end() che fallisce durante la gestione dell\'errore di connect non maschera l\'errore originale', async () => {
      Pool.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('connection refused')),
        end: jest.fn().mockRejectedValue(new Error('end failed too')),
        on: jest.fn(),
        query: jest.fn(),
      }));

      await expect(dbClient.getPool()).rejects.toThrow('connection refused');
    });

    test('il listener "error" del pool invalida il pool in cache', async () => {
      await dbClient.getPool();
      expect(lastPoolInstance.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Simulo l'evento 'error' emesso dal pool (es. connessione persa)
      const errorHandler = lastPoolInstance.on.mock.calls.find(([event]) => event === 'error')[1];
      errorHandler(new Error('connessione persa'));

      // Dopo l'invalidazione, la chiamata successiva crea un nuovo Pool
      await dbClient.getPool();
      expect(Pool).toHaveBeenCalledTimes(2);
    });

    test('usa la porta di default 5432 quando le credenziali non specificano una porta', async () => {
      smSend.mockResolvedValue({
        SecretString: JSON.stringify({
          dbname: 'wiadvisor',
          username: 'wiadvisor_app',
          password: 'secret-pw',
        }),
      });

      await dbClient.getPool();

      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ port: 5432 }));
    });
  });

  // ── Modalità locale (bypassa SSM/Secrets Manager) ─────────────────────────

  describe('modalità locale (DB_LOCAL_MODE=true)', () => {
    beforeEach(() => {
      process.env.DB_LOCAL_MODE = 'true';
    });

    test('usa le credenziali/env locali di default e non interroga SSM/Secrets Manager', async () => {
      const pool = await dbClient.getPool();

      expect(pool).toBe(lastPoolInstance);
      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '127.0.0.1',
          port: 5433,
          database: 'wiadvisor',
          user: 'wiadvisor_app',
          password: 'mennea',
          ssl: false,
        }),
      );
      expect(ssmSend).not.toHaveBeenCalled();
      expect(smSend).not.toHaveBeenCalled();
    });

    test('rispetta gli override via env (DB_HOST/DB_NAME/DB_USER/DB_PASSWORD/DB_PORT/DB_SSL)', async () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'custom_db';
      process.env.DB_USER = 'custom_user';
      process.env.DB_PASSWORD = 'custom_pw';
      process.env.DB_PORT = '5555';
      process.env.DB_SSL = 'true';

      await dbClient.getPool();

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 5555,
          database: 'custom_db',
          user: 'custom_user',
          password: 'custom_pw',
          ssl: true,
        }),
      );
    });

    test('DB_LOCAL_MODE case-insensitive ("TRUE") abilita comunque la modalità locale', async () => {
      process.env.DB_LOCAL_MODE = 'TRUE';

      await dbClient.getPool();

      expect(ssmSend).not.toHaveBeenCalled();
      expect(smSend).not.toHaveBeenCalled();
    });

    test('DB_LOCAL_MODE con valore non "true" (es. "0") NON abilita la modalità locale', async () => {
      process.env.DB_LOCAL_MODE = '0';
      process.env.DB_SECRET_ARN_PARAM = 'dummy-secret-arn-param';
      process.env.RDS_PROXY_ENDPOINT_PARAM = 'dummy-rds-proxy-endpoint-param';
      setupSsmDefaults();
      setupSecretsManagerDefaults();

      await dbClient.getPool();

      expect(ssmSend).toHaveBeenCalled();
      expect(smSend).toHaveBeenCalled();
    });
  });
});
