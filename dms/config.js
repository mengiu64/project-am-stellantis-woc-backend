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
  'DMS_PING_CLIENT_ID',
  'DMS_PING_CLIENT_SECRET',
  'DML_IBM_CLIENT_ID',
  'DML_IBM_CLIENT_SECRET',
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
 */
function buildConfig(urls) {
  return {
    // PingFederate token endpoint
    auth: {
      url: urls.DMS_PING_URL,
      grantType: 'client_credentials',
      scope: 'prd:dmy',
      clientId: process.env.DMS_PING_CLIENT_ID,
      clientSecret: process.env.DMS_PING_CLIENT_SECRET,
    },

    // Stellantis DML API (IBM API Connect gateway)
    dml: {
      baseUrl: urls.DML_BASE_URL,
      settingsPath: urls.DML_SETTINGS_PATH,
      inquiryPath: urls.DML_INQUIRY_PATH,
      companyTypesPath: urls.DML_COMPANY_TYPES_PATH,
      customerTitlesPath: urls.DML_CUSTOMER_TITLES_PATH,
      ibmClientId: process.env.DML_IBM_CLIENT_ID,
      ibmClientSecret: process.env.DML_IBM_CLIENT_SECRET,
      xTargetEnv: process.env.DML_X_TARGET_ENV || 'stage',
    },
    // ApplicationArea.Sender defaults (optional, used in CLI inquiry command)
    sender: {
      componentId:          process.env.DML_SENDER_COMPONENT_ID     || '1.0.0',
      dealerNumberId:       process.env.DML_SENDER_DEALER_ID        || '0062230',
      dealerNumberIdSource: process.env.DML_SENDER_DEALER_ID_SRC    || '0062230',
      dealerCountryCode:    process.env.DML_SENDER_COUNTRY          || 'FR',
      languageCode:         process.env.DML_SENDER_LANGUAGE         || 'fr-FR',
      physicalSiteId:       process.env.DML_SENDER_SITE_ID          || '001',
      serviceId:            process.env.DML_SENDER_SERVICE_ID       || 'FR-0062230.D001',
      currencyId:           process.env.DML_SENDER_CURRENCY         || 'EUR',
      brand:                process.env.DML_SENDER_BRAND            || 'FT',
    },
  };
}

/**
 * Restituisce l'oggetto di configurazione completo (con cache in memoria).
 * Le URL/path (PingFederate + DML) sono lette da AWS Secrets Manager (secret
 * unico "service urls", v. secretsLoader.js e template.yaml risorsa
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
    DMS_PING_URL: secretUrls.DMS_PING_URL || process.env.DMS_PING_URL || 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    DML_BASE_URL: secretUrls.DML_BASE_URL || process.env.DML_BASE_URL || 'https://emea-aws.dev.np-api.stellantis.com',
    DML_SETTINGS_PATH: secretUrls.DML_SETTINGS_PATH || process.env.DML_SETTINGS_PATH || '/ps-dev/extra/dml/dms-settings/v1/settings',
    DML_INQUIRY_PATH: secretUrls.DML_INQUIRY_PATH || process.env.DML_INQUIRY_PATH || '/ps-dev/extra/dml/aftersales/v1/inquiry',
    DML_COMPANY_TYPES_PATH: secretUrls.DML_COMPANY_TYPES_PATH || process.env.DML_COMPANY_TYPES_PATH || '/ps-dev/extra/dml/configurations/v1/company-types',
    DML_CUSTOMER_TITLES_PATH: secretUrls.DML_CUSTOMER_TITLES_PATH || process.env.DML_CUSTOMER_TITLES_PATH || '/ps-dev/extra/dml/configurations/v1/customer-titles',
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
