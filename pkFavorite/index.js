'use strict';

/**
 * index.js — Entry point della lambda pkfavorite (Aurora PostgreSQL, tabella PKFAVORITE)
 *
 * Espone due operazioni sulla stessa risorsa (es. /api/pkfavorite):
 *   GET  -> elenca TUTTI i pacchetti preferiti del dealer (ricerca solo per
 *           USERNAME, indipendentemente dal VIN), arricchiti con i dati DML
 *           (Code/PackageDescription/PartsAvailablity/TotalPriceInclTax/
 *           TotalPriceExclTax) relativi al VIN passato in query: per ciascun
 *           codice pacchetto preferito viene effettuata una chiamata al
 *           gateway DML (dms/dmsService::postDmsInquiry, MessageType LFP,
 *           VehicleID=vin, package=codice preferito) e i risultati
 *           (UpSelling.Packages) vengono combinati in un unico elenco piatto.
 *   POST -> crea il preferito se non esiste, altrimenti lo elimina ("toggle"),
 *           salvando sempre username+vin+package (invariato)
 *
 * L'identita' del dealer (colonna USERNAME) arriva SEMPRE da
 * event.requestContext.authorizer.sub (Lambda Authorizer), MAI da un valore
 * fornito dal chiamante (query/body): stessa regola di sicurezza già applicata
 * in session/src/index.js — un client potrebbe altrimenti passare uno username
 * diverso dal proprio e leggere/modificare i preferiti di un altro dealer.
 * Il fallback su body.username è previsto SOLO quando l'evento non ha alcun
 * requestContext.authorizer (invocazione diretta Lambda / CLI di test).
 *
 * Uso CLI:
 *   node index.js list   <username> <vin>
 *   node index.js toggle <username> <vin> <packageCode>
 */

const path = require('path');
const { getPool } = require('./db');
const { listFavorites, toggleFavorite } = require('./FavoriteRepository');

// ── Arricchimento DML (GET) ───────────────────────────────────────────────────

// require lazy (dentro la funzione, non al top-level) come già fatto da
// PkManager.js per dms/authService e dms/dmsService: dms/config.js valida a
// require-time la presenza delle env DMS_PING_CLIENT_ID/SECRET e
// DML_IBM_CLIENT_ID/SECRET, quindi caricare il modulo solo quando serve
// davvero (una GET con almeno un preferito) evita di richiederle per POST o
// per una GET senza preferiti, e permette ai test di mockare i due moduli con
// jest.mock('../dms/...') indipendentemente dalle env reali.
function loadDmsClient() {
  const { getBearerToken } = require(path.resolve(__dirname, '../dms/authService'));
  const { postDmsInquiry } = require(path.resolve(__dirname, '../dms/dmsService'));
  return { getBearerToken, postDmsInquiry };
}

/**
 * Costruisce il Sender dinamico (ApplicationArea.Sender) delle inquiry DMS
 * (MessageType LFP) usate per arricchire i preferiti, tramite lo STESSO
 * meccanismo centralizzato usato anche da jobcard/jobCardService.js
 * ::buildDmsSender e pkManager/PkManager.js::_buildDmsSender:
 * dms/dmsService.js::resolveDynamicSenderFields({ username, vin }, overrides).
 *  - dealerNumberId          <- sessionContext.mainSincom, o (fallback automatico) session.sincom
 *  - serviceId               <- username (già risolto da authorizer.sub)
 *  - languageCode            <- sessionContext.language, o (fallback automatico) session.language
 *  - dealerCountryCode       <- sessionContext.dealerCountryCode, o (fallback automatico) session.marketIso
 *  - brand                   <- sessionContext.brand, o (fallback automatico) v360 getdetails.data.brandCode per il vin
 *  - market                  <- sessionContext.market, o (fallback automatico) session.codmarket (solo chiave di lookup
 *                               woc.ang_snowflakes lato dms, non un campo Sender)
 *
 * componentId/currencyId NON vengono sovrascritti: restano i default statici
 * di dms/config.js. physicalSiteId/dealerNumberIdSource NON vengono risolti
 * qui: il lookup su woc.ang_snowflakes è centralizzato in
 * dms/dmsService.js::buildApplicationArea, che riceve dealerNumberId/market/
 * brand tramite questo stesso sender — pkFavorite non accede direttamente a
 * dbManager.
 *
 * Il **frontend non passa (e non deve passare) mainSincom/market/brand/
 * lingua/country**: resolveSessionContext(body) resta un override
 * opzionale/di test (query string), ma nel flusso reale questi campi sono
 * assenti — vengono quindi risolti automaticamente da
 * resolveDynamicSenderFields usando SOLO lo `username` già autenticato
 * (mainSincom/market/language/dealerCountryCode, tramite
 * session/src/sessionContextCache.js con cache best-effort su
 * /tmp/session-context-<username>.json — utile perché lo stesso username può
 * richiedere l'arricchimento DML di più pacchetti preferiti nella stessa
 * invocazione/istanza Lambda "warm") e il `vin` della richiesta corrente
 * (brand, tramite v360/v360Service.js::getCachedBrand, cache best-effort su
 * /tmp/v360-getdetails-<vin>.json). Se la risoluzione fallisce (username/vin
 * assenti, myPeople/ASV360 irraggiungibili/...) i soli campi mancanti
 * restano non valorizzati — mai un'eccezione che blocchi la GET dei
 * preferiti.
 *
 * @param {object} [sessionContext]
 * @param {string} [sessionContext.mainSincom]
 * @param {string} [sessionContext.market]
 * @param {string} [sessionContext.brand]
 * @param {string} [sessionContext.language]
 * @param {string} [sessionContext.dealerCountryCode]
 * @param {string} [username]
 * @param {string} [vin] - VIN della richiesta corrente, usato per risolvere automaticamente il brand via v360
 * @returns {Promise<object>} sender override da passare a postDmsInquiry(token, { sender, ... })
 */
async function buildDmsSender(sessionContext = {}, username, vin) {
  const { resolveDynamicSenderFields } = require(path.resolve(__dirname, '../dms/dmsService'));
  const { mainSincom, market, brand, language, dealerCountryCode } = await resolveDynamicSenderFields(
    { username, vin },
    sessionContext,
  );

  const sender = {};
  if (mainSincom) sender.dealerNumberId = mainSincom;
  if (username) sender.serviceId = username;
  if (language) sender.languageCode = language;
  if (dealerCountryCode) sender.dealerCountryCode = dealerCountryCode;
  if (brand) sender.brand = brand;
  if (market) sender.market = market;

  return sender;
}


/**
 * Per ciascun codice pacchetto preferito, interroga il gateway DML
 * (MessageType LFP) e ne estrae/combina i soli campi richiesti dal FE:
 * Code, PackageDescription, PartsAvailablity, TotalPriceInclTax, TotalPriceExclTax.
 * Un singolo codice preferito può restituire più voci (UpSelling.Packages può
 * contenere più pacchetti collegati): l'elenco finale è il flatten di tutte
 * le chiamate.
 *
 * @param {string} vin
 * @param {string[]} packageCodes - codici pacchetto preferiti (da PKFAVORITE)
 * @param {object} [sender] - Sender dinamico (vedi buildDmsSender()), passato a
 *                             postDmsInquiry per ciascuna inquiry LFP
 * @returns {Promise<Array<{Code, PackageDescription, PartsAvailablity, TotalPriceInclTax, TotalPriceExclTax}>>}
 */
async function enrichFavoritesWithDms(vin, packageCodes, sender) {
  if (!packageCodes.length) return [];

  const { getBearerToken, postDmsInquiry } = loadDmsClient();
  const token = await getBearerToken();

  const responses = await Promise.all(
    packageCodes.map((packageCode) => postDmsInquiry(token, {
      PartsInquiryHeader: { MessageType: 'LFP', VehicleID: vin },
      package: packageCode,
      sender,
    })),
  );

  return responses.flatMap((dmsResponse) => {
    const packages = (dmsResponse && dmsResponse.UpSelling && dmsResponse.UpSelling.Packages) || [];
    return packages.map(({ Code, PackageDescription, PartsAvailablity, TotalPriceInclTax, TotalPriceExclTax }) => ({
      Code,
      PackageDescription,
      PartsAvailablity,
      TotalPriceInclTax,
      TotalPriceExclTax,
    }));
  });
}

// ── Lambda handler ────────────────────────────────────────────────────────────

/**
 * Determina il metodo HTTP della richiesta, supportando sia API Gateway REST
 * (event.httpMethod) sia HTTP API v2 (event.requestContext.http.method), oltre
 * a un campo "method" esplicito per invocazioni dirette/CLI.
 */
function resolveMethod(event) {
  return (
    event.method
    || event.httpMethod
    || (event.requestContext && event.requestContext.http && event.requestContext.http.method)
    || undefined
  );
}

/**
 * Estrae lo username autenticato. Se l'evento ha un requestContext.authorizer,
 * SOLO authorizer.sub è attendibile (401 se assente). Altrimenti (nessun
 * authorizer nell'evento: invocazione diretta/CLI) si accetta body.username
 * come comodità per i test.
 */
function resolveUsername(event, body) {
  const authz = (event.requestContext && event.requestContext.authorizer) || {};
  if (authz) {
    const sub = authz.sub || null;
    if (!sub) {
        return body.username || null;
    }
    return sub;
  }
  return body.username || null;
}

/**
 * Estrae eventuali override espliciti di dealer/mercato/lingua per il Sender
 * dinamico dell'inquiry DMS (vedi buildDmsSender()), dalla query string della
 * richiesta GET. Il frontend reale NON invia questi parametri: sono un
 * meccanismo di override opzionale (utile per test/debug) — buildDmsSender()
 * risolve automaticamente i campi assenti da session/src/sessionContextCache.js
 * usando solo lo username già autenticato.
 */
function resolveSessionContext(body) {
  return {
    mainSincom: body.mainSincom,
    market: body.market ?? body.codmarket,
    brand: body.brand ?? body.codbrand,
    language: body.language,
    dealerCountryCode: body.dealerCountryCode ?? body.marketIso,
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (_) {
    return {};
  }
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event = {}) => {
  const method = resolveMethod(event);
  const parsedBody = parseBody(event);
  const body = { ...(event.queryStringParameters || {}), ...parsedBody };

  const username = resolveUsername(event, body);
  if (!username) {
    return response(401, {
      success: false,
      message: 'Utente non autenticato: authorizer.sub mancante nella richiesta',
    });
  }

  try {
    const pool = await getPool();

    if (method === 'GET') {
      const { vin } = body;
      if (!vin) {
        return response(400, { success: false, message: '"vin" è obbligatorio' });
      }
      const favoriteRows = await listFavorites(pool, { username });
      const sender = await buildDmsSender(resolveSessionContext(body), username, vin);
      const favorites = await enrichFavoritesWithDms(vin, favoriteRows.map((row) => row.packageCode), sender);
      return response(200, { success: true, username, vin, favorites });
    }

    if (method === 'POST') {
      // Il FE invia il codice pacchetto nel campo "package" (non "packageCode").
      const { vin, package: packageCode } = body;
      if (!vin || !packageCode) {
        return response(400, { success: false, message: '"vin" e "package" sono obbligatori' });
      }
      const { action, id, createdAt } = await toggleFavorite(pool, { username, vin, packageCode });
      return response(200, { success: true, username, vin, package: packageCode, action, id, createdAt });
    }

    return response(405, {
      success: false,
      message: `Metodo non supportato: "${method}". Metodi validi: GET, POST`,
    });
  } catch (err) {
    const statusCode = err.message.includes('is required') ? 400 : 502;
    return response(statusCode, { success: false, message: err.message });
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

async function runList(username, vin) {
  console.log('\n=== PkFavorite List ===');
  const pool = await getPool();
  const favoriteRows = await listFavorites(pool, { username });
  const favorites = await enrichFavoritesWithDms(vin, favoriteRows.map((row) => row.packageCode));
  console.log(JSON.stringify({ success: true, username, vin, favorites }, null, 2));
  return favorites;
}

async function runToggle(username, vin, packageCode) {
  console.log('\n=== PkFavorite Toggle ===');
  const pool = await getPool();
  const result = await toggleFavorite(pool, { username, vin, packageCode });
  console.log(JSON.stringify({ success: true, username, vin, ...result }, null, 2));
  return result;
}

async function main() {
  const [, , command, username, vinOrPackage, packageCode] = process.argv;

  try {
    if (command === 'list') {
      await runList(username, vinOrPackage);
    } else if (command === 'toggle') {
      await runToggle(username, vinOrPackage, packageCode);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js list   <username> <vin>');
      console.error('  node index.js toggle <username> <vin> <packageCode>');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
