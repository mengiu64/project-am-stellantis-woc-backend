'use strict';

/**
 * Test unitari per il modulo config.js
 * Verifica: caricamento credenziali da variabili d'ambiente (locale),
 * caricamento da SSM/Secrets Manager (mock), validazione, struttura export.
 */

const path = require('path');

// Valori di default per le variabili opzionali
const DEFAULTS = {
  PING_URL: 'https://idfed.mpsa.com:443/as/token.oauth2',
  PING_SCOPE: 'prd:asv',
  BASE_URL: 'https://emea-aws.api.stellantis.com',
  BASE_PATH: '/ps-prod/extra/asv360/vehicle/v1',
};

// Variabili d'ambiente obbligatorie usate nei test
const REQUIRED_ENV = {
  SRP_V360_OTA_PING_CLIENT_ID: 'test-ping-client-id',
  SRP_V360_OTA_PING_CLIENT_SECRET: 'test-ping-client-secret',
  SRP_V360_OTA_IBM_CLIENT_ID: 'test-ibm-client-id',
  SRP_V360_OTA_IBM_CLIENT_SECRET: 'test-ibm-client-secret',
};

describe('config.js – getConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Rimuove le variabili SRP_V360_OTA_* per partire puliti
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('SRP_V360_OTA_')) delete process.env[key];
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('modalità locale (senza SRP_V360_OTA_SECRET_ARN_PARAM)', () => {
    it('restituisce un oggetto config con le sezioni auth, srp e otaDefaults', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config).toHaveProperty('auth');
      expect(config).toHaveProperty('srp');
      expect(config).toHaveProperty('otaDefaults');
    });

    it('la sezione auth contiene url, grantType, scope, clientId, clientSecret', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.auth).toEqual({
        url: DEFAULTS.PING_URL,
        grantType: 'client_credentials',
        scope: DEFAULTS.PING_SCOPE,
        clientId: REQUIRED_ENV.SRP_V360_OTA_PING_CLIENT_ID,
        clientSecret: REQUIRED_ENV.SRP_V360_OTA_PING_CLIENT_SECRET,
      });
    });

    it('la sezione srp contiene baseUrl, basePath, clientId, clientSecret', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.srp).toEqual({
        baseUrl: DEFAULTS.BASE_URL,
        basePath: DEFAULTS.BASE_PATH,
        clientId: REQUIRED_ENV.SRP_V360_OTA_IBM_CLIENT_ID,
        clientSecret: REQUIRED_ENV.SRP_V360_OTA_IBM_CLIENT_SECRET,
      });
    });

    it('la sezione otaDefaults contiene includeOtaHistoryData e locale', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.otaDefaults).toEqual({
        includeOtaHistoryData: 'true',
        locale: 'en_US',
      });
    });

    it('usa il valore custom di SRP_V360_OTA_PING_URL quando impostata', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      process.env.SRP_V360_OTA_PING_URL = 'https://custom-ping.example.com/token';
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.auth.url).toBe('https://custom-ping.example.com/token');
    });

    it('usa il valore custom di SRP_V360_OTA_BASE_URL quando impostata', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      process.env.SRP_V360_OTA_BASE_URL = 'https://custom-api.example.com';
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.srp.baseUrl).toBe('https://custom-api.example.com');
    });

    it('lancia errore quando manca una singola variabile obbligatoria', async () => {
      process.env.SRP_V360_OTA_PING_CLIENT_SECRET = 'secret';
      process.env.SRP_V360_OTA_IBM_CLIENT_ID = 'id';
      process.env.SRP_V360_OTA_IBM_CLIENT_SECRET = 'secret';
      const { getConfig } = require('../config');
      await expect(getConfig()).rejects.toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti: SRP_V360_OTA_PING_CLIENT_ID'
      );
    });

    it('lancia errore quando mancano più variabili obbligatorie', async () => {
      process.env.SRP_V360_OTA_PING_CLIENT_ID = 'id';
      const { getConfig } = require('../config');
      await expect(getConfig()).rejects.toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti: SRP_V360_OTA_PING_CLIENT_SECRET, SRP_V360_OTA_IBM_CLIENT_ID, SRP_V360_OTA_IBM_CLIENT_SECRET'
      );
    });

    it('lancia errore quando nessuna variabile obbligatoria è presente', async () => {
      const { getConfig } = require('../config');
      await expect(getConfig()).rejects.toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti:'
      );
    });
  });

  describe('modalità SSM/Secrets Manager (con SRP_V360_OTA_SECRET_ARN_PARAM)', () => {
    it('carica le credenziali tramite loadSecrets quando SRP_V360_OTA_SECRET_ARN_PARAM è presente', async () => {
      process.env.SRP_V360_OTA_SECRET_ARN_PARAM = '/app/np-BSN0027990-dev/SRP_V360_OTA';

      jest.mock('../secretsLoader', () => ({
        loadSecrets: jest.fn().mockResolvedValue({
          SRP_V360_OTA_PING_CLIENT_ID: 'ssm-ping-id',
          SRP_V360_OTA_PING_CLIENT_SECRET: 'ssm-ping-secret',
          SRP_V360_OTA_IBM_CLIENT_ID: 'ssm-ibm-id',
          SRP_V360_OTA_IBM_CLIENT_SECRET: 'ssm-ibm-secret',
        }),
      }));

      const { getConfig } = require('../config');
      const config = await getConfig();

      expect(config.auth.clientId).toBe('ssm-ping-id');
      expect(config.auth.clientSecret).toBe('ssm-ping-secret');
      expect(config.srp.clientId).toBe('ssm-ibm-id');
      expect(config.srp.clientSecret).toBe('ssm-ibm-secret');
    });

    it('propaga errore se loadSecrets fallisce', async () => {
      process.env.SRP_V360_OTA_SECRET_ARN_PARAM = '/app/np-BSN0027990-dev/SRP_V360_OTA';

      jest.mock('../secretsLoader', () => ({
        loadSecrets: jest.fn().mockRejectedValue(new Error('[secrets] Parametro SSM non trovato')),
      }));

      const { getConfig } = require('../config');
      await expect(getConfig()).rejects.toThrow('[secrets] Parametro SSM non trovato');
    });
  });

  describe('cache della configurazione', () => {
    it('restituisce lo stesso oggetto alla seconda chiamata (cache)', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config1 = await getConfig();
      const config2 = await getConfig();
      expect(config1).toBe(config2);
    });

    it('invalidateConfig forza il ricaricamento', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig, invalidateConfig } = require('../config');
      const config1 = await getConfig();
      invalidateConfig();
      const config2 = await getConfig();
      // Dopo invalidazione è un nuovo oggetto (ma con gli stessi valori)
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});
