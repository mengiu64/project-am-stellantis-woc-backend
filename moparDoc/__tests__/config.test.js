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

// Fixture condivisa a sei chiavi (Req 5.1) — usata come sorgente delle variabili d'ambiente locali
const { VALID_SECRET } = require('./fixtures/validSecret');

// Variabili d'ambiente obbligatorie usate nei test (modalità locale) — sei chiavi dalla fixture condivisa
const REQUIRED_ENV = { ...VALID_SECRET };

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
        apiAccessCode: REQUIRED_ENV.MOPARDOC_API_ACCESS_CODE, // Nuovo: codice API mappato dal secret
        tamAccessCode: REQUIRED_ENV.MOPARDOC_TAM_ACCESS_CODE, // Nuovo: codice TAM mappato dal secret
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
      // Imposta tutte le variabili tranne MOPARDOC_IBM_CLIENT_ID per isolare la chiave mancante
      Object.assign(process.env, REQUIRED_ENV);
      delete process.env.MOPARDOC_IBM_CLIENT_ID;
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

      // Il secret restituito da loadSecrets è la fixture condivisa a sei chiavi (Req 5.1)
      jest.mock('../secretsLoader', () => ({
        loadSecrets: jest.fn().mockResolvedValue({ ...require('./fixtures/validSecret').VALID_SECRET }),
      }));

      const { getConfig } = require('../config');
      const config = await getConfig();

      expect(config.auth.clientId).toBe(VALID_SECRET.MOPARDOC_PING_CLIENT_ID);
      expect(config.auth.clientSecret).toBe(VALID_SECRET.MOPARDOC_PING_CLIENT_SECRET);
      expect(config.jobDocs.ibmClientId).toBe(VALID_SECRET.MOPARDOC_IBM_CLIENT_ID);
      expect(config.jobDocs.ibmClientSecret).toBe(VALID_SECRET.MOPARDOC_IBM_CLIENT_SECRET);
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

  // Generatore semplice inline (fast-check non è tra le dipendenze):
  // produce una stringa pseudo-casuale non vuota adatta a fungere da codice di accesso
  function randomCode(seed) {
    // Mescola il seme per ottenere valori variabili tra iterazioni
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    // Lunghezza variabile ma sempre >= 1 per evitare valori falsy
    const len = 1 + Math.floor(Math.random() * 24);
    let out = '';
    for (let i = 0; i < len; i++) {
      // Combina Math.random con il seme per maggiore varietà
      const idx = Math.floor((Math.random() * (seed + 1) * 7 + i) % chars.length);
      out += chars[idx];
    }
    return out;
  }

  // Property 3: buildConfig mappa entrambi i codici nella sezione jobDocs
  // Tag: Feature: mopardoc-access-codes-to-secret, Property 3
  // Validates: Requirements 1.2, 1.3
  describe('Property 3: buildConfig mappa entrambi i codici nella sezione jobDocs', () => {
    it('per valori random dei due codici, jobDocs.apiAccessCode/tamAccessCode coincidono con il secret (>=100 iterazioni)', async () => {
      // Esegue almeno 100 iterazioni con coppie di codici generate casualmente
      for (let i = 0; i < 120; i++) {
        // Genera due codici distinti e casuali per questa iterazione
        const apiCode = randomCode(i);
        const tamCode = randomCode(i + 1000);

        // Resetta i moduli e la cache di config per isolare ogni iterazione
        jest.resetModules();
        process.env = { ...originalEnv };
        // Rimuove eventuali variabili MOPARDOC_* residue per partire da uno stato pulito
        Object.keys(process.env).forEach((key) => {
          if (key.startsWith('MOPARDOC_') || key.startsWith('MOPARDOCS_')) delete process.env[key];
        });

        // Imposta le sei variabili obbligatorie (percorso locale, senza MOPARDOC_PARAM_NAME)
        Object.assign(process.env, VALID_SECRET);
        // Sovrascrive i due codici con i valori random dell'iterazione
        process.env.MOPARDOC_API_ACCESS_CODE = apiCode;
        process.env.MOPARDOC_TAM_ACCESS_CODE = tamCode;

        // Carica la config appena costruita (buildConfig è esercitato internamente)
        const { getConfig } = require('../config');
        const config = await getConfig();

        // La mappatura deve riflettere esattamente i valori del secret/env
        expect(config.jobDocs.apiAccessCode).toBe(apiCode);
        expect(config.jobDocs.tamAccessCode).toBe(tamCode);
      }
    });
  });

  // Property 2: La validazione locale fallisce su variabile d'ambiente mancante
  // Tag: Feature: mopardoc-access-codes-to-secret, Property 2
  // Validates: Requirements 1.4, 2.3
  describe('Property 2: la validazione locale fallisce su variabile d\'ambiente mancante', () => {
    // Elenco delle sei variabili obbligatorie nel percorso locale
    const REQUIRED_KEYS = Object.keys(VALID_SECRET);

    it('rimuovendo un sottoinsieme non vuoto di variabili obbligatorie, getConfig() fallisce elencandole e non costruisce la config (>=100 iterazioni)', async () => {
      // Esegue almeno 100 iterazioni scegliendo casualmente quali variabili rimuovere
      for (let i = 0; i < 120; i++) {
        // Determina casualmente quali chiavi rimuovere, garantendo almeno una rimozione
        let toRemove = REQUIRED_KEYS.filter(() => Math.random() < 0.5);
        if (toRemove.length === 0) {
          // Forza la rimozione di almeno una variabile (ciclo sulle chiavi per varietà)
          toRemove = [REQUIRED_KEYS[i % REQUIRED_KEYS.length]];
        }

        // Resetta i moduli e ripristina l'ambiente per isolare l'iterazione
        jest.resetModules();
        process.env = { ...originalEnv };
        // Assicura il percorso locale rimuovendo MOPARDOC_PARAM_NAME e residui MOPARDOC_*
        Object.keys(process.env).forEach((key) => {
          if (key.startsWith('MOPARDOC_') || key.startsWith('MOPARDOCS_')) delete process.env[key];
        });

        // Imposta tutte le sei variabili obbligatorie...
        Object.assign(process.env, VALID_SECRET);
        // ...poi rimuove il sottoinsieme scelto per questa iterazione
        toRemove.forEach((key) => delete process.env[key]);

        // Spia buildConfig indirettamente: la config non deve essere costruita in caso di errore
        const { getConfig } = require('../config');

        // getConfig() deve fallire con un errore che elenca esattamente le variabili mancanti
        let thrown;
        try {
          await getConfig();
        } catch (err) {
          thrown = err;
        }

        // Deve essere stato lanciato un errore (la config NON è stata costruita)
        expect(thrown).toBeInstanceOf(Error);
        // Il messaggio elenca il prefisso atteso e ciascuna variabile rimossa
        expect(thrown.message).toContain('[config] Variabili d\'ambiente obbligatorie mancanti:');
        toRemove.forEach((key) => {
          expect(thrown.message).toContain(key);
        });
      }
    });
  });
});
