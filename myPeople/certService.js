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
          resolve(parsed.SecretString);
        } catch (err) {
          reject(new Error(`[certService] invalid response retrieving secret "${secretId}": ${err.message}`));
        }
      });
    }).on('error', reject);
  });
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

module.exports = { getHttpsAgent, fetchSecret, _resetCache };
