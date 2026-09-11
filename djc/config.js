'use strict';

// Client PingFederate/DGT condiviso con la lambda jobcard (stessa "Push API SRP"
// / Digital Layer API — la POST /jobCard di djc usa le stesse credenziali/URL
// delle GET /jobCardList e /jobCardDetails di jobcard). File mantenuto in sync
// con jobcard/config.js: eventuali modifiche vanno replicate in entrambe le lambda.

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
 */
function buildConfig(secrets) {
  return {
    // PingFederate token endpoint
    auth: {
      url: secrets.JOBCARD_PING_URL,
      grantType: 'client_credentials',
      scope: 'prd:dgt',
      clientId: secrets.JOBCARD_PING_CLIENT_ID,
      clientSecret: secrets.JOBCARD_PING_CLIENT_SECRET,
    },

    // Stellantis DGT API
    dgt: {
      baseUrl: secrets.DGT_BASE_URL,
      basePath: secrets.DGT_BASE_PATH,
      clientId: secrets.DGT_CLIENT_ID,
      clientSecret: secrets.DGT_CLIENT_SECRET,
    },
  };
}

/**
 * Restituisce l'oggetto di configurazione completo (con cache in memoria).
 * Le URL/path e le credenziali (PingFederate + DGT) sono lette da AWS Secrets Manager (secret
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
    JOBCARD_PING_URL: secretUrls.JOBCARD_PING_URL || process.env.JOBCARD_PING_URL || 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    DGT_BASE_URL: secretUrls.DGT_BASE_URL || process.env.DGT_BASE_URL || 'https://emea-aws.stage.np-api.stellantis.com',
    DGT_BASE_PATH: secretUrls.DGT_BASE_PATH || process.env.DGT_BASE_PATH || '/ps-stage/extra/srp/digital-layer/v1',
    // Credenziali PingFederate/DGT: non più passate come variabile d'ambiente/
    // parametro CFN in chiaro sulla Lambda, ma lette dallo stesso secret
    // condiviso ("service urls") — v. template.yaml/ServiceUrlsSecretId.
    JOBCARD_PING_CLIENT_ID: secretUrls.JOBCARD_PING_CLIENT_ID || process.env.JOBCARD_PING_CLIENT_ID,
    JOBCARD_PING_CLIENT_SECRET: secretUrls.JOBCARD_PING_CLIENT_SECRET || process.env.JOBCARD_PING_CLIENT_SECRET,
    DGT_CLIENT_ID: secretUrls.DGT_CLIENT_ID || process.env.DGT_CLIENT_ID,
    DGT_CLIENT_SECRET: secretUrls.DGT_CLIENT_SECRET || process.env.DGT_CLIENT_SECRET,
  };

  const missingCreds = ['JOBCARD_PING_CLIENT_ID', 'JOBCARD_PING_CLIENT_SECRET', 'DGT_CLIENT_ID', 'DGT_CLIENT_SECRET']
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
