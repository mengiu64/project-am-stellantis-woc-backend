'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

/**
 * Legge un singolo oggetto JSON da S3 (opzionalmente una versione precisa).
 * Usato dal ramo di import S3 -> Aurora; non modifica il repository S3 esistente.
 */
class S3TranslationFileReader {
  constructor({ s3Client } = {}) {
    this.s3Client = s3Client || new S3Client({}); // client S3 riusabile
  }

  /**
   * @param {{bucket:string, key:string, versionId?:string}} params - posizione dell'oggetto
   * @returns {Promise<object>} JSON parsato
   * @throws {Error} se l'oggetto non e' leggibile o non e' JSON valido
   */
  async readJson({ bucket, key, versionId }) {
    const input = { Bucket: bucket, Key: key }; // parametri base della GetObject
    if (versionId) input.VersionId = versionId; // lettura della versione che ha generato l'evento
    const startedAt = Date.now(); // per misurare la durata
    console.log(JSON.stringify({ logType: 'http_request', service: 'translations', method: 'S3:GetObject', bucket, key, versionId: versionId || null }));
    let response;
    try {
      response = await this.s3Client.send(new GetObjectCommand(input)); // download
    } catch (err) {
      console.error(JSON.stringify({ logType: 'http_error', service: 'translations', method: 'S3:GetObject', bucket, key, versionId: versionId || null, durationMs: Date.now() - startedAt, error: err.message }));
      throw err;
    }
    // Il Body e' uno stream: lo accumulo in memoria
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf-8'); // testo del file
    console.log(JSON.stringify({ logType: 'http_response', service: 'translations', method: 'S3:GetObject', bucket, key, durationMs: Date.now() - startedAt, sizeBytes: raw.length }));
    try {
      // Rimuovo l'eventuale BOM UTF-8 prima del parsing
      return JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (err) {
      throw new Error(`Contenuto JSON non valido per "${key}": ${err.message}`);
    }
  }
}

module.exports = { S3TranslationFileReader };
