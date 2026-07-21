'use strict';

const http = require('http');
const https = require('https');
const config = require('./config');

// Cache in-process del https.Agent (sopravvive tra invocazioni "warm" della stessa
// istanza Lambda), per evitare di richiedere i segreti ad ogni invocazione.
let cachedAgentPromise = null;

/**
 * Recupera un segreto da AWS Secrets Manager tramite la AWS Parameters and Secrets
 * Lambda Extension (layer), che espone una cache locale su http://localhost:<port>.
 * https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
 *
 * @param {string} secretId - nome/ARN del segreto (es. "apicCert")
 * @returns {Promise<string>} il valore SecretString del segreto
 */
function fetchSecret(secretId) {
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
          reject(new Error(`[certService] secret "${secretId}" fetch failed: HTTP ${res.statusCode} - ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve(extractPem(parsed.SecretString));
        } catch (err) {
          reject(new Error(`[certService] invalid response retrieving secret "${secretId}": ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Alcuni segreti sono stati salvati su Secrets Manager come oggetto JSON
 * (es. {"apicCert": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"})
 * invece che come PEM puro in "Plaintext". Questa funzione normalizza entrambi i casi:
 * se il valore è già un PEM (inizia con "-----BEGIN") lo restituisce trimmato,
 * altrimenti prova a fare il parse come JSON ed estrae il valore stringa che
 * sembra un PEM (o l'unico valore presente); in ogni altro caso restituisce il
 * valore originale invariato.
 *
 * @param {string} value
 * @returns {string}
 */
function extractPem(value) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return value;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const values = Object.values(parsed).filter((v) => typeof v === 'string');
    const pemValue = values.find((v) => v.trim().startsWith('-----BEGIN'));
    if (pemValue) return pemValue.trim();
    if (values.length === 1) return values[0].trim();
  }

  return value;
}

/**
 * Scarica il certificato client (.cer/.pem) e la chiave privata (.key/.pem) da
 * Secrets Manager (segreti "apicCert"/"apicKey", configurabili via env) e costruisce
 * un https.Agent da usare per l'autenticazione mTLS verso l'API myPeople.
 *
 * @returns {Promise<https.Agent>}
 */
function getHttpsAgent() {
  if (!cachedAgentPromise) {
    cachedAgentPromise = loadHttpsAgent().catch((err) => {
      cachedAgentPromise = null; // consente un nuovo tentativo alla prossima chiamata
      throw err;
    });
  }
  return cachedAgentPromise;
}

async function loadHttpsAgent() {
  const [cert, key] = await Promise.all([
    fetchSecret(config.secrets.certSecretId),
    fetchSecret(config.secrets.keySecretId),
  ]);

  return new https.Agent({ cert, key });
}

/** Resetta la cache (solo per i test). */
function _resetCache() {
  cachedAgentPromise = null;
}

module.exports = { getHttpsAgent, fetchSecret, _resetCache, extractPem };
