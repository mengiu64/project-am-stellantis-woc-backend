'use strict';

require('dotenv').config();

const { buildRepository, buildMyPeopleDmsRepository } = require('./repositoryFactory');

const DEFAULT_MARKET = process.env.SESSION_DEFAULT_MARKET || '1000';

/**
 * Handler compatibile con AWS Lambda (event, context) -> risposta HTTP-like.
 * Puo' essere usato direttamente come entry point di una funzione Lambda
 * (es. dietro API Gateway) oppure richiamato da altri moduli.
 *
 * Bivio in base al parametro di input:
 *  - se viene passato `username` (IURSMA), i dati di sessione sono ricavati
 *    "al volo" chiamando prima myPeople (readUserProfiles) e poi dms/settings
 *    con i dati ottenuti (mercato/dealer/brand) — vedi MyPeopleDmsSessionRepository;
 *  - altrimenti si usa il comportamento storico: il mercato (`codmarket`, 4
 *    caratteri, es. "1000") viene letto da S3 (S3SessionRepository). Se non
 *    viene passato nessuno dei due, si usa il mercato di default ("1000").
 *
 * Entrambi i parametri possono arrivare da:
 *  - event.pathParameters.{codmarket|username} (es. rotta /session/{codmarket})
 *  - event.queryStringParameters.{codmarket|username} (es. ?codmarket=1000 / ?username=...)
 *  - event.criteria.{codmarket|username} (invocazione diretta, utile per test)
 *
 * @param {object} [event] - Evento Lambda.
 * @returns {Promise<object>} { statusCode, body }
 */
async function handler(event = {}) {
  const criteria = resolveCriteria(event);

  try {
    if (criteria.username) {
      const repository = buildMyPeopleDmsRepository();
      const data = await repository.getSessionData(criteria.username);
      return response(200, data);
    }

    const codmarket = criteria.codmarket || DEFAULT_MARKET;
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
 * Risolve { codmarket, username } dall'evento, con priorita':
 * event.criteria > event.queryStringParameters > event.pathParameters.
 * Se `username` e' presente, ha la precedenza su `codmarket` (vedi handler).
 */
function resolveCriteria(event) {
  const criteria = {
    ...(event.queryStringParameters || {}),
    ...(event.criteria || {}),
  };
  if (!criteria.codmarket && event.pathParameters && event.pathParameters.codmarket) {
    criteria.codmarket = event.pathParameters.codmarket;
  }
  if (!criteria.username && event.pathParameters && event.pathParameters.username) {
    criteria.username = event.pathParameters.username;
  }
  return criteria;
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
 * Esecuzione da riga di comando:
 *   node src/index.js [codmarket]              -> comportamento storico (S3)
 *   node src/index.js --username <username>    -> myPeople + dms/settings
 * Se omesso il codmarket, viene usato il mercato di default ("1000").
 * Esempi:
 *   node src/index.js                       -> mercato di default (1000)
 *   node src/index.js 3109                  -> mercato 3109
 *   node src/index.js --username 0073741.d235
 *
 * @param {string[]} [argv] - Argomenti da riga di comando (default: process.argv).
 * @returns {Promise<object|void>} I dati di sessione stampati, oppure undefined in caso di errore.
 */
async function runCli(argv = process.argv) {
  const args = argv.slice(2);
  const usernameIdx = args.indexOf('--username');

  try {
    if (usernameIdx !== -1) {
      const username = args[usernameIdx + 1];
      if (!username) {
        console.error('[session] Errore: --username richiede un valore');
        process.exitCode = 1;
        return;
      }
      const repository = buildMyPeopleDmsRepository();
      const data = await repository.getSessionData(username);
      console.log(JSON.stringify(data, null, 2));
      return data;
    }

    const [codmarket = DEFAULT_MARKET] = args;
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
