'use strict';

// Load .env file for local development (no external dependencies)
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    });
}

// Cache della configurazione — persiste tra invocazioni nello stesso container Lambda (warm start)
let cachedConfig = null;

/**
 * Costruisce l'oggetto di configurazione a partire dai valori risolti (URL/path
 * + credenziali) da Secrets Manager se SERVICE_URLS_SECRET_ID è configurata,
 * altrimenti da variabile d'ambiente/hardcoded default (locale/CLI).
 * @param {object} secrets - { V360_PING_URL, ASV_BASE_URL, ASV_BASE_PATH, V360_PING_CLIENT_ID, V360_PING_CLIENT_SECRET, ASV_CLIENT_ID, ASV_CLIENT_SECRET, ASV_GETDETAILS_CLIENT_ID }
 */
function buildConfig(secrets) {
  return {
    // PingFederate token endpoint
    auth: {
      url: secrets.V360_PING_URL,
      grantType: 'client_credentials',
      scope: 'prd:asv',
      clientId: secrets.V360_PING_CLIENT_ID,
      clientSecret: secrets.V360_PING_CLIENT_SECRET,
    },

    // Stellantis ASV360 API
    asv: {
      baseUrl: secrets.ASV_BASE_URL,
      basePath: secrets.ASV_BASE_PATH,
      clientId: secrets.ASV_CLIENT_ID,
      clientSecret: secrets.ASV_CLIENT_SECRET,
    },

    // Default values used by getdetails when not provided in the input (vin is always mandatory and never defaulted).
    // clientId is environment-specific (dev/stage/prod), hence sourced from the shared secret/env var.
    getDetailsDefaults: {
      countryCode: 'FR',
      languageCode: 'fr',
      clientId: secrets.ASV_GETDETAILS_CLIENT_ID,
      offering: 'Vehicle Description, campaign, warranty',
    },

    // Default values used by otaCompatibility when not provided in the input (vin is always mandatory and never defaulted).
    otaCompatibilityDefaults: {
      includeOtaHistoryData: 'true',
      locale: 'en_EN',
    },
  };
}

/**
 * Restituisce l'oggetto di configurazione completo (con cache in memoria).
 * Le URL/path e le credenziali (PingFederate + ASV360) sono lette da AWS Secrets Manager
 * (secret unico "service urls", v. secretsLoader.js e template.yaml risorsa
 * ServiceUrlsSecret) quando SERVICE_URLS_SECRET_ID è configurata (Lambda);
 * altrimenti (locale/CLI, o singola chiave assente dal secret) da variabile
 * d'ambiente con fallback al valore usato storicamente — nessun cambio di
 * comportamento se non esplicitamente sovrascritte.
 * @returns {Promise<object>}
 */
async function getConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  let secretUrls = {};
  if (process.env.SERVICE_URLS_SECRET_ID) {
    try {
      const { loadServiceUrls } = require('./secretsLoader');
      secretUrls = await loadServiceUrls();
    } catch (err) {
      // Fallback su env var/default hardcoded se il secret non e' (ancora)
      // configurato/raggiungibile (es. non ancora creato in un nuovo
      // ambiente): nessun impatto sul comportamento storico.
      console.warn(`[config] Impossibile leggere ServiceUrlsSecret, uso env var/default: ${err.message}`);
    }
  }

  const secrets = {
    V360_PING_URL: secretUrls.V360_PING_URL || process.env.V360_PING_URL || 'https://idfed.mpsa.com:443/as/token.oauth2',
    ASV_BASE_URL: secretUrls.ASV_BASE_URL || process.env.ASV_BASE_URL || 'https://emea-aws.api.stellantis.com',
    ASV_BASE_PATH: secretUrls.ASV_BASE_PATH || process.env.ASV_BASE_PATH || '/ps-prod/extra/asv360/vehicle/v1',
    // Credenziali PingFederate/ASV360: non più passate come variabile d'ambiente/
    // parametro CFN in chiaro sulla Lambda, ma lette dallo stesso secret
    // condiviso ("service urls") — v. template.yaml/ServiceUrlsSecretId.
    V360_PING_CLIENT_ID: secretUrls.V360_PING_CLIENT_ID || process.env.V360_PING_CLIENT_ID,
    V360_PING_CLIENT_SECRET: secretUrls.V360_PING_CLIENT_SECRET || process.env.V360_PING_CLIENT_SECRET,
    ASV_CLIENT_ID: secretUrls.ASV_CLIENT_ID || process.env.ASV_CLIENT_ID,
    ASV_CLIENT_SECRET: secretUrls.ASV_CLIENT_SECRET || process.env.ASV_CLIENT_SECRET,
    ASV_GETDETAILS_CLIENT_ID: secretUrls.ASV_GETDETAILS_CLIENT_ID || process.env.ASV_GETDETAILS_CLIENT_ID,
  };

  const missingCreds = ['V360_PING_CLIENT_ID', 'V360_PING_CLIENT_SECRET', 'ASV_CLIENT_ID', 'ASV_CLIENT_SECRET', 'ASV_GETDETAILS_CLIENT_ID']
    .filter((k) => !secrets[k]);
  if (missingCreds.length > 0) {
    console.warn(`[config] Credenziali mancanti (ne' nel secret ne' in env): ${missingCreds.join(', ')}`);
  }

  cachedConfig = buildConfig(secrets);
  return cachedConfig;
}

/**
 * Invalida la cache della configurazione. Utile per i test unitari e per forzare un refresh.
 */
function invalidateConfig() {
  cachedConfig = null;
}

module.exports = { getConfig, invalidateConfig };
