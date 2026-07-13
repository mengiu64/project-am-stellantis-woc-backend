'use strict';

const { S3SessionRepository } = require('./repositories/s3SessionRepository');

/**
 * Punto unico di composizione (composition root) per il repository dei dati di sessione.
 *
 * Oggi restituisce il repository basato su S3. Se in futuro la fonte dati dovesse
 * cambiare, bastera' sostituire questa funzione senza modificare src/index.js.
 */
function buildRepository(overrides = {}) {
  return new S3SessionRepository(overrides);
}

module.exports = { buildRepository };
