'use strict';

/**
 * index.js — Entry point della lambda pkfavorite (Aurora PostgreSQL, tabella PKFAVORITE)
 *
 * Espone due operazioni sulla stessa risorsa (es. /api/pkfavorite):
 *   GET  -> elenca i pacchetti preferiti del dealer per un VIN
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

const { getPool } = require('./db');
const { listFavorites, toggleFavorite } = require('./FavoriteRepository');

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
  const hasAuthorizerContext = !!(event.requestContext && event.requestContext.authorizer);
  if (hasAuthorizerContext) {
    return event.requestContext.authorizer.sub || null;
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
      const favorites = await listFavorites(pool, { username, vin });
      return response(200, { success: true, username, vin, favorites });
    }

    if (method === 'POST') {
      const { vin, packageCode } = body;
      if (!vin || !packageCode) {
        return response(400, { success: false, message: '"vin" e "packageCode" sono obbligatori' });
      }
      const result = await toggleFavorite(pool, { username, vin, packageCode });
      return response(200, { success: true, username, vin, ...result });
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
  const favorites = await listFavorites(pool, { username, vin });
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
