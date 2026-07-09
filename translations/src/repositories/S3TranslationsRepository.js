'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { TranslationsRepository } = require('./TranslationsRepository');
const { TranslationNotFoundError } = require('../errors');

/**
 * S3TranslationsRepository — legge il file di traduzioni da S3 al path
 * `{keyPrefix}/{lang}/translation.json` (default: locales/{lang}/translation.json).
 */
class S3TranslationsRepository extends TranslationsRepository {
  constructor({ bucketName, keyPrefix, s3Client } = {}) {
    super();
    this.bucketName = bucketName ?? process.env.TRANSLATIONS_BUCKET_NAME;
    this.keyPrefix  = keyPrefix ?? process.env.TRANSLATIONS_KEY_PREFIX ?? 'locales';
    this.s3Client   = s3Client ?? new S3Client({});
  }

  buildKey(lang) {
    return `${this.keyPrefix}/${lang}/translation.json`;
  }

  async getTranslations(lang) {
    if (!this.bucketName) {
      throw new Error('TRANSLATIONS_BUCKET_NAME non configurato');
    }

    const key = this.buildKey(lang);

    let response;
    try {
      response = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new TranslationNotFoundError(lang);
      }
      throw err;
    }

    const raw = await streamToString(response.Body);

    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Contenuto non valido per "${key}": ${err.message}`);
    }
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

module.exports = { S3TranslationsRepository };
