'use strict';

/**
 * Errore dedicato al caso "dati di sessione non trovati" — permette all'handler di
 * distinguere un 404 (dati assenti per il mercato o l'utente richiesto) da
 * un errore tecnico generico (502).
 *
 * @param {string} value - Il valore cercato (codmarket o username).
 * @param {string} [label] - Etichetta descrittiva usata nel messaggio (default "il mercato").
 */
class SessionNotFoundError extends Error {
  constructor(value, label = 'il mercato') {
    super(`Dati di sessione non trovati per ${label} "${value}"`);
    this.name = 'SessionNotFoundError';
    this.code = 'SESSION_NOT_FOUND';
  }
}

module.exports = { SessionNotFoundError };
