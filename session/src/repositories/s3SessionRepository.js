'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SessionRepository } = require('./sessionRepository');
const { SessionNotFoundError } = require('../errors');

/**
 * S3SessionRepository — legge il file unico dei dati di sessione da S3
 * (default: session/session_data.json, bucket via SESSION_BUCKET_NAME) e ne
 * estrae la sezione relativa al mercato richiesto (chiave = codmarket a 4
 * caratteri, es. "1000").
 *
 * Formato atteso del file JSON:
 *   { "1000": { "codmarket": "1000", "oic": "...", ... }, "3109": { ... }, ... }
 */
class S3SessionRepository extends SessionRepository {
  constructor({ bucketName, dataKey, s3Client } = {}) {
    super();
    this.bucketName = bucketName ?? process.env.SESSION_BUCKET_NAME;
    this.dataKey    = dataKey ?? process.env.SESSION_DATA_KEY ?? 'session/session_data.json';
    this.s3Client   = s3Client ?? new S3Client({});
  }

  /**
   * @param {string} codmarket - Codice mercato a 4 caratteri (es. "1000").
   * @returns {Promise<object>} I dati di sessione per il mercato richiesto.
   */
  async getSessionData(codmarket) {
    if (!this.bucketName) {
      throw new Error('SESSION_BUCKET_NAME non configurato');
    }

    const market = String(codmarket).toUpperCase();

    let response;
    try {
      response = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: this.dataKey,
      }));
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new Error(`File "${this.dataKey}" non trovato nel bucket "${this.bucketName}"`);
      }
      throw err;
    }

    const raw = await streamToString(response.Body);

    let allMarketsData;
    try {
      allMarketsData = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Contenuto non valido per "${this.dataKey}": ${err.message}`);
    }

    const marketData = allMarketsData[market];
    if (!marketData) {
      throw new SessionNotFoundError(market);
    }

    return marketData;
  }
}

function isNotFoundError(err) {
  return (
    err?.name === 'NoSuchKey' ||
    err?.Code === 'NoSuchKey' ||
    err?.$metadata?.httpStatusCode === 404
  );
}

async function streamToString(stream) {
  // SDK v3: response.Body è uno stream Node.js (o un Blob nel browser, non rilevante qui).
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

module.exports = { S3SessionRepository };
