'use strict';

/**
 * Central Lambda entry-point for NAGA appointment operations — usabile anche da riga di comando.
 *
 * Come Lambda dispatcher (event.action):
 *   { "action": "createnaga"|"updatenaga", "body": "{ ... }" }
 *
 * Da riga di comando:
 *   node index.js createnaga  [key=value ...] [body='{"rdvBrand":"AP",...}']
 *   node index.js updatenaga  apptId=<val>    [key=value ...] [body='{"rdvBrand":"AP",...}']
 *
 * Il parametro speciale body=<json> permette di passare il payload completo come stringa JSON.
 * I parametri key=value senza body= vengono usati direttamente come payload.
 */

require('dotenv').config();

const handlers = {
  createnaga: require('./src/handlers/createnaga'),
  updatenaga: require('./src/handlers/updatenaga'),
};

// ── Lambda handler ────────────────────────────────────────────────────────────

exports.handler = async (event, context) => {
  const action = event.action || event.httpMethod;

  if (!action || !handlers[action]) {
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
 * Numeric-looking values are cast to numbers.
 * The special key "body" is excluded (handled separately as raw JSON string).
 */
function parseKvArgs(args) {
  const result = {};
  for (const arg of args) {
    const idx = arg.indexOf('=');
    if (idx === -1) continue;
    const key = arg.slice(0, idx).trim();
    if (key === 'body') continue;
    const raw = arg.slice(idx + 1).trim();
    result[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  return result;
}

async function cliMain() {
  const [, , action, ...rest] = process.argv;

  const validActions = Object.keys(handlers);

  if (!action || !validActions.includes(action)) {
    console.error('[ERROR] Azione non valida. Usa:');
    console.error("  node index.js createnaga [key=value ...] [body='{\"rdvBrand\":\"AP\",...}']");
    console.error("  node index.js updatenaga apptId=<val>    [key=value ...] [body='{\"rdvBrand\":\"AP\",...}']");
    console.error('');
    console.error('  Il parametro body= accetta un payload JSON completo come stringa.');
    console.error('  Senza body=, i parametri key=value vengono usati come payload.');
    process.exit(1);
    return;
  }

  const kvArgs  = parseKvArgs(rest);
  const bodyArg = rest.find((a) => a.startsWith('body='));

  const event = { action, params: kvArgs };

  if (bodyArg) {
    event.body = bodyArg.slice(5);
  }

  if (action === 'updatenaga') {
    if (!kvArgs.apptId) {
      console.error('[ERROR] updatenaga richiede il parametro apptId=<val>');
      process.exit(1);
      return;
    }
    event.pathParameters = { apptId: String(kvArgs.apptId) };
  }

  console.log(`\n=== AgendaSOA Naga — ${action} ===`);

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
