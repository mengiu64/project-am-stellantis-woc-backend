'use strict';

const https = require('https');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

// Cache in-process del https.Agent (sopravvive tra invocazioni "warm" della stessa
// istanza Lambda), per evitare di scaricare il certificato da S3 ad ogni chiamata.
let cachedAgentPromise = null;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchObject(s3Client, bucket, key) {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return streamToBuffer(response.Body);
}

/**
 * Scarica il certificato client (.cer) e la chiave privata (.key) da S3 e costruisce
 * un https.Agent da usare per l'autenticazione mTLS verso il servizio AgendaSOA.
 *
 * Variabili d'ambiente:
 *   AGENDA_SOA_CERT_BUCKET     - Bucket S3 che contiene i file del certificato
 *   AGENDA_SOA_CERT            - Key S3 del file .cer (es. "certs/mwpaga0a.cer")
 *   AGENDA_SOA_KEY              - Key S3 del file .key (es. "certs/mwpaga0a.key")
 *   AGENDA_SOA_KEY_PASSPHRASE  - (opzionale) passphrase della chiave privata, se cifrata
 *
 * Se `AGENDA_SOA_CERT_BUCKET` non è configurato, il client funziona senza certificato
 * (nessun mTLS) — utile per ambienti/servizi che non lo richiedono.
 *
 * @param {object} [options]
 * @param {import('@aws-sdk/client-s3').S3Client} [options.s3Client] - Client S3 (per i test)
 * @returns {Promise<https.Agent|undefined>}
 */
function getHttpsAgent({ s3Client } = {}) {
  if (!cachedAgentPromise) {
    cachedAgentPromise = loadHttpsAgent({ s3Client }).catch((err) => {
      cachedAgentPromise = null; // consente un nuovo tentativo alla prossima chiamata
      throw err;
    });
  }
  return cachedAgentPromise;
}

async function loadHttpsAgent({ s3Client }) {
  const bucket = process.env.AGENDA_SOA_CERT_BUCKET;
  const certKey = process.env.AGENDA_SOA_CERT;
  const keyKey = process.env.AGENDA_SOA_KEY;

  if (!bucket || !certKey || !keyKey) {
    return undefined;
  }

  const client = s3Client ?? new S3Client({});
  const [cert, key] = await Promise.all([
    fetchObject(client, bucket, certKey),
    fetchObject(client, bucket, keyKey),
  ]);

  return new https.Agent({
    cert,
    key,
    passphrase: process.env.AGENDA_SOA_KEY_PASSPHRASE || undefined,
  });
}

/** Resetta la cache (solo per i test). */
function _resetCache() {
  cachedAgentPromise = null;
}

module.exports = { getHttpsAgent, _resetCache };
