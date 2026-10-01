'use strict';

// Errore HTTP applicativo
const { HttpError } = require('./errors');

// Espressione regolare semplice per la validazione del formato email
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Lunghezze massime coerenti con le colonne del DB (sql/create_tables_hq_settings.sql)
const MAX_LEN = { oic_code: 20, market: 10, dealership_code: 50, email: 255 };

// Campi booleani di woc.customer_options
const BOOLEAN_FIELDS = ['customer_waiting_on_site', 'cleaning_approval_internal', 'cleaning_approval_external'];

// Campi email di woc.hq_settings_email
const EMAIL_FIELDS = ['signature_email', 'dpo_email'];

/**
 * Valida una chiave testuale (oic_code, market, dealership_code).
 * @param {string} name - nome del campo
 * @param {*} value - valore ricevuto
 * @returns {string} valore normalizzato (trim)
 */
function validateKey(name, value) {
  // La chiave deve essere una stringa non vuota
  if (typeof value !== 'string' || value.trim() === '') {
    // Chiave mancante o non valida: 400
    throw new HttpError(400, `Parametro obbligatorio mancante o non valido: ${name}`);
  }
  // Rimuove spazi iniziali/finali
  const trimmed = value.trim();
  // Controllo lunghezza massima
  if (trimmed.length > MAX_LEN[name]) {
    // Chiave troppo lunga: 400
    throw new HttpError(400, `Parametro ${name} troppo lungo (max ${MAX_LEN[name]} caratteri)`);
  }
  // Restituisce il valore pulito
  return trimmed;
}

/**
 * Valida un valore email (null ammesso).
 * @param {string} name - nome del campo
 * @param {*} value - valore ricevuto
 * @returns {string|null} email normalizzata oppure null
 */
function validateEmail(name, value) {
  // null o stringa vuota significano "nessuna email"
  if (value === null || value === '') {
    return null;
  }
  // Deve essere una stringa
  if (typeof value !== 'string') {
    throw new HttpError(422, `Campo ${name} non valido: attesa una stringa email o null`);
  }
  // Rimuove spazi
  const trimmed = value.trim();
  // Verifica lunghezza e formato
  if (trimmed.length > MAX_LEN.email || !EMAIL_REGEX.test(trimmed)) {
    throw new HttpError(422, `Campo ${name} non valido: formato email errato o troppo lungo`);
  }
  // Email valida
  return trimmed;
}

/**
 * Verifica che il body sia un oggetto JSON.
 * @param {*} body - body parsato
 * @returns {object} body validato
 */
function ensureObjectBody(body) {
  // Il body deve essere un oggetto non array
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body JSON obbligatorio (oggetto)');
  }
  // Body valido
  return body;
}

/**
 * Estrae e valida i campi di customer_options presenti nel body.
 * @param {object} body - body della richiesta
 * @param {boolean} partial - true per update (campi opzionali), false per insert
 * @returns {object} campi validati
 */
function pickCustomerOptionFields(body, partial) {
  // Oggetto dei campi validati
  const out = {};
  // Scorre i campi booleani ammessi
  for (const field of BOOLEAN_FIELDS) {
    // Campo presente nel body
    if (body[field] !== undefined) {
      // Deve essere un booleano vero
      if (typeof body[field] !== 'boolean') {
        throw new HttpError(422, `Campo ${field} non valido: atteso boolean`);
      }
      // Salva il valore
      out[field] = body[field];
    }
  }
  // In update serve almeno un campo da modificare
  if (partial && Object.keys(out).length === 0) {
    throw new HttpError(400, `Nessun campo da aggiornare. Campi ammessi: ${BOOLEAN_FIELDS.join(', ')}`);
  }
  // Restituisce i campi validati
  return out;
}

/**
 * Estrae e valida i campi email di hq_settings_email presenti nel body.
 * @param {object} body - body della richiesta
 * @param {boolean} partial - true per update (almeno un campo richiesto)
 * @returns {object} campi validati
 */
function pickEmailFields(body, partial) {
  // Oggetto dei campi validati
  const out = {};
  // Scorre i campi email ammessi
  for (const field of EMAIL_FIELDS) {
    // Campo presente nel body (anche null)
    if (body[field] !== undefined) {
      // Valida e normalizza
      out[field] = validateEmail(field, body[field]);
    }
  }
  // In update serve almeno un campo da modificare
  if (partial && Object.keys(out).length === 0) {
    throw new HttpError(400, `Nessun campo da aggiornare. Campi ammessi: ${EMAIL_FIELDS.join(', ')}`);
  }
  // Restituisce i campi validati
  return out;
}

/**
 * Valida limit/offset di paginazione dalla query string.
 * @param {object} query - query string parameters
 * @returns {{limit:number, offset:number}} paginazione validata
 */
function parsePagination(query) {
  // Valori di default
  let limit = 100;
  let offset = 0;
  // Parsing del limit
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    // Deve essere intero tra 1 e 500
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new HttpError(400, 'Parametro limit non valido (intero 1-500)');
    }
  }
  // Parsing dell'offset
  if (query.offset !== undefined) {
    offset = Number(query.offset);
    // Deve essere intero >= 0
    if (!Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'Parametro offset non valido (intero >= 0)');
    }
  }
  // Restituisce la paginazione
  return { limit, offset };
}

// Esporta i validatori
module.exports = {
  validateKey,
  validateEmail,
  ensureObjectBody,
  pickCustomerOptionFields,
  pickEmailFields,
  parsePagination,
  BOOLEAN_FIELDS,
  EMAIL_FIELDS,
};
