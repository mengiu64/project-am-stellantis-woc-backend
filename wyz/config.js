'use strict';

// Configurazione della Lambda wyz.
// In Lambda: credenziali da SSM Parameter Store → Secrets Manager.
// In locale (CLI): credenziali dal file .env / variabili d'ambiente.
// Il risultato è cachato in memoria per i warm start.

const fs = require('fs');
const path = require('path');

// Default preprod (da Preprod-wyz.postman_environment): in stage/prod si sovrascrivono dal secret
const DEFAULT_BASE_URL = 'https://api-preprod.wyzexchange.com';
const DEFAULT_IAM_BASE_URL = 'https://preprod-iam.wyzexchange.com';
const DEFAULT_TENANT = 'STA';
// Identifica il processo corretto lato Wyz (parametro "partner" obbligatorio su tutti gli endpoint)
const PARTNER = 'WIADVISOR';
// Timeout socket verso Wyz (ms): inferiore al Timeout Lambda (30s) per poter rispondere con un errore gestito
const HTTP_TIMEOUT_MS = 10000;

let cachedConfig = null;

/** Carica il file .env locale (solo sviluppo); non sovrascrive process.env già valorizzato. */
function loadEnvFile() {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
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

/**
 * Costruisce la configurazione a partire dai segreti.
 * @param {object} secrets
 * @returns {object} { auth, api, partner, timeoutMs }
 */
function buildConfig(secrets) {
  const iamBaseUrl = secrets.WYZ_IAM_BASE_URL || DEFAULT_IAM_BASE_URL;
  const tenant = secrets.WYZ_TENANT || DEFAULT_TENANT;
  return {
    auth: {
      // Endpoint Keycloak: {IAM_BASE_URL}/realms/{TENANT}/protocol/openid-connect/token
      url: `${iamBaseUrl}/realms/${tenant}/protocol/openid-connect/token`,
      grantType: 'client_credentials',
      clientId: secrets.WYZ_CLIENT_ID,
      clientSecret: secrets.WYZ_CLIENT_SECRET,
    },
    api: {
      baseUrl: secrets.WYZ_BASE_URL || DEFAULT_BASE_URL,
    },
    partner: PARTNER,
    timeoutMs: HTTP_TIMEOUT_MS,
  };
}

/**
 * Restituisce la configurazione completa (con cache).
 * @returns {Promise<object>}
 * @throws {Error} se le credenziali non sono recuperabili
 */
async function getConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  loadEnvFile();

  let secrets;
  if (process.env.WYZ_PARAM_NAME) {
    // Ambiente Lambda
    const { loadSecrets } = require('./secretsLoader');
    console.log('[config] Caricamento credenziali da SSM/Secrets Manager');
    secrets = await loadSecrets();
  } else {
    // Ambiente locale
    console.log("[config] Caricamento credenziali da variabili d'ambiente locali");
    const REQUIRED_ENV = ['WYZ_CLIENT_ID', 'WYZ_CLIENT_SECRET'];
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`[config] Variabili d'ambiente obbligatorie mancanti: ${missing.join(', ')}`);
    }
    secrets = {
      WYZ_CLIENT_ID: process.env.WYZ_CLIENT_ID,
      WYZ_CLIENT_SECRET: process.env.WYZ_CLIENT_SECRET,
      WYZ_BASE_URL: process.env.WYZ_BASE_URL,
      WYZ_IAM_BASE_URL: process.env.WYZ_IAM_BASE_URL,
      WYZ_TENANT: process.env.WYZ_TENANT,
    };
  }

  cachedConfig = buildConfig(secrets);
  console.log('[config] Configurazione caricata con successo');
  return cachedConfig;
}

/** Invalida la cache della configurazione (test / refresh forzato). */
function invalidateConfig() {
  cachedConfig = null;
}

module.exports = { getConfig, invalidateConfig };
