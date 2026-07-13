'use strict';

/**
 * Errore dedicato al caso "mercato non trovato" — permette all'handler di
 * distinguere un 404 (dati di sessione assenti per il mercato richiesto) da
 * un errore tecnico generico (502).
 */
class SessionNotFoundError extends Error {
  constructor(codmarket) {
    super(`Dati di sessione non trovati per il mercato "${codmarket}"`);
    this.name = 'SessionNotFoundError';
    this.code = 'SESSION_NOT_FOUND';
  }
}

module.exports = { SessionNotFoundError };
