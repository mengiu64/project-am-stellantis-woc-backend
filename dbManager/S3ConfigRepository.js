'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const HQ_SECTIONS_FILE = 'hq_sections.json';
const HQ_ACTIONTYPE_FILE = 'hq_actiontype.json';

/**
 * S3ConfigRepository — legge le anagrafiche statiche (hq_sections.json,
 * hq_actiontype.json) usate dall'audit HQ (woc.hq_audit) da S3, al path
 * `{keyPrefix}/{file}` (default: config/hq_sections.json, config/hq_actiontype.json),
 * stesso identico pattern (bucket/cache/errori) di v360/s3ConfigRepository.js.
 *
 * I risultati vengono mantenuti in cache in memoria per l'intero ciclo di vita
 * dell'istanza (tipicamente il container Lambda "caldo"), trattandosi di
 * anagrafiche statiche che cambiano raramente.
 */
class S3ConfigRepository {
  constructor({ bucketName, keyPrefix, s3Client } = {}) {
    this.bucketName = bucketName ?? process.env.CONFIG_BUCKET_NAME;
    this.keyPrefix  = keyPrefix ?? process.env.CONFIG_KEY_PREFIX ?? 'config';
    this.s3Client   = s3Client ?? new S3Client({});
    this._cache = new Map();
  }

  buildKey(fileName) {
    return `${this.keyPrefix}/${fileName}`;
  }

  /**
   * @returns {Promise<Array<{section: string}>>}
   */
  async getAnagSection() {
    return this._getJson(HQ_SECTIONS_FILE);
  }

  /**
   * @returns {Promise<Array<{type: string}>>}
   */
  async getAnagAllocation() {
    return this._getJson(HQ_ACTIONTYPE_FILE);
  }

  async _getJson(fileName) {
    if (this._cache.has(fileName)) {
      return this._cache.get(fileName);
    }

    if (!this.bucketName) {
      throw new Error('CONFIG_BUCKET_NAME non configurato');
    }

    const key = this.buildKey(fileName);
    const startedAt = Date.now();

    console.log(JSON.stringify({
      logType: 'http_request',
      service: 'hqManager',
      method: 'S3:GetObject',
      bucket: this.bucketName,
      key,
    }));

    let response;
    try {
      response = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
    } catch (err) {
      console.log(JSON.stringify({
        logType: 'http_error',
        service: 'hqManager',
        method: 'S3:GetObject',
        bucket: this.bucketName,
        key,
        durationMs: Date.now() - startedAt,
        error: err.message,
      }));
      if (isNotFoundError(err)) {
        throw new Error(`File "${key}" non trovato nel bucket "${this.bucketName}"`);
      }
      throw err;
    }

    const raw = await streamToString(response.Body);

    console.log(JSON.stringify({
      logType: 'http_response',
      service: 'hqManager',
      method: 'S3:GetObject',
      bucket: this.bucketName,
      key,
      durationMs: Date.now() - startedAt,
      sizeBytes: raw.length,
    }));

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Contenuto non valido per "${key}": ${err.message}`);
    }

    this._cache.set(fileName, parsed);
    return parsed;
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

module.exports = { S3ConfigRepository };
