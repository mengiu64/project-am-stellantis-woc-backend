'use strict';

/**
 * Test unitari per il modulo config.js
 * Verifica: caricamento .env, validazione variabili obbligatorie, valori di default, struttura export.
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 6.1, 6.2, 6.3
 */

const path = require('path');
const fs = require('fs');

// Variabili d'ambiente obbligatorie usate nei test
const REQUIRED_ENV = {
  SRP_V360_OTA_PING_CLIENT_ID: 'test-ping-client-id',
  SRP_V360_OTA_PING_CLIENT_SECRET: 'test-ping-client-secret',
  SRP_V360_OTA_IBM_CLIENT_ID: 'test-ibm-client-id',
  SRP_V360_OTA_IBM_CLIENT_SECRET: 'test-ibm-client-secret',
};

// Valori di default per le variabili opzionali
const DEFAULTS = {
  PING_URL: 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
  PING_SCOPE: 'prd:asv',
  BASE_URL: 'https://emea-aws.dev.np-api.stellantis.com',
  BASE_PATH: '/ps-dev/extra/srp/asv360/v1',
};

describe('config.js', () => {
  // Salva lo stato originale di process.env
  const originalEnv = process.env;

  beforeEach(() => {
    // Resetta i moduli per forzare il re-load di config.js ad ogni test
    jest.resetModules();
    // Crea un process.env pulito (senza variabili dell'ambiente host)
    process.env = { ...originalEnv };
    // Rimuove le variabili SRP_V360_OTA_* che potrebbero esistere nell'ambiente
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('SRP_V360_OTA_')) {
        delete process.env[key];
      }
    });
  });

  afterAll(() => {
    // Ripristina process.env originale
    process.env = originalEnv;
  });

  describe('caricamento con tutte le variabili obbligatorie presenti', () => {
    it('esporta un oggetto config con le sezioni auth, srp e otaDefaults', () => {
      // Imposta tutte le variabili obbligatorie
      Object.assign(process.env, REQUIRED_ENV);

      const config = require('../config');

      expect(config).toHaveProperty('auth');
      expect(config).toHaveProperty('srp');
      expect(config).toHaveProperty('otaDefaults');
    });

    it('la sezione auth contiene url, grantType, scope, clientId, clientSecret', () => {
      Object.assign(process.env, REQUIRED_ENV);

      const config = require('../config');

      expect(config.auth).toEqual({
        url: DEFAULTS.PING_URL,
        grantType: 'client_credentials',
        scope: DEFAULTS.PING_SCOPE,
        clientId: REQUIRED_ENV.SRP_V360_OTA_PING_CLIENT_ID,
        clientSecret: REQUIRED_ENV.SRP_V360_OTA_PING_CLIENT_SECRET,
      });
    });

    it('la sezione srp contiene baseUrl, basePath, clientId, clientSecret', () => {
      Object.assign(process.env, REQUIRED_ENV);

      const config = require('../config');

      expect(config.srp).toEqual({
        baseUrl: DEFAULTS.BASE_URL,
        basePath: DEFAULTS.BASE_PATH,
        clientId: REQUIRED_ENV.SRP_V360_OTA_IBM_CLIENT_ID,
        clientSecret: REQUIRED_ENV.SRP_V360_OTA_IBM_CLIENT_SECRET,
      });
    });

    it('la sezione otaDefaults contiene includeOtaHistoryData e locale', () => {
      Object.assign(process.env, REQUIRED_ENV);

      const config = require('../config');

      expect(config.otaDefaults).toEqual({
        includeOtaHistoryData: 'false',
        locale: 'en_US',
      });
    });
  });

  describe('valori di default per variabili opzionali', () => {
    beforeEach(() => {
      Object.assign(process.env, REQUIRED_ENV);
    });

    it('SRP_V360_OTA_PING_URL ha default corretto quando non impostata', () => {
      const config = require('../config');
      expect(config.auth.url).toBe(DEFAULTS.PING_URL);
    });

    it('SRP_V360_OTA_PING_SCOPE ha default corretto quando non impostata', () => {
      const config = require('../config');
      expect(config.auth.scope).toBe(DEFAULTS.PING_SCOPE);
    });

    it('SRP_V360_OTA_BASE_URL ha default corretto quando non impostata', () => {
      const config = require('../config');
      expect(config.srp.baseUrl).toBe(DEFAULTS.BASE_URL);
    });

    it('SRP_V360_OTA_BASE_PATH ha default corretto quando non impostata', () => {
      const config = require('../config');
      expect(config.srp.basePath).toBe(DEFAULTS.BASE_PATH);
    });

    it('usa il valore custom di SRP_V360_OTA_PING_URL quando impostata', () => {
      process.env.SRP_V360_OTA_PING_URL = 'https://custom-ping.example.com/token';
      const config = require('../config');
      expect(config.auth.url).toBe('https://custom-ping.example.com/token');
    });

    it('usa il valore custom di SRP_V360_OTA_PING_SCOPE quando impostata', () => {
      process.env.SRP_V360_OTA_PING_SCOPE = 'custom:scope';
      const config = require('../config');
      expect(config.auth.scope).toBe('custom:scope');
    });

    it('usa il valore custom di SRP_V360_OTA_BASE_URL quando impostata', () => {
      process.env.SRP_V360_OTA_BASE_URL = 'https://custom-api.example.com';
      const config = require('../config');
      expect(config.srp.baseUrl).toBe('https://custom-api.example.com');
    });

    it('usa il valore custom di SRP_V360_OTA_BASE_PATH quando impostata', () => {
      process.env.SRP_V360_OTA_BASE_PATH = '/custom/path/v2';
      const config = require('../config');
      expect(config.srp.basePath).toBe('/custom/path/v2');
    });
  });

  describe('errore quando variabili obbligatorie mancanti', () => {
    it('lancia errore quando manca una singola variabile obbligatoria', () => {
      // Imposta tutte tranne SRP_V360_OTA_PING_CLIENT_ID
      process.env.SRP_V360_OTA_PING_CLIENT_SECRET = 'secret';
      process.env.SRP_V360_OTA_IBM_CLIENT_ID = 'id';
      process.env.SRP_V360_OTA_IBM_CLIENT_SECRET = 'secret';

      expect(() => require('../config')).toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti: SRP_V360_OTA_PING_CLIENT_ID'
      );
    });

    it('lancia errore quando mancano più variabili obbligatorie', () => {
      // Imposta solo una delle 4 variabili obbligatorie
      process.env.SRP_V360_OTA_PING_CLIENT_ID = 'id';

      expect(() => require('../config')).toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti: SRP_V360_OTA_PING_CLIENT_SECRET, SRP_V360_OTA_IBM_CLIENT_ID, SRP_V360_OTA_IBM_CLIENT_SECRET'
      );
    });

    it('lancia errore quando nessuna variabile obbligatoria è presente', () => {
      expect(() => require('../config')).toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti: SRP_V360_OTA_PING_CLIENT_ID, SRP_V360_OTA_PING_CLIENT_SECRET, SRP_V360_OTA_IBM_CLIENT_ID, SRP_V360_OTA_IBM_CLIENT_SECRET'
      );
    });

    it('il messaggio di errore elenca solo le variabili effettivamente mancanti', () => {
      // Imposta solo IBM_CLIENT_ID e IBM_CLIENT_SECRET
      process.env.SRP_V360_OTA_IBM_CLIENT_ID = 'id';
      process.env.SRP_V360_OTA_IBM_CLIENT_SECRET = 'secret';

      expect(() => require('../config')).toThrow(
        '[config] Variabili d\'ambiente obbligatorie mancanti: SRP_V360_OTA_PING_CLIENT_ID, SRP_V360_OTA_PING_CLIENT_SECRET'
      );
    });
  });

  describe('caricamento file .env per sviluppo locale', () => {
    it('carica variabili dal file .env se presente', () => {
      // Mock fs.existsSync e fs.readFileSync per simulare un file .env
      jest.mock('fs');
      const fsMock = require('fs');

      const envContent = [
        'SRP_V360_OTA_PING_CLIENT_ID=from-env-file',
        'SRP_V360_OTA_PING_CLIENT_SECRET=secret-from-env',
        'SRP_V360_OTA_IBM_CLIENT_ID=ibm-from-env',
        'SRP_V360_OTA_IBM_CLIENT_SECRET=ibm-secret-from-env',
      ].join('\n');

      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(envContent);

      const config = require('../config');

      expect(config.auth.clientId).toBe('from-env-file');
      expect(config.auth.clientSecret).toBe('secret-from-env');
      expect(config.srp.clientId).toBe('ibm-from-env');
      expect(config.srp.clientSecret).toBe('ibm-secret-from-env');
    });

    it('non sovrascrive variabili già presenti in process.env', () => {
      jest.mock('fs');
      const fsMock = require('fs');

      // La variabile è già presente in process.env
      process.env.SRP_V360_OTA_PING_CLIENT_ID = 'from-process-env';

      const envContent = [
        'SRP_V360_OTA_PING_CLIENT_ID=from-env-file',
        'SRP_V360_OTA_PING_CLIENT_SECRET=secret-from-env',
        'SRP_V360_OTA_IBM_CLIENT_ID=ibm-from-env',
        'SRP_V360_OTA_IBM_CLIENT_SECRET=ibm-secret-from-env',
      ].join('\n');

      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(envContent);

      const config = require('../config');

      // La variabile da process.env ha precedenza
      expect(config.auth.clientId).toBe('from-process-env');
    });

    it('ignora righe vuote e commenti nel file .env', () => {
      jest.mock('fs');
      const fsMock = require('fs');

      const envContent = [
        '# Commento',
        '',
        'SRP_V360_OTA_PING_CLIENT_ID=id-value',
        '  # Altro commento con spazi',
        '  ',
        'SRP_V360_OTA_PING_CLIENT_SECRET=secret-value',
        'SRP_V360_OTA_IBM_CLIENT_ID=ibm-id',
        'SRP_V360_OTA_IBM_CLIENT_SECRET=ibm-secret',
      ].join('\n');

      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(envContent);

      const config = require('../config');

      expect(config.auth.clientId).toBe('id-value');
      expect(config.auth.clientSecret).toBe('secret-value');
    });

    it('non tenta di caricare .env se il file non esiste', () => {
      jest.mock('fs');
      const fsMock = require('fs');

      fsMock.existsSync.mockReturnValue(false);

      // Imposta le variabili obbligatorie in process.env
      Object.assign(process.env, REQUIRED_ENV);

      const config = require('../config');

      // Il modulo si carica correttamente senza .env
      expect(config.auth.clientId).toBe(REQUIRED_ENV.SRP_V360_OTA_PING_CLIENT_ID);
      expect(fsMock.readFileSync).not.toHaveBeenCalled();
    });

    it('gestisce righe senza separatore = nel file .env', () => {
      jest.mock('fs');
      const fsMock = require('fs');

      const envContent = [
        'SRP_V360_OTA_PING_CLIENT_ID=id-value',
        'INVALID_LINE_WITHOUT_EQUALS',
        'SRP_V360_OTA_PING_CLIENT_SECRET=secret-value',
        'SRP_V360_OTA_IBM_CLIENT_ID=ibm-id',
        'SRP_V360_OTA_IBM_CLIENT_SECRET=ibm-secret',
      ].join('\n');

      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(envContent);

      // Non deve lanciare errori per righe malformate
      const config = require('../config');
      expect(config.auth.clientId).toBe('id-value');
    });
  });
});
