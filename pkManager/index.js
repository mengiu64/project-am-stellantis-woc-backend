'use strict';

/**
 * index.js — CLI entry point per PkManager
 *
 * Uso:
 *   node index.js getValidPackages       <pkwstouse> <VIN>   [market]
 *   node index.js getValidPackagesDetail <pkwstouse> <VIN>   [market]
 *   node index.js pkwstouse              <pkwstouse>         [market]
 *
 * Esempi:
 *   node index.js getValidPackages       eper         ZAC5JABL9PJK00363
 *   node index.js getValidPackages       menupricing  W0VZT6GT7M1017935 1000
 *   node index.js getValidPackagesDetail eper         ZAC5JABL9PJK00363
 *   node index.js getValidPackagesDetail menupricing  W0VZT6GT7M1017935 1000
 *   node index.js pkwstouse eper
 *   node index.js pkwstouse menupricing 1000
 */

require('dotenv').config();
const { PkManager } = require('./PkManager');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['getConfigPackages', 'getValidPackages', 'getValidPackagesDetail'];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "getValidPackages", "body": {...} }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../pkManager/getValidPackages -> "getValidPackages")
 *     and the body is built by merging query string parameters with a JSON body, if any.
 */
function resolveActionAndBody(event) {
  if (event && event.action) {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body)
      : (event.body || {});
    return { action: event.action, body };
  }

  const rawPath  = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  const segments = String(rawPath).split('/').filter(Boolean);
  const action   = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;

  let parsedBody = {};
  if (event.body) {
    try {
      parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (_) {
      parsedBody = {};
    }
  }

  const body = { ...(event.queryStringParameters || {}), ...parsedBody };
  return { action, body };
}

exports.handler = async (event) => {
  const { action, body } = resolveActionAndBody(event);

  if (!action || !VALID_ACTIONS.includes(action)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: `Unknown action: "${action}". Valid actions: ${VALID_ACTIONS.join(', ')}`,
      }),
    };
  }

  const { market, pkwstouse, VIN } = body;

  try {
    const manager = new PkManager(body.wsConfig);
    let result;
    if (action === 'getConfigPackages') {
      result = manager.getConfigPackages(market, pkwstouse);
    } else if (action === 'getValidPackages') {
      result = await manager.getValidPackages(market, pkwstouse, VIN);
    } else {
      result = await manager.getValidPackagesDetail(market, pkwstouse, VIN);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const statusCode = /non riconosciuto/.test(err.message ?? '') ? 400 : 502;
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message ?? String(err) }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

function printResult(label, data) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${label}`);
  console.log('═'.repeat(65));
  console.log(JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log('\nUso: node index.js <metodo> [argomenti]\n');
  console.log('  getValidPackages       <pkwstouse> <VIN> [market]   Intersezione config ↔ WS live');
  console.log('  getValidPackagesDetail <pkwstouse> <VIN> [market]   Dettaglio pacchetti validi');
  console.log('  pkwstouse              <pkwstouse> [market]         Configurazione statica\n');
  console.log('Esempi:');
  console.log('  node index.js getValidPackages       eper         ZAC5JABL9PJK00363');
  console.log('  node index.js getValidPackages       menupricing  W0VZT6GT7M1017935 1000');
  console.log('  node index.js getValidPackagesDetail eper         ZAC5JABL9PJK00363');
  console.log('  node index.js getValidPackagesDetail docsoa       VF3CABHW6GT204366');
  console.log('  node index.js getValidPackagesDetail menupricing  W0VZT6GT7M1017935 1000');
  console.log('  node index.js pkwstouse eper');
  console.log('  node index.js pkwstouse menupricing 1000\n');
}

async function main() {
  const [, , command, arg1, arg2, arg3] = process.argv;
  const COMMANDS = ['getValidPackages', 'getValidPackagesDetail', 'pkwstouse'];

  if (!command || !COMMANDS.includes(command)) {
    if (command) console.error(`\n❌ Metodo sconosciuto: "${command}"`);
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const manager = new PkManager();

  try {
    if (command === 'pkwstouse') {
      const pkwstouse = arg1;
      const market    = arg2 ?? '1000';
      if (!pkwstouse) { printUsage(); process.exit(1); }
      const result = manager.getConfigPackages(market, pkwstouse);
      printResult(`getConfigPackages  market="${market}"  pkwstouse="${pkwstouse}"`, result);

    } else if (command === 'getValidPackages') {
      const pkwstouse = arg1;
      const VIN       = arg2;
      const market    = arg3 ?? '1000';
      if (!pkwstouse || !VIN) { printUsage(); process.exit(1); }
      console.log(`\n▶  getValidPackages  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`);
      const result = await manager.getValidPackages(market, pkwstouse, VIN);
      printResult(`getValidPackages  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`, result);

    } else if (command === 'getValidPackagesDetail') {
      const pkwstouse = arg1;
      const VIN       = arg2;
      const market    = arg3 ?? '1000';
      if (!pkwstouse || !VIN) { printUsage(); process.exit(1); }
      console.log(`\n▶  getValidPackagesDetail  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`);
      const result = await manager.getValidPackagesDetail(market, pkwstouse, VIN);
      printResult(`getValidPackagesDetail  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`, result);
    }

    console.log('\n✅ Completato.');
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
