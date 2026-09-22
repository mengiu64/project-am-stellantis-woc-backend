'use strict';

require('dotenv').config();

const { buildRepository, buildMyPeopleDmsRepository } = require('./repositoryFactory');

const DEFAULT_MARKET = process.env.SESSION_DEFAULT_MARKET || '1000';

/**
 * Handler compatibile con AWS Lambda (event, context) -> risposta HTTP-like.
 * Entry point di una funzione Lambda dietro API Gateway (REST proxy integration),
 * protetta da un Lambda Authorizer (lmb-np-bsn0027990-<env>-authorizer).
 *
 * L'identita' dell'utente arriva SEMPRE da event.requestContext.authorizer (mai da
 * query/path/body param passati dal client, che NON sono attendibili ai fini
 * dell'identita': un client potrebbe passare uno username diverso dal proprio e
 * leggere i dati di sessione di un altro utente). Lo `username` IURSMA da usare per
 * il flusso myPeople -> dms/settings (vedi MyPeopleDmsSessionRepository) e' quindi
 * sempre `authorizer.sub`, mai un valore fornito dal chiamante.
 *
 * Se l'authorizer non ha valorizzato `sub` (richiesta non autenticata / authorizer
 * non configurato), la Lambda risponde 401 senza interrogare alcun repository.
 *
 * @param {object} [event] - Evento Lambda (API Gateway proxy).
 * @returns {Promise<object>} { statusCode, body }
 */
async function handler(event = {}) {
  const { sub, roles, profile } = getAuthContext(event);

  if (!sub) {
    return response(401, {
      success: false,
      message: 'Utente non autenticato: authorizer.sub mancante nella richiesta',
    });
  }

  try {
    const repository = buildMyPeopleDmsRepository();
    // `profile` (parsato da authorizer.profile, v. getAuthContext) viene passato
    // solo per valorizzare firstname/lastname degli utenti HQ (given_name/family_name),
    // che altrimenti resterebbero null: v. MyPeopleDmsSessionRepository::buildHqSessionData.
    const data = await repository.getSessionData(sub, profile);
    // `userroles` (array) e' il ruolo/i ruoli dell'utente autenticato, presi
    // SEMPRE da event.requestContext.authorizer.roles (Lambda Authorizer, gia'
    // estratto da getAuthContext), mai da myPeople/dms: stesso principio di
    // "identita' solo dall'authorizer" gia' applicato a `sub`.
    // `hqCentral`/`hqMarket`/`dealer` (0/1) sono derivati dagli stessi `roles`,
    // vedi resolveRoleFlags().
    return response(200, insertAfterProfile(data, roles));
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      return response(404, { success: false, message: err.message });
    }
    return response(502, { success: false, message: err.message ?? String(err) });
  }
}

/**
 * Estrae l'identita' autenticata dal contesto valorizzato dal Lambda Authorizer
 * (lmb-np-bsn0027990-<env>-authorizer) in event.requestContext.authorizer:
 *  - sub     -> id utente stabile (username IURSMA, es. "0073741.d235")
 *  - roles   -> stringa CSV (es. "dealer,advisor"), qui esposta gia' come array
 *  - profile -> JSON string col profilo canonico (stessa forma di GET /auth/user-info:
 *               sub, given_name, family_name, name, email, locale, country, roles[],
 *               dealer_code, dealer_name, brand, region_code, ...), parsato se presente
 *
 * L'autorizzazione applicativa (chi puo' fare cosa in base a roles/profile) resta
 * a carico del chiamante di questa funzione; qui ci si limita a estrarre i dati.
 *
 * @param {object} event - Evento Lambda (API Gateway proxy).
 * @returns {{ sub: string|null, roles: string[], profile: object|null }}
 */
function getAuthContext(event) {
  const authz = (event.requestContext && event.requestContext.authorizer) || {};

  const sub = authz.sub || null;

  const roles = typeof authz.roles === 'string' && authz.roles.trim() !== ''
    ? authz.roles.split(',').map((role) => role.trim()).filter(Boolean)
    : [];

  let profile = null;
  if (authz.profile) {
    try {
      profile = JSON.parse(authz.profile);
    } catch (err) {
      profile = null;
    }
  }

  return { sub, roles, profile };
}

// Pattern (case-insensitive) per il ruolo "HQ centrale" es. "WRT.WOC.NONPROD.HQCENTRAL"
// (prefisso "Z" e ambiente NONPROD/PROD variabili, si cerca solo la sottostringa).
const HQ_CENTRAL_ROLE_PATTERN = /HQCENTRAL/i;
// Pattern per il ruolo "HQ mercato" es. "ZWRT.WOC.NONPROD.HQNSC3109": "HQNSC" seguito
// dalle 4 cifre del codice mercato (variabili in base al mercato dell'utente HQ).
const HQ_MARKET_ROLE_PATTERN = /HQNSC\d{4}/i;

/**
 * Deriva i 3 flag 0/1 `hqCentral`/`hqMarket`/`dealer` dai ruoli dell'utente
 * (`userroles`, gia' estratti da getAuthContext). Un solo flag e' valorizzato
 * a 1 per volta, con priorita' hqCentral > hqMarket > dealer: se nessun ruolo
 * corrisponde ai pattern HQ, l'utente e' considerato un dealer (default).
 *
 * @param {string[]} roles - Ruoli dell'utente autenticato.
 * @returns {{ hqCentral: 0|1, hqMarket: 0|1, dealer: 0|1 }}
 */
function resolveRoleFlags(roles) {
  const list = Array.isArray(roles) ? roles : [];

  const isHqCentral = list.some((role) => typeof role === 'string' && HQ_CENTRAL_ROLE_PATTERN.test(role));
  const isHqMarket = !isHqCentral
    && list.some((role) => typeof role === 'string' && HQ_MARKET_ROLE_PATTERN.test(role));
  const isDealer = !isHqCentral && !isHqMarket;

  return {
    hqCentral: isHqCentral ? 1 : 0,
    hqMarket: isHqMarket ? 1 : 0,
    dealer: isDealer ? 1 : 0,
  };
}

/**
 * Inserisce, subito dopo `profile`, i campi `hqCentral`/`hqMarket`/`dealer`
 * (derivati da `roles` via resolveRoleFlags()) seguiti da `userroles`,
 * nell'oggetto dati di sessione (stesso ordine di chiavi atteso nel JSON di
 * risposta), senza mutare l'oggetto originale. Se `profile` non e' presente
 * (fallback difensivo, non dovrebbe verificarsi con l'attuale
 * MyPeopleDmsSessionRepository), tutti questi campi vengono semplicemente
 * accodati in fondo.
 *
 * @param {object} data - Dati di sessione restituiti dal repository.
 * @param {string[]} roles - Ruoli dell'utente autenticato (da getAuthContext).
 * @returns {object} Copia di `data` con i nuovi campi inseriti dopo `profile`.
 */
function insertAfterProfile(data, roles) {
  const entries = Object.entries(data || {});
  const profileIndex = entries.findIndex(([key]) => key === 'profile');
  const insertAt = profileIndex === -1 ? entries.length : profileIndex + 1;
  const { hqCentral, hqMarket, dealer } = resolveRoleFlags(roles);
  entries.splice(
    insertAt,
    0,
    ['hqCentral', hqCentral],
    ['hqMarket', hqMarket],
    ['dealer', dealer],
    ['userroles', roles],
  );
  return Object.fromEntries(entries);
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

module.exports = { handler, runCli, DEFAULT_MARKET, getAuthContext, resolveRoleFlags };
