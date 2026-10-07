'use strict';

/**
 * db.js — Connessione al database Aurora PostgreSQL "wiadvisor" (tabella
 * woc.jobcard_sync_activity, v. JobcardSyncActivityRepository.js).
 *
 * Stesso meccanismo di dbManager/db.js e pkFavorite/db.js: le credenziali
 * (username/password) dell'utente applicativo least-privilege ("wiadvisor_app")
 * sono recuperate da AWS Secrets Manager tramite la AWS Parameters and Secrets
 * Lambda Extension (layer, http://localhost:<port>/secretsmanager/get); host
 * (RDS Proxy)/porta/nome db da env var JOBCARD_DB_* (template.yaml) oppure, se
 * assenti, dal secret stesso.
 *
 * La configurazione è letta al primo utilizzo (non al require): le azioni di
 * jobcard che non usano il DB (list, listCurrent, dml) non devono richiedere
 * JOBCARD_DB_HOST; details lo usa solo per la lettura best-effort dell'esito
 * (ack/techReason/businessReason, v. JobcardSyncActivityRepository.getSyncStatus),
 * che in sua assenza resta vuoto senza far fallire la risposta; lastPayload
 * (lettura del payload, v. getLastPayload) invece lo richiede (errore -> 502).
 *
 * Copia di djc/db.js (con env JOBCARD_DB_*), mantenuta in sync: la POST
 * saveJobcard è instradata da API Gateway a questa lambda.
 */

const http = require('http');
const { Pool } = require('pg');

// Cache in-process del Pool (sopravvive tra invocazioni "warm" della stessa istanza Lambda).
let cachedPoolPromise = null;

function getDbConfig() {
  return {
    host: process.env.JOBCARD_DB_HOST,
    port: process.env.JOBCARD_DB_PORT ? Number(process.env.JOBCARD_DB_PORT) : undefined,
    name: process.env.JOBCARD_DB_NAME,
    user: process.env.JOBCARD_DB_USER,
    password: process.env.JOBCARD_DB_PASSWORD,
    // Aurora richiede/accetta TLS; JOBCARD_DB_SSL=false solo per test locali senza TLS.
    ssl: process.env.JOBCARD_DB_SSL !== 'false',
    secretId: process.env.JOBCARD_DB_SECRET_ID || 'sm-np-bsn0027990-dev-aurora-app',
    extensionPort: Number(process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT) || 2773,
  };
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
          reject(new Error(`[jobcard/db] secret "${secretId}" fetch failed: HTTP ${res.statusCode} - ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve(JSON.parse(parsed.SecretString));
        } catch (err) {
          reject(new Error(`[jobcard/db] invalid response retrieving secret "${secretId}": ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function buildPool() {
  const cfg = getDbConfig();
  if (!cfg.host && !process.env.JOBCARD_DB_SECRET_ID) {
    throw new Error('[jobcard/db] Missing required environment variable: JOBCARD_DB_HOST');
  }

  let { user, password, port } = cfg;
  let database = cfg.name;

  if (!cfg.host || !user || !password) {
    const secret = await fetchSecretJson(cfg.secretId, cfg.extensionPort);
    user = user || secret.username;
    password = password || secret.password;
    database = database || secret.proxydbname || secret.dbname;
    port = port || secret.proxyport || secret.port;
    cfg.host = cfg.host || secret.proxyhost;
  }

  if (!cfg.host) throw new Error('[jobcard/db] proxyhost is required in the database secret');
  return new Pool({
    host: cfg.host,
    port: port || 5432,
    database: database || 'wiadvisor',
    user,
    password,
    // Poche connessioni per istanza Lambda: il pooling "vero" è demandato all'RDS Proxy.
    max: 3,
    idleTimeoutMillis: 30000,
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

module.exports = { getPool, fetchSecretJson, _resetPool };
