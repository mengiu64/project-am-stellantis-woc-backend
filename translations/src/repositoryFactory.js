'use strict';

const { S3TranslationsRepository } = require('./repositories/S3TranslationsRepository');
const { TranslationsDbRepository } = require('./repositories/TranslationsDbRepository');
const { S3TranslationFileReader } = require('./repositories/S3TranslationFileReader');

/**
 * Punto unico di composizione (composition root) per il repository delle traduzioni.
 *
 * Oggi restituisce il repository basato su S3. Quando le traduzioni saranno
 * spostate su database, basterà sostituire questa funzione (es. restituendo
 * una DbTranslationsRepository) senza modificare handlers/translations.js.
 */
function buildRepository(overrides = {}) {
  return new S3TranslationsRepository(overrides);
}

/**
 * Repository Aurora (woc.translations) usato dai nuovi metodi (import S3 e API di consultazione).
 */
function buildDbRepository(overrides = {}) {
  return new TranslationsDbRepository(overrides);
}

/**
 * Lettore di file JSON da S3 (con supporto VersionId) usato dall'import.
 */
function buildFileReader(overrides = {}) {
  return new S3TranslationFileReader(overrides);
}

module.exports = { buildRepository, buildDbRepository, buildFileReader };
