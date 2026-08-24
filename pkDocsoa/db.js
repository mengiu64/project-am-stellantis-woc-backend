'use strict';

/**
 * db.js — Connessione al database Aurora PostgreSQL "wiadvisor" (tabella
 * woc.docsoafunctions), usata da functionServiceDb (DocSOARestClient.js) come
 * sorgente dati alternativa al servizio SOAP functionsService.
 *
 * Le credenziali (username/password) dell'utente applicativo Aurora least-privilege
 * ("wiadvisor_app") sono recuperate da AWS Secrets Manager tramite la AWS Parameters
 * and Secrets Lambda Extension (layer), che espone una cache locale su
 * http://localhost:<port>/secretsmanager/get — stesso meccanismo/pattern già
 * usato da pkFavorite/db.js. Host/porta/nome db possono invece arrivare da env
 * var (template.yaml) oppure, se assenti, dal secret stesso (che le contiene già).
 *
 * https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
 */

const http = require('http');
const { Pool } = require('pg');
const config = require('./config');

// Cache in-process del Pool (sopravvive tra invocazioni "warm" della stessa
// istanza Lambda), per non ricreare connessioni/richiedere il secret ad ogni invocazione.
let cachedPoolPromise = null;

/**
 * Recupera un segreto JSON da AWS Secrets Manager tramite l'estensione Lambda.
 * @param {string} secretId - nome/ARN del segreto (es. "sm-np-bsn0027990-dev-aurora-app")
 * @returns {Promise<object>} il contenuto del SecretString, parsato come JSON
 */
function fetchSecretJson(secretId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: config.secrets.extensionPort,
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
          reject(new Error(`[db] secret "${secretId}" fetch failed: HTTP ${res.statusCode} - ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve(JSON.parse(parsed.SecretString));
        } catch (err) {
          reject(new Error(`[db] invalid response retrieving secret "${secretId}": ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Costruisce il Pool pg, risolvendo user/password/database/port da env var
 * (config.db) oppure, se assenti, dal secret Secrets Manager.
 */
async function buildPool() {
  let { user, password, port } = config.db;
  let database = config.db.name;

  if (!user || !password) {
    const secret = await fetchSecretJson(config.secrets.dbSecretId);
    user = user || secret.username;
    password = password || secret.password;
    database = database || secret.dbname;
    port = port || secret.port;
  }

  return new Pool({
    host: config.db.host,
    port: port || 5432,
    database: database || 'wiadvisor',
    user,
    password,
    // Poche connessioni per istanza Lambda: il pooling "vero" è demandato all'RDS Proxy.
    max: 3,
    idleTimeoutMillis: 30000,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
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
