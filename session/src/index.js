'use strict';

require('dotenv').config();

const { buildRepository } = require('./repositoryFactory');

const DEFAULT_MARKET = process.env.SESSION_DEFAULT_MARKET || '1000';

/**
 * Handler compatibile con AWS Lambda (event, context) -> risposta HTTP-like.
 * Puo' essere usato direttamente come entry point di una funzione Lambda
 * (es. dietro API Gateway) oppure richiamato da altri moduli.
 *
 * Il mercato (codmarket, 4 caratteri, es. "1000") e' l'unico parametro di
 * input e puo' arrivare da:
 *  - event.pathParameters.codmarket (es. rotta /session/{codmarket})
 *  - event.queryStringParameters.codmarket (es. ?codmarket=1000)
 *  - event.criteria.codmarket (invocazione diretta, utile per test)
 * Se assente, viene usato il mercato di default ("1000").
 *
 * @param {object} [event] - Evento Lambda.
 * @returns {Promise<object>} { statusCode, body }
 */
async function handler(event = {}) {
  const codmarket = resolveMarket(event);

  try {
    const repository = buildRepository();
    const data = await repository.getSessionData(codmarket);
    return response(200, data);
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      return response(404, { success: false, message: err.message });
    }
    return response(502, { success: false, message: err.message ?? String(err) });
  }
}

/**
 * Risolve il codmarket dall'evento, con priorita':
 * event.criteria > event.queryStringParameters > event.pathParameters > default.
 */
function resolveMarket(event) {
  const criteria = {
    ...(event.queryStringParameters || {}),
    ...(event.criteria || {}),
  };
  if (!criteria.codmarket && event.pathParameters && event.pathParameters.codmarket) {
    criteria.codmarket = event.pathParameters.codmarket;
  }
  return criteria.codmarket || DEFAULT_MARKET;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

/**
 * Logica CLI, estratta in una funzione per poter essere testata direttamente
 * (senza dipendere da `require.main === module`).
 * Esecuzione da riga di comando: `node src/index.js [codmarket]`.
 * Se omesso, viene usato il mercato di default ("1000").
 * Esempi:
 *   node src/index.js         -> mercato di default (1000)
 *   node src/index.js 3109    -> mercato 3109
 *
 * @param {string[]} [argv] - Argomenti da riga di comando (default: process.argv).
 * @returns {Promise<object|void>} I dati di sessione stampati, oppure undefined in caso di errore.
 */
async function runCli(argv = process.argv) {
  const [, , codmarket = DEFAULT_MARKET] = argv;

  try {
    const repository = buildRepository();
    const data = await repository.getSessionData(codmarket);
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.error(`[session] Errore: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = { handler, runCli, DEFAULT_MARKET };
