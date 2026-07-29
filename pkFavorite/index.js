'use strict';

/**
 * index.js — Entry point della lambda pkfavorite (Aurora PostgreSQL, tabella PKFAVORITE)
 *
 * Espone due operazioni sulla stessa risorsa (es. /api/pkfavorite):
 *   GET  -> elenca i pacchetti preferiti del dealer per un VIN, arricchiti con i
 *           dati DML (Code/PackageDescription/PartsAvailablity/TotalPriceInclTax/
 *           TotalPriceExclTax): per ciascun codice pacchetto preferito viene
 *           effettuata una chiamata al gateway DML (dms/dmsService::postDmsInquiry,
 *           MessageType LFP, VehicleID=vin, package=codice preferito) e i risultati
 *           (UpSelling.Packages) vengono combinati in un unico elenco piatto.
 *   POST -> crea il preferito se non esiste, altrimenti lo elimina ("toggle")
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
 * Per ciascun codice pacchetto preferito, interroga il gateway DML
 * (MessageType LFP) e ne estrae/combina i soli campi richiesti dal FE:
 * Code, PackageDescription, PartsAvailablity, TotalPriceInclTax, TotalPriceExclTax.
 * Un singolo codice preferito può restituire più voci (UpSelling.Packages può
 * contenere più pacchetti collegati): l'elenco finale è il flatten di tutte
 * le chiamate.
 *
 * @param {string} vin
 * @param {string[]} packageCodes - codici pacchetto preferiti (da PKFAVORITE)
 * @returns {Promise<Array<{Code, PackageDescription, PartsAvailablity, TotalPriceInclTax, TotalPriceExclTax}>>}
 */
async function enrichFavoritesWithDms(vin, packageCodes) {
  if (!packageCodes.length) return [];

  const { getBearerToken, postDmsInquiry } = loadDmsClient();
  const token = await getBearerToken();

  const responses = await Promise.all(
    packageCodes.map((packageCode) => postDmsInquiry(token, {
      PartsInquiryHeader: { MessageType: 'LFP', VehicleID: vin },
      package: packageCode,
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
      const favoriteRows = await listFavorites(pool, { username, vin });
      const favorites = await enrichFavoritesWithDms(vin, favoriteRows.map((row) => row.packageCode));
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
  const favoriteRows = await listFavorites(pool, { username, vin });
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
