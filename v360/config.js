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

// Validate required environment variables
const REQUIRED_ENV = [
  'V360_PING_CLIENT_ID',
  'V360_PING_CLIENT_SECRET',
  'ASV_CLIENT_ID',
  'ASV_CLIENT_SECRET',
  'ASV_GETDETAILS_CLIENT_ID',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`[config] Missing required environment variables: ${missing.join(', ')}`);
}

// Cache della configurazione — persiste tra invocazioni nello stesso container Lambda (warm start)
let cachedConfig = null;

/**
 * Costruisce l'oggetto di configurazione a partire dalle URL/path risolte
 * (da Secrets Manager se SERVICE_URLS_SECRET_ID è configurata, altrimenti da
 * variabile d'ambiente/hardcoded default).
 * @param {object} urls - { V360_PING_URL, ASV_BASE_URL, ASV_BASE_PATH }
 */
function buildConfig(urls) {
  return {
    // PingFederate token endpoint
    auth: {
      url: urls.V360_PING_URL,
      grantType: 'client_credentials',
      scope: 'prd:asv',
      clientId: process.env.V360_PING_CLIENT_ID,
      clientSecret: process.env.V360_PING_CLIENT_SECRET,
    },

    // Stellantis ASV360 API
    asv: {
      baseUrl: urls.ASV_BASE_URL,
      basePath: urls.ASV_BASE_PATH,
      clientId: process.env.ASV_CLIENT_ID,
      clientSecret: process.env.ASV_CLIENT_SECRET,
    },

    // Default values used by getdetails when not provided in the input (vin is always mandatory and never defaulted).
    // clientId is environment-specific (dev/stage/prod), hence sourced from env var.
    getDetailsDefaults: {
      countryCode: 'FR',
      languageCode: 'fr',
      clientId: process.env.ASV_GETDETAILS_CLIENT_ID,
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
 * Le URL/path (PingFederate + ASV360) sono lette da AWS Secrets Manager
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
    const { loadServiceUrls } = require('./secretsLoader');
    secretUrls = await loadServiceUrls();
  }

  const urls = {
    V360_PING_URL: secretUrls.V360_PING_URL || process.env.V360_PING_URL || 'https://idfed.mpsa.com:443/as/token.oauth2',
    ASV_BASE_URL: secretUrls.ASV_BASE_URL || process.env.ASV_BASE_URL || 'https://emea-aws.api.stellantis.com',
    ASV_BASE_PATH: secretUrls.ASV_BASE_PATH || process.env.ASV_BASE_PATH || '/ps-prod/extra/asv360/vehicle/v1',
  };

  cachedConfig = buildConfig(urls);
  return cachedConfig;
}

/**
 * Invalida la cache della configurazione. Utile per i test unitari e per forzare un refresh.
 */
function invalidateConfig() {
  cachedConfig = null;
}

module.exports = { getConfig, invalidateConfig };
