'use strict';

/**
 * Central Lambda entry-point — usabile anche da riga di comando.
 *
 * Come Lambda dispatcher (event.action) o via API Gateway proxy:
 *   { "action": "translations", "queryStringParameters": { "lang": "en" } }
 *   GET /translations?lang=en
 *
 * Da riga di comando:
 *   node index.js translations lang=en
 */

require('dotenv').config();

const handlers = {
  translations: require('./src/handlers/translations'),
};

// ── Lambda handler ────────────────────────────────────────────────────────────

/**
 * Resolves the action name from either a direct invocation payload ({ action: "..." }),
 * a real API Gateway (REST API or HTTP API) proxy integration event — taking the last
 * path segment (e.g. .../api/translations -> "translations") — or, as a last resort,
 * falls back to "translations" (unica azione esposta da questa Lambda).
 */
function resolveAction(event) {
  if (event.action) return event.action;

  const rawPath = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy);
  if (rawPath) {
    const segments = String(rawPath).split('/').filter(Boolean);
    if (segments.length) return decodeURIComponent(segments[segments.length - 1]);
  }

  return 'translations';
}

exports.handler = async (event, context) => {
  const action = resolveAction(event);

  if (!handlers[action]) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: `Unknown action: "${action}". Valid actions: ${Object.keys(handlers).join(', ')}`,
      }),
    };
  }

  return handlers[action].handler(event, context);
};

// ── CLI ───────────────────────────────────────────────────────────────────────

/**
 * Parses extra CLI args in the form key=value into an object.
 */
function parseKvArgs(args) {
  const result = {};
  for (const arg of args) {
    const idx = arg.indexOf('=');
    if (idx === -1) continue;
    const key = arg.slice(0, idx).trim();
    const raw = arg.slice(idx + 1).trim();
    result[key] = raw;
  }
  return result;
}

async function cliMain() {
  const [, , action, ...rest] = process.argv;

  const validActions = Object.keys(handlers);

  if (!action || !validActions.includes(action)) {
    console.error('[ERROR] Azione non valida. Usa:');
    console.error('  node index.js translations lang=en');
    process.exit(1);
    return;
  }

  const params = parseKvArgs(rest);
  const event  = { action, params };

  console.log(`\n=== Translations — ${action} ===`);

  try {
    const res  = await exports.handler(event);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    console.log(JSON.stringify(body, null, 2));
    if (res.statusCode >= 400) process.exit(1);
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

// Exported for unit-testing the CLI logic
module.exports._parseKvArgs = parseKvArgs;
module.exports._cliMain     = cliMain;

if (require.main === module) {
  cliMain();
}
