'use strict';

const { S3TranslationsRepository } = require('./repositories/S3TranslationsRepository');

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

module.exports = { buildRepository };
