'use strict';

const { ValidationError } = require('../errors');

// Formato lingua: 2-3 lettere con eventuale regione (es. en, de, pt-BR); max 10 caratteri (colonna)
const LANGUAGE_REGEX = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/;

/**
 * Unisce i parametri da query string, body JSON e params (CLI/invocazione diretta).
 * Un body non JSON genera ValidationError (HTTP 400).
 */
function parseRequestParams(event) {
  let body = {}; // body parsato
  if (event && event.body) {
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body; // body JSON
    } catch (_err) {
      throw new ValidationError('Il body della richiesta non e\' un JSON valido');
    }
    // Il body deve essere un oggetto
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Il body della richiesta deve essere un oggetto JSON');
    }
  }
  return {
    ...((event && event.queryStringParameters) || {}), // query string
    ...body, // body
    ...((event && event.params) || {}), // params espliciti
  };
}

/**
 * Valida un codice lingua. Valori assenti/vuoti -> undefined (o errore se obbligatorio).
 */
function validateLanguage(value, required) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError('Il parametro "language" e\' obbligatorio');
    return undefined;
  }
  if (typeof value !== 'string' || value.length > 10 || !LANGUAGE_REGEX.test(value.trim())) {
    throw new ValidationError('Il parametro "language" non e\' valido (es. "en", "it", "pt-BR")');
  }
  return value.trim();
}

/**
 * Valida un filtro testuale (path/context): stringa non vuota entro il limite di colonna.
 */
function validateText(value, name, maxLength) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError(`Il parametro "${name}" deve essere una stringa`);
  const trimmed = value.trim(); // normalizzo gli spazi ai bordi
  if (trimmed === '') return undefined;
  if (trimmed.length > maxLength) throw new ValidationError(`Il parametro "${name}" supera ${maxLength} caratteri`);
  return trimmed;
}

module.exports = { parseRequestParams, validateLanguage, validateText };
