'use strict';

// Errore applicativo con codice HTTP associato (mai 401/403: riservati all'auth di piattaforma)
class HttpError extends Error {
  // Costruttore: riceve codice HTTP, messaggio e dettagli opzionali
  constructor(statusCode, message, details) {
    // Inizializza la classe base Error con il messaggio
    super(message);
    // Nome dell'errore per i log
    this.name = 'HttpError';
    // Codice di stato HTTP da restituire al client
    this.statusCode = statusCode;
    // Eventuali dettagli di validazione
    this.details = details;
  }
}

// Esporta la classe per handler, validatori e repository
module.exports = { HttpError };
