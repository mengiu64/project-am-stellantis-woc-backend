'use strict';

/**
 * index.js — Entry point (wyz)
 *
 * Wrapper REST verso il servizio esterno "Wyz – Tyre search". Espone 2 azioni:
 *  - getSearchFilters : chiama vehicle-brands, vehicle-types, brands e seasons e restituisce
 *                       i riferimenti dei filtri già normalizzati per il front-end
 *  - searchQuote      : chiama POST /api/tyres/search/quote
 *
 * L'azione è l'ultimo segmento del path (API Gateway proxy, es. /api/wyz/searchQuote)
 * oppure event.action (invocazione diretta).
 *
 * Esempio input getSearchFilters (query string o body JSON):
 *   { "customerRrdiCode": "S2S001", "hubCode": "HUB01" }
 *
 * Esempio input searchQuote (body JSON):
 *   { "customerRrdiCode": "S2S001", "hubCode": "HUB01", "width": 205, "height": 55, "diameter": 16,
 *     "quantity": 2, "vehicleTypes": ["<uuid>"], "vehicleBrands": ["<uuid>"],
 *     "seasons": ["<uuid>"], "brands": ["<uuid>"], "speedIndexes": ["H"], "loadIndexes": [91] }
 *
 * Uso CLI:
 *   node index.js getSearchFilters <payloadJsonFile>
 *   node index.js searchQuote      <payloadJsonFile>
 */

const fs = require('fs');
const { randomUUID } = require('crypto');
const { getSearchFilters, searchQuote, WyzError } = require('./wyzService');

// Azioni supportate → funzione di servizio
const ACTIONS = {
  getSearchFilters, // Metodo 1: riferimenti filtri (4 chiamate Wyz)
  searchQuote, // Metodo 2: ricerca preventivi pneumatici
};
const VALID_ACTIONS = Object.keys(ACTIONS);

/**
 * Risolve azione e input dall'evento (direct invoke o API Gateway proxy).
 * Il body ha priorità sulla query string.
 * @param {object} event
 * @returns {{action: string|undefined, body: object}}
 */
function resolveActionAndBody(event) {
  // Priorità 1: event.action (direct invoke)
  let action = event.action;

  // Priorità 2: ultimo segmento del path (API Gateway proxy)
  if (!action) {
    const rawPath = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
    const segments = String(rawPath).split('/').filter(Boolean);
    action = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;
  }

  let parsedBody = {};
  if (event.body) {
    // Un body non-JSON è un errore del chiamante: viene segnalato (400) invece di essere ignorato
    parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  }

  const body = { ...(event.queryStringParameters || {}), ...(parsedBody || {}) };
  return { action, body };
}

/**
 * Costruisce la risposta proxy API Gateway.
 * @param {number} statusCode
 * @param {object} payload
 */
function buildResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  const ev = event || {};
  // Si logga solo un riepilogo: niente header/cookie/authorizer (dati sensibili)
  console.log(`[handler] Richiesta ricevuta: ${ev.httpMethod || ev.requestContext?.http?.method || 'direct'} ${ev.path || ev.rawPath || ''}`);

  // Correlation id per tracciare la richiesta sul servizio Wyz e nei log
  const correlationId = (ev.requestContext && ev.requestContext.requestId) || randomUUID();

  let action;
  let body;
  try {
    ({ action, body } = resolveActionAndBody(ev));
  } catch (err) {
    console.error(`[handler] ERRORE: body non è un JSON valido (${err.message})`);
    return buildResponse(400, { success: false, message: 'Request body is not valid JSON' });
  }
  console.log(`[handler] Azione risolta: "${action}" (correlationId=${correlationId})`);

  // Valida che l'azione sia tra quelle supportate
  if (!action || !VALID_ACTIONS.includes(action)) {
    console.error(`[handler] ERRORE: azione sconosciuta "${action}". Valide: ${VALID_ACTIONS.join(', ')}`);
    return buildResponse(400, {
      success: false,
      message: `Unknown action: "${action}". Valid actions: ${VALID_ACTIONS.join(', ')}`,
    });
  }

  try {
    const payload = body.payload ?? body;
    const result = await ACTIONS[action](payload, { correlationId });
    console.log(`[handler] Azione "${action}" completata con successo`);

    // getSearchFilters restituisce già { filters }; searchQuote restituisce il contenuto di "data"
    const responseBody = action === 'getSearchFilters' ? { success: true, ...result } : { success: true, data: result };
    return buildResponse(200, responseBody);
  } catch (err) {
    if (err instanceof WyzError) {
      console.error(`[handler] ERRORE durante "${action}": [${err.statusCode}] ${err.message}`);
      return buildResponse(err.statusCode, {
        success: false,
        message: err.message,
        ...(err.errorCode ? { errorCode: err.errorCode } : {}),
        ...(err.contextCode ? { contextCode: err.contextCode } : {}),
        ...(err.details ? { details: err.details } : {}),
      });
    }
    // Eccezione imprevista: dettagli solo nei log, messaggio generico al client
    console.error(`[handler] ERRORE imprevisto durante "${action}": ${err.stack || err.message}`);
    return buildResponse(500, { success: false, message: 'Internal server error' });
  }
};

// ── CLI (test/debug locale) ──────────────────────────────────────────

/**
 * Esegue un'azione leggendo il payload da file JSON.
 * @param {string} action
 * @param {string} payloadJsonFile
 */
async function runAction(action, payloadJsonFile) {
  console.log(`\n=== Wyz: ${action} ===`);
  const payload = JSON.parse(fs.readFileSync(payloadJsonFile, 'utf8'));
  const result = await ACTIONS[action](payload, { correlationId: randomUUID() });
  console.log('[CLI] Risultato:', JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, param] = process.argv;
  try {
    if (!VALID_ACTIONS.includes(command)) {
      console.error('[ERROR] Comando non valido. Usa:');
      VALID_ACTIONS.forEach((a) => console.error(`  node index.js ${a} <payloadJsonFile>`));
      process.exit(1);
    }
    if (!param) {
      console.error('[ERROR] È richiesto il path del file JSON con il payload.');
      process.exit(1);
    }
    await runAction(command, param);
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

// Avvia la CLI solo se eseguito direttamente
if (require.main === module) {
  main();
}

exports.resolveActionAndBody = resolveActionAndBody;
exports.runAction = runAction;
exports.main = main;
