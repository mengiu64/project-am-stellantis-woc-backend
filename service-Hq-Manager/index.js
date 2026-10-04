'use strict';

/**
 * index.js — Lambda service-Hq-Manager
 *
 * API REST (API Gateway proxy) per la gestione dei settings HQ (WOC-201):
 *   /customer-options[/{oic_code}]                          -> woc.customer_options
 *   /hq-settings-email[/{market}/{dealership_code}/{oic_code}] -> woc.hq_settings_email
 * Verbi: GET (lista/singolo), POST (insert), PUT (update), DELETE.
 * L'autenticazione è a carico della piattaforma (Lambda Authorizer): qui non si valida
 * nessun token e non si usano mai 401/403 (riservati al re-login dell'SPA).
 */

// Pool Aurora condiviso (RDS Proxy)
const { getPool } = require('./shared/dbClient');
// Errore applicativo con status HTTP
const { HttpError } = require('./errors');
// Validatori di input
const v = require('./validation');
// Accesso ai dati
const repo = require('./repository');

// Segmento di path che identifica la risorsa customer_options
const RES_CUSTOMER_OPTIONS = 'customer-options';
// Segmento di path che identifica la risorsa hq_settings_email
const RES_HQ_EMAIL = 'hq-settings-email';

/**
 * Log strutturato JSON (mai dati sensibili).
 * @param {string} level - info | warn | error
 * @param {string} awsRequestId - id richiesta Lambda
 * @param {object} data - dati aggiuntivi
 */
function log(level, awsRequestId, data) {
  // Scrive una riga JSON su CloudWatch
  console.log(JSON.stringify({ level, awsRequestId, ...data }));
}

/**
 * Costruisce la risposta API Gateway proxy.
 * @param {number} statusCode - codice HTTP
 * @param {object} body - corpo serializzato in JSON
 */
function buildResponse(statusCode, body) {
  // Risposta nel formato proxy con header JSON
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * Estrae il metodo HTTP (REST v1 o HTTP API v2).
 * @param {object} event - evento API Gateway
 */
function getMethod(event) {
  // Metodo da httpMethod (v1) oppure requestContext.http.method (v2)
  const m = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || '';
  // Normalizzato in maiuscolo
  return String(m).toUpperCase();
}

/**
 * Risolve risorsa e segmenti chiave dal path.
 * @param {object} event - evento API Gateway
 * @returns {{resource:string|undefined, segments:string[]}} risorsa e segmenti successivi
 */
function resolveRoute(event) {
  // Path grezzo (può contenere stage o prefisso /api)
  const rawPath = event.rawPath || event.path || '';
  // Segmenti non vuoti e decodificati
  const parts = String(rawPath).split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  // Cerca il segmento di risorsa noto
  const idx = parts.findIndex((p) => p === RES_CUSTOMER_OPTIONS || p === RES_HQ_EMAIL);
  // Risorsa sconosciuta
  if (idx === -1) {
    return { resource: undefined, segments: [] };
  }
  // Risorsa e segmenti che seguono
  return { resource: parts[idx], segments: parts.slice(idx + 1) };
}

/**
 * Parsa il body JSON (400 se malformato).
 * @param {object} event - evento API Gateway
 * @returns {object|undefined} body parsato (undefined se assente)
 */
function parseBody(event) {
  // Nessun body presente
  if (event.body === undefined || event.body === null || event.body === '') {
    return undefined;
  }
  // Già oggetto (invocazioni di test)
  if (typeof event.body === 'object') {
    return event.body;
  }
  // Decodifica base64 se richiesto dal gateway
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    // Parsing JSON
    return JSON.parse(raw);
  } catch (_) {
    // JSON non valido
    throw new HttpError(400, 'Body non è un JSON valido');
  }
}

/**
 * Costruisce la chiave composita di hq_settings_email da path, query o body.
 * @param {string[]} segments - segmenti path dopo la risorsa
 * @param {object} query - query string
 * @param {object} body - body (può essere vuoto)
 */
function buildEmailKey(segments, query, body) {
  // Valore da path -> query -> body, in ordine di priorità
  const pick = (i, name) => (segments[i] !== undefined ? segments[i] : (query[name] !== undefined ? query[name] : body[name]));
  // Chiave validata (400 se mancante o non valida)
  return {
    market: v.validateKey('market', pick(0, 'market')),
    dealership_code: v.validateKey('dealership_code', pick(1, 'dealership_code')),
    oic_code: v.validateKey('oic_code', pick(2, 'oic_code')),
  };
}

/**
 * Gestisce le operazioni su customer_options.
 */
async function handleCustomerOptions(pool, method, segments, query, body) {
  // oic_code da path, query o body
  const rawKey = segments[0] !== undefined ? segments[0] : (query.oic_code !== undefined ? query.oic_code : body.oic_code);
  // GET
  if (method === 'GET') {
    // Senza chiave: lista paginata
    if (rawKey === undefined) {
      return { status: 200, payload: { success: true, data: await repo.listCustomerOptions(pool, v.parsePagination(query)) } };
    }
    // Con chiave: singolo record
    const row = await repo.getCustomerOption(pool, v.validateKey('oic_code', rawKey));
    // Non trovato: 404
    if (!row) throw new HttpError(404, 'customer_options non trovato');
    return { status: 200, payload: { success: true, data: row } };
  }
  // POST: crea
  if (method === 'POST') {
    // Valida chiave e campi
    const row = await repo.insertCustomerOption(pool, v.validateKey('oic_code', rawKey), v.pickCustomerOptionFields(body, false));
    return { status: 201, payload: { success: true, data: row } };
  }
  // PUT: aggiorna
  if (method === 'PUT') {
    // Valida chiave e campi (almeno uno)
    const key = v.validateKey('oic_code', rawKey);
    const row = await repo.updateCustomerOption(pool, key, v.pickCustomerOptionFields(body, true));
    // Non trovato: 404
    if (!row) throw new HttpError(404, 'customer_options non trovato');
    return { status: 200, payload: { success: true, data: row } };
  }
  // DELETE: elimina
  const key = v.validateKey('oic_code', rawKey);
  // Esegue la cancellazione
  const deleted = await repo.deleteCustomerOption(pool, key);
  // Non trovato: 404
  if (!deleted) throw new HttpError(404, 'customer_options non trovato');
  return { status: 200, payload: { success: true, message: 'customer_options eliminato' } };
}

/**
 * Gestisce le operazioni su hq_settings_email.
 */
async function handleHqEmail(pool, method, segments, query, body) {
  // GET
  if (method === 'GET') {
    // Con chiave completa nel path: singolo record
    if (segments.length > 0) {
      const row = await repo.getHqSettingsEmail(pool, buildEmailKey(segments, query, body));
      // Non trovato: 404
      if (!row) throw new HttpError(404, 'hq_settings_email non trovato');
      return { status: 200, payload: { success: true, data: row } };
    }
    // Altrimenti lista con filtri opzionali da query string
    const filters = {};
    // Valida i filtri forniti
    for (const f of ['market', 'dealership_code', 'oic_code']) {
      if (query[f] !== undefined) filters[f] = v.validateKey(f, query[f]);
    }
    return { status: 200, payload: { success: true, data: await repo.listHqSettingsEmail(pool, filters, v.parsePagination(query)) } };
  }
  // Chiave composita obbligatoria per POST/PUT/DELETE
  const key = buildEmailKey(segments, query, body);
  // POST: crea
  if (method === 'POST') {
    const row = await repo.insertHqSettingsEmail(pool, key, v.pickEmailFields(body, false));
    return { status: 201, payload: { success: true, data: row } };
  }
  // PUT: aggiorna
  if (method === 'PUT') {
    const row = await repo.updateHqSettingsEmail(pool, key, v.pickEmailFields(body, true));
    // Non trovato: 404
    if (!row) throw new HttpError(404, 'hq_settings_email non trovato');
    return { status: 200, payload: { success: true, data: row } };
  }
  // DELETE: elimina
  const deleted = await repo.deleteHqSettingsEmail(pool, key);
  // Non trovato: 404
  if (!deleted) throw new HttpError(404, 'hq_settings_email non trovato');
  return { status: 200, payload: { success: true, message: 'hq_settings_email eliminato' } };
}

/**
 * Handler principale.
 * @param {object} event - evento API Gateway proxy
 * @param {object} context - contesto Lambda
 */
exports.handler = async (event, context) => {
  // Id richiesta per correlazione log
  const awsRequestId = (context && context.awsRequestId) || 'n/a';
  try {
    // Metodo e route
    const method = getMethod(event || {});
    const { resource, segments } = resolveRoute(event || {});
    // Identità (solo per audit nei log): fornita dal Lambda Authorizer
    const sub = event && event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.sub;
    // Log di ingresso
    log('info', awsRequestId, { operation: 'handler', message: 'Richiesta ricevuta', method, resource: resource || null, sub: sub || null });

    // Risorsa non riconosciuta: 404
    if (!resource) {
      throw new HttpError(404, 'Risorsa non trovata. Risorse valide: customer-options, hq-settings-email');
    }
    // Metodo non supportato: 405
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw new HttpError(405, `Metodo non supportato: ${method}`);
    }

    // Query string e body (obbligatorio per POST/PUT)
    const query = event.queryStringParameters || {};
    const parsed = parseBody(event);
    // Body assente ammesso solo per GET/DELETE
    if ((method === 'POST' || method === 'PUT') && parsed === undefined) {
      throw new HttpError(400, 'Body JSON obbligatorio');
    }
    // Validazione tipo body se presente
    const body = parsed === undefined ? {} : v.ensureObjectBody(parsed);

    // Connessione al DB (pool riutilizzato tra invocazioni)
    const pool = await getPool();
    // Dispatch in base alla risorsa
    const result = resource === RES_CUSTOMER_OPTIONS
      ? await handleCustomerOptions(pool, method, segments, query, body)
      : await handleHqEmail(pool, method, segments, query, body);

    // Log di esito
    log('info', awsRequestId, { operation: 'handler', message: 'Richiesta completata', method, resource, statusCode: result.status });
    // Risposta di successo
    return buildResponse(result.status, result.payload);
  } catch (err) {
    // Errore applicativo noto: 4xx con messaggio
    if (err instanceof HttpError) {
      log('warn', awsRequestId, { operation: 'handler', message: err.message, statusCode: err.statusCode });
      return buildResponse(err.statusCode, { success: false, message: err.message });
    }
    // Errore tecnico (DB, rete, ...): 500 senza dettagli interni
    log('error', awsRequestId, { operation: 'handler', message: 'Errore interno', error: err && err.message, code: err && err.code });
    return buildResponse(500, { success: false, message: 'Errore interno del server' });
  }
};
