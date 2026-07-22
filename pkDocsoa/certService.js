'use strict';

const http = require('http');
const https = require('https');

// Segreti Secrets Manager (client certificate/key mTLS) — GLI STESSI usati da myPeople
// (vedi myPeople/certService.js): di default "apicCert"/"apicKey", configurabili via env
// solo per compatibilità/override (in template.yaml puntano allo stesso parametro
// MyPeopleCertSecretId/MyPeopleKeySecretId, quindi allo stesso segreto fisico).
const CERT_SECRET_ID = process.env.DOCSOA_CERT_SECRET_ID || 'apicCert';
const KEY_SECRET_ID = process.env.DOCSOA_KEY_SECRET_ID || 'apicKey';
const EXTENSION_PORT = Number(process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT) || 2773;

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
      port: EXTENSION_PORT,
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
 * Alcuni segreti sono stati salvati su Secrets Manager come oggetto "JSON-like"
 * (es. {"apicCert": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"},
 * spesso con newline reali non escapate dentro le virgolette, quindi non è detto sia
 * JSON valido) invece che come PEM puro in "Plaintext". Questa funzione normalizza
 * entrambi i casi: se il valore è già un PEM (inizia con "-----BEGIN") lo restituisce
 * trimmato, altrimenti cerca ovunque nella stringa un blocco "-----BEGIN ... -----END
 * ...-----" e lo estrae; se non trova nulla restituisce il valore originale invariato.
 *
 * @param {string} value
 * @returns {string}
 */
function extractPem(value) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;

  const match = value.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/);
  return match ? match[0] : value;
}

/**
 * Scarica il certificato client (.cer/.pem) e la chiave privata (.key/.pem) da
 * Secrets Manager (segreti "apicCert"/"apicKey", configurabili via env, gli STESSI
 * usati da myPeople) e costruisce un https.Agent da usare per l'autenticazione mTLS
 * verso il gateway DocSOA (api-cert-preprod.groupe-psa.com/api/cert-aai).
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
    fetchSecret(CERT_SECRET_ID),
    fetchSecret(KEY_SECRET_ID),
  ]);

  return new https.Agent({ cert, key });
}

/** Resetta la cache (solo per i test). */
function _resetCache() {
  cachedAgentPromise = null;
}

module.exports = { getHttpsAgent, fetchSecret, _resetCache, extractPem };
