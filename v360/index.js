'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js otaCompatibility <vin> [options]
 *   node index.js getdetails       <vin> [options]
 *
 * Options for "otaCompatibility" (key=value):
 *   includeOtaHistoryData=true|false   (default: true)
 *   locale=<value>                     (e.g. fr_FR)
 *
 * Options for "getdetails" (key=value):
 *   searchType=<value>     (default: vin)
 *   countryCode=<value>    (e.g. FR)
 *   clientId=<value>
 *   offering=<value>       (e.g. "Vehicle Description,campaign")
 *   languageCode=<value>   (e.g. fr)
 *
 * Examples:
 *   node index.js otaCompatibility VR7EMZKU7RJ963237
 *   node index.js otaCompatibility VR7EMZKU7RJ963237 includeOtaHistoryData=true locale=fr_FR
 *   node index.js getdetails VF3VEAHHWFZ062040
 *   node index.js getdetails VF3VEAHHWFZ062040 countryCode=FR offering="Vehicle Description,campaign" languageCode=fr
 */

const { getBearerToken } = require('./authService');
const { otaCompatibility, getDetails } = require('./v360Service');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['otaCompatibility', 'getdetails'];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "getdetails", "body": {...} }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../v360/getdetails -> "getdetails")
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
    const token = await getBearerToken();
    const result = action === 'otaCompatibility'
      ? await otaCompatibility(token, body)
      : await getDetails(token, body);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const statusCode = err.message.includes('is required') ? 400 : 502;
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
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

async function runOtaCompatibility(vin, extraArgs) {
  console.log('\n=== OTA Compatibility ===');
  const params = { vin, ...parseKvArgs(extraArgs) };
  const token = await getBearerToken();
  const result = await otaCompatibility(token, params);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runGetDetails(vin, extraArgs) {
  console.log('\n=== Get Details ===');
  const params = { vin, ...parseKvArgs(extraArgs) };
  const token = await getBearerToken();
  const result = await getDetails(token, params);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, param, ...rest] = process.argv;

  try {
    if (command === 'otaCompatibility') {
      const vin = param || 'VR7EMZKU7RJ963237';
      await runOtaCompatibility(vin, rest);
    } else if (command === 'getdetails') {
      const vin = param || 'VF3VEAHHWFZ062040';
      await runGetDetails(vin, rest);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js otaCompatibility <vin> [key=value ...]');
      console.error('  node index.js getdetails       <vin> [key=value ...]');
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