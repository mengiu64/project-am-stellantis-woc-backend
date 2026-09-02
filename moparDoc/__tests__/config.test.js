'use strict';

/**
 * Test unitari per il modulo config.js (moparDoc).
 * Verifica: caricamento credenziali da variabili d'ambiente (locale),
 * caricamento da SSM/Secrets Manager (mock), validazione, cache.
 */

// Valori non-secret attesi nella config (copiati dai literal di config.js)
const AUTH_DEFAULTS = {
  baseUrl: 'https://idfed-preprod.mpsa.com:443',
  basePath: '/as/token.oauth2',
  url: 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
  grantType: 'client_credentials',
  scope: 'prd:mdo',
  cacheBufferMs: 30000,
};

// Variabili d'ambiente obbligatorie usate nei test (modalità locale)
const REQUIRED_ENV = {
  MOPARDOC_IBM_CLIENT_ID: 'test-ibm-id',
  MOPARDOC_IBM_CLIENT_SECRET: 'test-ibm-secret',
  MOPARDOC_PING_CLIENT_ID: 'test-ping-id',
  MOPARDOC_PING_CLIENT_SECRET: 'test-ping-secret',
};

describe('config.js – getConfig (moparDoc)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Pulisce le variabili MOPARDOC_* e gli override services per partire puliti
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('MOPARDOC_') || key.startsWith('MOPARDOCS_')) delete process.env[key];
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('modalità locale (senza MOPARDOC_PARAM_NAME)', () => {
    it('restituisce un oggetto config con le sezioni auth, jobDocs, moparDocsApi, moparDocsServices', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config).toHaveProperty('auth');
      expect(config).toHaveProperty('jobDocs');
      expect(config).toHaveProperty('moparDocsApi');
      expect(config).toHaveProperty('moparDocsServices');
    });

    it('la sezione auth contiene i valori attesi e le credenziali Ping dal secret', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.auth).toEqual({
        baseUrl: AUTH_DEFAULTS.baseUrl,
        basePath: AUTH_DEFAULTS.basePath,
        url: AUTH_DEFAULTS.url,
        grantType: AUTH_DEFAULTS.grantType,
        clientId: REQUIRED_ENV.MOPARDOC_PING_CLIENT_ID,
        clientSecret: REQUIRED_ENV.MOPARDOC_PING_CLIENT_SECRET,
        scope: AUTH_DEFAULTS.scope,
        cacheBufferMs: AUTH_DEFAULTS.cacheBufferMs,
      });
    });

    it('jobDocs contiene baseUrl/basePath e le credenziali IBM dal secret', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.jobDocs).toEqual({
        baseUrl: 'https://api-oidc-preprod.groupe-psa.com',
        basePath: '/job-docs/connector/v1',
        ibmClientId: REQUIRED_ENV.MOPARDOC_IBM_CLIENT_ID,
        ibmClientSecret: REQUIRED_ENV.MOPARDOC_IBM_CLIENT_SECRET,
      });
    });

    it('moparDocsApi contiene baseUrl/basePath e le credenziali IBM dal secret', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.moparDocsApi).toEqual({
        baseUrl: 'https://lab-examaftersales.fiat.com',
        basePath: '/Mopardocs/MoparDocsApi/Browser',
        ibmClientId: REQUIRED_ENV.MOPARDOC_IBM_CLIENT_ID,
        ibmClientSecret: REQUIRED_ENV.MOPARDOC_IBM_CLIENT_SECRET,
      });
    });

    it('moparDocsServices usa i default quando non ci sono override', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.moparDocsServices).toEqual({
        baseUrl: 'https://api-oidc-preprod.groupe-psa.com',
        basePath: '/job-docs/connector/v1',
        ibmClientId: REQUIRED_ENV.MOPARDOC_IBM_CLIENT_ID,
        ibmClientSecret: REQUIRED_ENV.MOPARDOC_IBM_CLIENT_SECRET,
      });
    });

    it('moparDocsServices rispetta gli override MOPARDOCS_SERVICES_BASE_URL/PATH', async () => {
      Object.assign(process.env, REQUIRED_ENV);
      process.env.MOPARDOCS_SERVICES_BASE_URL = 'https://custom.example.com';
      process.env.MOPARDOCS_SERVICES_PATH = '/custom/path';
      const { getConfig } = require('../config');
      const config = await getConfig();
      expect(config.moparDocsServices.baseUrl).toBe('https://custom.example.com');
      expect(config.moparDocsServices.basePath).toBe('/custom/path');
    });

    it('lancia errore quando manca una singola variabile obbligatoria', async () => {
      process.env.MOPARDOC_IBM_CLIENT_SECRET = 's';
      process.env.MOPARDOC_PING_CLIENT_ID = 'p';
      process.env.MOPARDOC_PING_CLIENT_SECRET = 'ps';
      const { getConfig } = require('../config');
      await expect(getConfig()).rejects.toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti: MOPARDOC_IBM_CLIENT_ID'
      );
    });

    it('lancia errore quando nessuna variabile obbligatoria è presente', async () => {
      const { getConfig } = require('../config');
      await expect(getConfig()).rejects.toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti:'
      );
    });
  });

  describe('modalità SSM/Secrets Manager (con MOPARDOC_PARAM_NAME)', () => {
    it('carica le credenziali tramite loadSecrets quando MOPARDOC_PARAM_NAME è presente', async () => {
      process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';

      jest.mock('../secretsLoader', () => ({
        loadSecrets: jest.fn().mockResolvedValue({
          MOPARDOC_IBM_CLIENT_ID: 'ssm-ibm-id',
          MOPARDOC_IBM_CLIENT_SECRET: 'ssm-ibm-secret',
          MOPARDOC_PING_CLIENT_ID: 'ssm-ping-id',
          MOPARDOC_PING_CLIENT_SECRET: 'ssm-ping-secret',
        }),
      }));

      const { getConfig } = require('../config');
      const config = await getConfig();

      expect(config.auth.clientId).toBe('ssm-ping-id');
      expect(config.auth.clientSecret).toBe('ssm-ping-secret');
      expect(config.jobDocs.ibmClientId).toBe('ssm-ibm-id');
      expect(config.jobDocs.ibmClientSecret).toBe('ssm-ibm-secret');
    });

    it('propaga errore se loadSecrets fallisce', async () => {
      process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';

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
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});
