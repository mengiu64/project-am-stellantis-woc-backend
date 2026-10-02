'use strict';

/**
 * db.js — Connessione al database Aurora PostgreSQL "wiadvisor" (tabella
 * woc.mopardoc_inspection_media, v. InspectionMetadataRepository.js).
 *
 * Stesso meccanismo di djc/db.js: le credenziali (username/password)
 * dell'utente applicativo least-privilege ("wiadvisor_app") sono recuperate da
 * AWS Secrets Manager tramite la AWS Parameters and Secrets Lambda Extension
 * (layer, http://localhost:<port>/secretsmanager/get); host (RDS Proxy)/porta/
 * nome db da env var MOPARDOC_DB_* (template.yaml) oppure, se assenti, dal
 * secret stesso.
 *
 * La configurazione è letta al primo utilizzo (non al require): le azioni di
 * moparDoc che non usano il DB non devono richiedere MOPARDOC_DB_HOST. Il DB è
 * opzionale per moparDoc: se MOPARDOC_DB_HOST non è valorizzata
 * (isDbConfigured() === false) i metadati di ispezione vengono semplicemente
 * ignorati.
 */

const http = require('http');
const { Pool } = require('pg');

// Cache in-process del Pool (sopravvive tra invocazioni "warm" della stessa istanza Lambda).
let cachedPoolPromise = null;

function getDbConfig() {
  return {
    host: process.env.MOPARDOC_DB_HOST,
    port: process.env.MOPARDOC_DB_PORT ? Number(process.env.MOPARDOC_DB_PORT) : undefined,
    name: process.env.MOPARDOC_DB_NAME,
    user: process.env.MOPARDOC_DB_USER,
    password: process.env.MOPARDOC_DB_PASSWORD,
    // Aurora richiede/accetta TLS; MOPARDOC_DB_SSL=false solo per test locali senza TLS.
    ssl: process.env.MOPARDOC_DB_SSL !== 'false',
    secretId: process.env.MOPARDOC_DB_SECRET_ID || 'sm-np-bsn0027990-dev-aurora-app',
    extensionPort: Number(process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT) || 2773,
  };
}

/**
 * Indica se il DB è configurato (MOPARDOC_DB_HOST valorizzata).
 * @returns {boolean}
 */
function isDbConfigured() {
  return Boolean(process.env.MOPARDOC_DB_HOST && String(process.env.MOPARDOC_DB_HOST).trim());
}

/**
 * Recupera un segreto JSON da AWS Secrets Manager tramite l'estensione Lambda.
 * @param {string} secretId
 * @param {number} extensionPort
 * @returns {Promise<object>} il contenuto del SecretString, parsato come JSON
 */
function fetchSecretJson(secretId, extensionPort) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: extensionPort,
      path: `/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
      headers: {
        'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN,
      },
    };

    http.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`[moparDoc/db] secret "${secretId}" fetch failed: HTTP ${res.statusCode} - ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve(JSON.parse(parsed.SecretString));
        } catch (err) {
          reject(new Error(`[moparDoc/db] invalid response retrieving secret "${secretId}": ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function buildPool() {
  const cfg = getDbConfig();
  if (!cfg.host) {
    throw new Error('[moparDoc/db] Missing required environment variable: MOPARDOC_DB_HOST');
  }

  let { user, password, port } = cfg;
  let database = cfg.name;

  if (!user || !password) {
    const secret = await fetchSecretJson(cfg.secretId, cfg.extensionPort);
    user = user || secret.username;
    password = password || secret.password;
    database = database || secret.dbname;
    port = port || secret.port;
  }

  return new Pool({
    host: cfg.host,
    port: port || 5432,
    database: database || 'wiadvisor',
    user,
    password,
    // Poche connessioni per istanza Lambda: il pooling "vero" è demandato all'RDS Proxy.
    max: 3,
    idleTimeoutMillis: 30000,
    // Fallisce in fretta se il proxy non risponde: i metadati sono opzionali e
    // non devono bloccare upload/getDocuments fino al timeout della Lambda.
    connectionTimeoutMillis: 5000,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
  });
}

/**
 * Ritorna il Pool condiviso (creato al primo utilizzo, poi cache).
 * @returns {Promise<import('pg').Pool>}
 */
function getPool() {
  if (!cachedPoolPromise) {
    cachedPoolPromise = buildPool().catch((err) => {
      cachedPoolPromise = null; // consente un nuovo tentativo alla prossima chiamata
      throw err;
    });
  }
  return cachedPoolPromise;
}

/** Resetta la cache (solo per i test). */
function _resetPool() {
  cachedPoolPromise = null;
}

module.exports = { getPool, isDbConfigured, fetchSecretJson, _resetPool };
