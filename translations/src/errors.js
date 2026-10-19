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

/**
 * Errore di validazione dell'input (parametri mancanti o non validi) — mappato a HTTP 400.
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

/**
 * Nessun record trovato in woc.translations per i filtri richiesti — mappato a HTTP 404.
 */
class NoTranslationsFoundError extends Error {
  constructor(message = 'Nessuna traduzione trovata per i filtri richiesti') {
    super(message);
    this.name = 'NoTranslationsFoundError';
    this.code = 'NO_TRANSLATIONS_FOUND';
  }
}

module.exports = { TranslationNotFoundError, ValidationError, NoTranslationsFoundError };
