'use strict';

/**
 * index.js — Entry point della lambda hqManager (Aurora PostgreSQL, tabelle
 * woc.ang_snowflakes / woc.addr_snowflakes / woc.hq_application_enabling).
 *
 * Espone due azioni, delegate a HqManager.js (a sua volta wrapper su
 * dbManager/HqRepository.js):
 *   - getEnablingConfiguration(codmarket): elenco siti del mercato con
 *     l'eventuale configurazione di abilitazione WOC/firma digitale.
 *   - setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature):
 *     crea/aggiorna (upsert) la configurazione di abilitazione per la coppia
 *     (codmarket, oic).
 *
 * Uso CLI:
 *   node index.js getEnablingConfiguration <codmarket>
 *   node index.js setEnablingConfiguration <codmarket> <oic> <enableWOC> <enableSignature>
 */

const { HqManager } = require('./HqManager');

const VALID_ACTIONS = ['getEnablingConfiguration', 'setEnablingConfiguration'];

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

/**
 * Risolve { action, body } da:
 *  1) un'invocazione diretta { "action": "...", "body": {...} }, oppure
 *  2) un vero evento API Gateway proxy, prendendo l'azione dall'ultimo
 *     segmento del path e unendo query string + body JSON — stesso pattern
 *     di pkManager/index.js::resolveActionAndBody.
 */
function resolveActionAndBody(event) {
  if (event.action) {
    return { action: event.action, body: event.body || {} };
  }

  const rawPath = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  const segments = String(rawPath).split('/').filter(Boolean);
  const pathAction = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;

  const body = { ...(event.queryStringParameters || {}), ...parseBody(event) };
  return { action: body.action || pathAction, body };
}

exports.handler = async (event = {}) => {
  const { action, body } = resolveActionAndBody(event);

  if (!action || !VALID_ACTIONS.includes(action)) {
    return response(400, { success: false, message: `Azione non supportata: "${action}". Azioni valide: ${VALID_ACTIONS.join(', ')}` });
  }

  const { codmarket, oic, enableWOC, enableSignature } = body;
  const manager = new HqManager();

  try {
    if (action === 'getEnablingConfiguration') {
      const configurations = await manager.getEnablingConfiguration(codmarket);
      return response(200, { success: true, codmarket, configurations });
    }

    await manager.setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature);
    return response(200, { success: true, codmarket, oic, enableWOC, enableSignature });
  } catch (err) {
    const statusCode = err.message.includes('is required') ? 400 : 502;
    return response(statusCode, { success: false, message: err.message });
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log('\nUso: node index.js <metodo> [argomenti]\n');
  console.log('  getEnablingConfiguration <codmarket>                                       Elenco siti + configurazione WOC/firma');
  console.log('  setEnablingConfiguration <codmarket> <oic> <enableWOC> <enableSignature>    Crea/aggiorna la configurazione\n');
  console.log('Esempi:');
  console.log('  node index.js getEnablingConfiguration 1000');
  console.log('  node index.js setEnablingConfiguration 1000 00006821 1 0\n');
}

async function runGetEnablingConfiguration(codmarket) {
  console.log('\n=== hqManager getEnablingConfiguration ===');
  const manager = new HqManager();
  const configurations = await manager.getEnablingConfiguration(codmarket);
  console.log(JSON.stringify({ success: true, codmarket, configurations }, null, 2));
  return configurations;
}

async function runSetEnablingConfiguration(codmarket, oic, enableWOC, enableSignature) {
  console.log('\n=== hqManager setEnablingConfiguration ===');
  const manager = new HqManager();
  await manager.setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature);
  const result = { success: true, codmarket, oic, enableWOC, enableSignature };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, arg1, arg2, arg3, arg4] = process.argv;

  try {
    if (command === 'getEnablingConfiguration') {
      if (!arg1) { printUsage(); process.exit(1); return; }
      await runGetEnablingConfiguration(arg1);
    } else if (command === 'setEnablingConfiguration') {
      if (!arg1 || !arg2 || arg3 === undefined || arg4 === undefined) { printUsage(); process.exit(1); return; }
      await runSetEnablingConfiguration(arg1, arg2, Number(arg3), Number(arg4));
    } else {
      printUsage();
      process.exit(command ? 1 : 0);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports.parseBody = parseBody;
module.exports.runGetEnablingConfiguration = runGetEnablingConfiguration;
module.exports.runSetEnablingConfiguration = runSetEnablingConfiguration;
module.exports.main = main;
