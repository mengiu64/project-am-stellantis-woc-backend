'use strict';

// Modulo di configurazione per la Lambda srpV360Ota.
// In ambiente AWS Lambda: carica le credenziali da SSM Parameter Store → Secrets Manager.
// In locale (CLI): carica le credenziali dal file .env.
// Esporta una funzione asincrona getConfig() che restituisce l'oggetto di configurazione.
// Il risultato viene cachato in memoria per le invocazioni successive (warm start).

const fs = require('fs');
const path = require('path');

// Cache della configurazione — persiste tra invocazioni (warm start)
let cachedConfig = null;

/**
 * Carica il file .env locale per lo sviluppo (no dipendenze npm esterne).
 * Le variabili nel file .env non sovrascrivono quelle già presenti in process.env.
 */
function loadEnvFile() {
  // Percorso del file .env nella directory corrente
  const envFile = path.join(__dirname, '.env');
  // Carica solo se il file esiste (sviluppo locale)
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8')
      .split('\n')
      .forEach((line) => {
        // Rimuove spazi bianchi iniziali e finali
        const trimmed = line.trim();
        // Ignora righe vuote e commenti
        if (!trimmed || trimmed.startsWith('#')) return;
        // Cerca il separatore chiave=valore
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        // Estrae chiave e valore
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        // Imposta la variabile solo se non già presente in process.env
        if (key && !(key in process.env)) {
          process.env[key] = val;
        }
      });
  }
}

/**
 * Costruisce l'oggetto di configurazione a partire dalle credenziali caricate.
 * @param {object} secrets - Oggetto con le 4 credenziali
 * @returns {object} Oggetto di configurazione con sezioni auth, srp e otaDefaults
 */
function buildConfig(secrets) {
  return {
    // Configurazione autenticazione PingFederate
    auth: {
      // URL endpoint PingFederate (default: produzione)
      url: process.env.SRP_V360_OTA_PING_URL || 'https://idfed.mpsa.com:443/as/token.oauth2',
      // Tipo di grant OAuth2
      grantType: 'client_credentials',
      // Scope OAuth2 per il servizio ASV360
      scope: process.env.SRP_V360_OTA_PING_SCOPE || 'prd:asv',
      // Client ID PingFederate (dal secret)
      clientId: secrets.SRP_V360_OTA_PING_CLIENT_ID,
      // Client Secret PingFederate (dal secret)
      clientSecret: secrets.SRP_V360_OTA_PING_CLIENT_SECRET,
    },

    // Configurazione servizio upstream SRP-V360 (IBM API Connect)
    srp: {
      // URL base del servizio upstream (differente per dev/stage/prod)
      baseUrl: process.env.SRP_V360_OTA_BASE_URL || 'https://emea-aws.api.stellantis.com',
      // Base path dell'API upstream
      basePath: process.env.SRP_V360_OTA_BASE_PATH || '/ps-prod/extra/asv360/vehicle/v1',
      // X-IBM-Client-Id per autenticazione IBM API Connect (dal secret)
      clientId: secrets.SRP_V360_OTA_IBM_CLIENT_ID,
      // X-IBM-Client-Secret per autenticazione IBM API Connect (dal secret)
      clientSecret: secrets.SRP_V360_OTA_IBM_CLIENT_SECRET,
    },

    // Valori di default per i parametri della richiesta OTA
    otaDefaults: {
      // Inclusione storico dati OTA (default: 'true')
      includeOtaHistoryData: 'true',
      // Locale per la risposta (default: 'en_US')
      locale: 'en_US',
    },
  };
}

/**
 * Restituisce l'oggetto di configurazione completo.
 * In ambiente Lambda: carica le credenziali da SSM → Secrets Manager (con cache).
 * In locale: carica le credenziali dalle variabili d'ambiente (file .env).
 * @returns {Promise<object>} Oggetto config con sezioni auth, srp, otaDefaults
 * @throws {Error} Se le credenziali non sono recuperabili
 */
async function getConfig() {
  // Se la configurazione è già in cache, restituisce direttamente
  if (cachedConfig) {
    return cachedConfig;
  }

  // Carica il file .env locale (ha effetto solo in sviluppo locale)
  loadEnvFile();

  let secrets;

  // Determina la sorgente delle credenziali in base alla variabile d'ambiente
  if (process.env.SRP_V360_OTA_SECRET_ARN_PARAM) {
    // Ambiente Lambda: carica da SSM → Secrets Manager
    const { loadSecrets } = require('./secretsLoader');
    console.log('[config] Caricamento credenziali da SSM/Secrets Manager');
    secrets = await loadSecrets();
  } else {
    // Ambiente locale: usa le variabili d'ambiente (da .env o process.env)
    console.log('[config] Caricamento credenziali da variabili d\'ambiente locali');
    // Elenco delle variabili d'ambiente obbligatorie in locale
    const REQUIRED_ENV = [
      'SRP_V360_OTA_PING_CLIENT_ID',
      'SRP_V360_OTA_PING_CLIENT_SECRET',
      'SRP_V360_OTA_IBM_CLIENT_ID',
      'SRP_V360_OTA_IBM_CLIENT_SECRET',
    ];
    // Verifica che tutte le variabili obbligatorie siano presenti
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `[config] Variabili d'ambiente obbligatorie mancanti: ${missing.join(', ')}`
      );
    }
    // Costruisce l'oggetto secrets dalle variabili d'ambiente
    secrets = {
      SRP_V360_OTA_PING_CLIENT_ID: process.env.SRP_V360_OTA_PING_CLIENT_ID,
      SRP_V360_OTA_PING_CLIENT_SECRET: process.env.SRP_V360_OTA_PING_CLIENT_SECRET,
      SRP_V360_OTA_IBM_CLIENT_ID: process.env.SRP_V360_OTA_IBM_CLIENT_ID,
      SRP_V360_OTA_IBM_CLIENT_SECRET: process.env.SRP_V360_OTA_IBM_CLIENT_SECRET,
    };
  }

  // Costruisce l'oggetto di configurazione dalle credenziali recuperate
  cachedConfig = buildConfig(secrets);
  console.log('[config] Configurazione caricata con successo');

  // Restituisce l'oggetto di configurazione
  return cachedConfig;
}

/**
 * Invalida la cache della configurazione.
 * Utile per i test unitari e per forzare un refresh.
 */
function invalidateConfig() {
  cachedConfig = null;
}

// Esporta la funzione asincrona per ottenere la configurazione
module.exports = { getConfig, invalidateConfig };
