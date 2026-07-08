'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js list    <dealerId> [options]
 *   node index.js details <jobCardId>
 *
 * Options for "list" (key=value):
 *   vin=<value>
 *   creationStartDate=<ISO8601>   creationEndDate=<ISO8601>
 *   deliveryStartDate=<ISO8601>   deliveryEndDate=<ISO8601>
 *   receptionStartDate=<ISO8601>  receptionEndDate=<ISO8601>
 *   licensePlate=<value>
 *   dmsRepairOrderId=<value>
 *   customerName=<value>
 *   page=<number>        (default: 1)
 *   pageSize=<number>    (default: 25)
 *   sortBy=<field>       (default: jobCardId)
 *   sortOrder=asc|desc   (default: asc)
 *
 * Examples:
 *   node index.js list 0062219
 *   node index.js list 0062219 page=2 pageSize=10 sortBy=creationDate sortOrder=desc
 *   node index.js list 0062219 vin=3C4NJCBH7KT831816 creationStartDate=2024-01-01T00:00:00Z
 *   node index.js details 79
 */

const { getBearerToken } = require('./authService');
const { getJobCardList, getJobCardDetails } = require('./jobCardService');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['list', 'details'];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "list", "body": { "dealerId": "..." } }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../repairorder/list -> "list")
 *     and the body is built by merging query string parameters with a JSON body, if any.
 *     Example: GET /api/repairorder/list?dealerId=0062219
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
    const result = action === 'list'
      ? await getJobCardList(token, body)
      : await getJobCardDetails(token, body.jobCardId ?? body.id);

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
 * Numeric-looking values are cast to numbers.
 */
function parseKvArgs(args) {
  const result = {};
  for (const arg of args) {
    const idx = arg.indexOf('=');
    if (idx === -1) continue;
    const key = arg.slice(0, idx).trim();
    const raw = arg.slice(idx + 1).trim();
    result[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  return result;
}

async function runList(dealerId, extraArgs) {
  console.log('\n=== JobCard List ===');
  const params = { dealerId, ...parseKvArgs(extraArgs) };
  const token = await getBearerToken();
  const result = await getJobCardList(token, params);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runDetails(jobCardId) {
  console.log('\n=== JobCard Details ===');
  const token = await getBearerToken();
  const result = await getJobCardDetails(token, jobCardId);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, param, ...rest] = process.argv;

  try {
    if (command === 'list') {
      const dealerId = param || '0062219';
      await runList(dealerId, rest);
    } else if (command === 'details') {
      const jobCardId = param || '79';
      await runDetails(jobCardId);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js list    <dealerId> [key=value ...]');
      console.error('  node index.js details <jobCardId>');
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