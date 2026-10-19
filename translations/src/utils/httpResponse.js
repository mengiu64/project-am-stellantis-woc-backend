'use strict';

/**
 * Costruisce una risposta API Gateway proxy (regola di contratto: Content-Type JSON).
 *
 * @param {number} statusCode - codice di stato HTTP
 * @param {object} body - payload serializzato in JSON
 * @returns {{statusCode:number, headers:object, body:string}}
 */
function response(statusCode, body) {
  return {
    statusCode, // codice di stato HTTP
    headers: { 'Content-Type': 'application/json' }, // contenuto sempre JSON
    body: JSON.stringify(body), // il body proxy deve essere una stringa
  };
}

/**
 * Converte un'eccezione in risposta HTTP. Mai 401/403 (riservati all'auth di piattaforma,
 * vedi Backend Integration Guide): 400 input non valido, 404 non trovato, 500 errore interno.
 * Per gli errori tecnici il dettaglio resta nei log, al client va un messaggio generico.
 *
 * @param {Error} err - eccezione intercettata
 * @param {string} operation - nome dell'operazione (per il log)
 * @returns {{statusCode:number, headers:object, body:string}}
 */
function errorResponse(err, operation) {
  // Input non valido -> 400
  if (err && err.code === 'VALIDATION_ERROR') {
    console.log(JSON.stringify({ logType: 'validation_error', service: 'translations', operation, error: err.message }));
    return response(400, { success: false, message: err.message });
  }
  // Nessun record -> 404
  if (err && (err.code === 'NO_TRANSLATIONS_FOUND' || err.code === 'TRANSLATION_NOT_FOUND')) {
    console.log(JSON.stringify({ logType: 'not_found', service: 'translations', operation, error: err.message }));
    return response(404, { success: false, message: err.message });
  }
  // Errore tecnico (DB, rete, ...) -> 500 con messaggio generico, dettaglio solo nel log
  console.error(JSON.stringify({
    logType: 'error',
    service: 'translations',
    operation,
    error: err && err.message ? err.message : String(err),
    stack: err && err.stack,
  }));
  return response(500, { success: false, message: 'Errore interno durante l\'elaborazione della richiesta' });
}

module.exports = { response, errorResponse };
