'use strict';

/**
 * Errore dedicato al caso "lingua non trovata" — permette all'handler di
 * distinguere un 404 (traduzioni assenti) da un errore tecnico generico (502).
 */
class TranslationNotFoundError extends Error {
  constructor(lang) {
    super(`Traduzioni non trovate per la lingua "${lang}"`);
    this.name = 'TranslationNotFoundError';
    this.code = 'TRANSLATION_NOT_FOUND';
  }
}

module.exports = { TranslationNotFoundError };
