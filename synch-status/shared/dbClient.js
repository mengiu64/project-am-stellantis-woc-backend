'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { Pool } = require('pg');

// Riferimento al pool condiviso tra invocazioni (warm start)
let cachedPool = null;

// Client AWS (riutilizzati tra invocazioni)
const smClient = new SecretsManagerClient({});
const ssmClient = new SSMClient({});

// Cache dei valori SSM (non cambiano tra invocazioni)
let cachedDbSecretArn = null;
let cachedRdsProxyEndpoint = null;

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value).toLowerCase() === 'true';
}

/**
 * Recupera un valore da SSM Parameter Store.
 *
 * @param {string} paramName - Nome del parametro SSM
 * @returns {Promise<string>} valore del parametro
 * @throws {Error} se il parametro non è recuperabile
 */
async function getSsmParameter(paramName) {
  const command = new GetParameterCommand({ Name: paramName, WithDecryption: true });
  const response = await ssmClient.send(command);
  return response.Parameter.Value;
}

/**
 * Recupera l'ARN del secret DB da SSM (con cache).
 *
 * @returns {Promise<string>} ARN del secret in Secrets Manager
 */
async function getDbSecretArn() {
  if (cachedDbSecretArn) return cachedDbSecretArn;

  const paramName = process.env.DB_SECRET_ARN_PARAM;
  if (!paramName) {
    throw new Error('Variabile d\'ambiente DB_SECRET_ARN_PARAM non configurata');
  }

  cachedDbSecretArn = await getSsmParameter(paramName);
  return cachedDbSecretArn;
}

/**
 * Recupera l'endpoint RDS Proxy da SSM (con cache).
 *
 * @returns {Promise<string>} endpoint del RDS Proxy
 */
async function getRdsProxyEndpoint() {
  if (cachedRdsProxyEndpoint) return cachedRdsProxyEndpoint;

  const paramName = process.env.RDS_PROXY_ENDPOINT_PARAM;
  if (!paramName) {
    throw new Error('Variabile d\'ambiente RDS_PROXY_ENDPOINT_PARAM non configurata');
  }

  cachedRdsProxyEndpoint = await getSsmParameter(paramName);
  return cachedRdsProxyEndpoint;
}

/**
 * Recupera le credenziali del database da Secrets Manager.
 * Non logga mai valori segreti.
 *
 * @returns {Promise<{dbname: string, engine: string, password: string, port: number, username: string}>}
 * @throws {Error} se il recupero delle credenziali fallisce
 */
async function getCredentials() {
  const secretArn = await getDbSecretArn();

  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await smClient.send(command);

  if (!response.SecretString) {
    throw new Error('Il secret non contiene SecretString');
  }

  return JSON.parse(response.SecretString);
}

/**
 * Restituisce le credenziali per la connessione locale (bypassa SSM e Secrets Manager).
 */
function getLocalCredentials() {
  return {
    dbname: process.env.DB_NAME || 'wiadvisor',
    username: process.env.DB_USER || 'wiadvisor_app',
    password: process.env.DB_PASSWORD || 'mennea',
    port: Number(process.env.DB_PORT || 5433),
  };
}

/**
 * Restituisce un'istanza Pool pg connessa al database wiadvisor via RDS Proxy.
 * Riutilizza il pool tra invocazioni (warm start).
 * In caso di errore di connessione, invalida il pool per la prossima chiamata.
 *
 * @returns {Promise<import('pg').Pool>} pool connesso e pronto all'uso
 * @throws {Error} se le credenziali non sono recuperabili o la connessione fallisce entro 5 secondi
 */
async function getPool() {
  // Se il pool è già disponibile e funzionante, riutilizzarlo
  if (cachedPool) {
    return cachedPool;
  }

  const useLocalDb = parseBoolean(process.env.DB_LOCAL_MODE, false);

  let credentials;
  let host;
  let sslEnabled;

  if (useLocalDb) {
    credentials = getLocalCredentials();
    host = process.env.DB_HOST || '127.0.0.1';
    sslEnabled = parseBoolean(process.env.DB_SSL, false);
  } else {
    // Recupero credenziali da Secrets Manager (ARN letto da SSM)
    credentials = await getCredentials();
    host = await getRdsProxyEndpoint();
    sslEnabled = true;
  }

  // Creazione del pool con timeout di 5 secondi
  const pool = new Pool({
    host,
    port: credentials.port || 5432,
    database: credentials.dbname,
    user: credentials.username,
    password: credentials.password,
    ssl: sslEnabled,
    connectionTimeoutMillis: 5000,
    max: 1 // Lambda usa una singola connessione per invocazione
  });

  // Gestione errori sul pool: invalida il riferimento in caso di disconnessione
  pool.on('error', () => {
    // Errore sul pool (es. connessione persa) — invalida per la prossima invocazione
    cachedPool = null;
  });

  // Verifica che la connessione funzioni effettivamente
  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    // Connessione fallita — invalida il pool e propaga l'errore
    cachedPool = null;
    await pool.end().catch(() => {});
    throw err;
  }

  // Pool valido — salva in cache per riutilizzo (warm start)
  cachedPool = pool;
  return pool;
}

/**
 * Invalida il pool corrente e la cache SSM. Utile per forzare una nuova connessione.
 * Utilizzato principalmente nei test.
 */
function invalidatePool() {
  cachedPool = null;
  cachedDbSecretArn = null;
  cachedRdsProxyEndpoint = null;
}

module.exports = { getPool, invalidatePool };
