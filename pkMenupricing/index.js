'use strict';

require('dotenv').config();
const { MenuPricingSoapClient } = require('./MenuPricingSoapClient');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['getJobs', 'getJobDetails'];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "getJobs", "body": {...} }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../pkMenupricing/getJobs -> "getJobs")
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

  try {
    const client = new MenuPricingSoapClient();
    const result = await client[action](body);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message ?? String(err) }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────
//
// Uso:
//   node index.js getJobs        <VIN> <dealerIdentificationCode> <countryCode> [languageCode] [manufacturer]
//   node index.js getJobDetails  <VIN> <dealerIdentificationCode> <countryCode> <id> [languageCode] [manufacturer]
//
// Esempi:
//   node index.js getJobs       W0VZT6GT7M1017935 017721L ES
//   node index.js getJobDetails W0VZT6GT7M1017935 017721L ES 020320055429

function printUsage() {
  console.log('\nUso: node index.js <metodo> [argomenti]\n');
  console.log('  getJobs        <VIN> <dealerIdentificationCode> <countryCode> [languageCode] [manufacturer]');
  console.log('  getJobDetails  <VIN> <dealerIdentificationCode> <countryCode> <id> [languageCode] [manufacturer]\n');
  console.log('Esempi:');
  console.log('  node index.js getJobs       W0VZT6GT7M1017935 017721L ES');
  console.log('  node index.js getJobDetails W0VZT6GT7M1017935 017721L ES 020320055429\n');
}

async function main() {
  const [, , command, arg1, arg2, arg3, arg4, arg5, arg6] = process.argv;
  const COMMANDS = ['getJobs', 'getJobDetails'];

  if (!command || !COMMANDS.includes(command)) {
    if (command) console.error(`\n❌ Metodo sconosciuto: "${command}"`);
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const client = new MenuPricingSoapClient();

  try {
    if (command === 'getJobs') {
      const [vin, dealerIdentificationCode, countryCode] = [arg1, arg2, arg3];
      // languageCode/manufacturer: argomento CLI > .env locale (LANGUAGE_CODE/MANUFACTURER) > MP_* (fallback interno al client)
      const languageCode = arg4 ?? process.env.LANGUAGE_CODE;
      const manufacturer = arg5 ?? process.env.MANUFACTURER;
      if (!vin || !dealerIdentificationCode || !countryCode) { printUsage(); process.exit(1); }

      const jobs = await client.getJobs({ vin, dealerIdentificationCode, countryCode, languageCode, manufacturer });
      console.log('getJobs:', JSON.stringify(jobs, null, 2));

    } else if (command === 'getJobDetails') {
      const [vin, dealerIdentificationCode, countryCode, id] = [arg1, arg2, arg3, arg4];
      const languageCode = arg5 ?? process.env.LANGUAGE_CODE;
      const manufacturer = arg6 ?? process.env.MANUFACTURER;
      if (!vin || !dealerIdentificationCode || !countryCode || !id) { printUsage(); process.exit(1); }

      const details = await client.getJobDetails({ vin, dealerIdentificationCode, countryCode, id, languageCode, manufacturer });
      console.log('getJobDetails:', JSON.stringify(details, null, 2));
    }
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
