'use strict';

require('dotenv').config();
const { DocSOARestClient, vinParts } = require('./DocSOARestClient');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = [
  'functionsService',
  'forfaitService',
  'ibxDetailForfaitService',
  'ibxParametrageService',
  'ibxDetailtpService',
];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "functionsService", "body": {...} }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../pkDocsoa/functionsService -> "functionsService")
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
    const client = new DocSOARestClient();
    const params = body.vin ? { ...body, ...vinParts(body.vin) } : body;
    const result = await client[action](params);

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

// ── CLI (demo) ──────────────────────────────────────────────────────────────

async function main() {
  const client = new DocSOARestClient();
  const vin    = process.env.VIN;

  // Esempio: ottieni la lista funzioni per un VIN
  const result = await client.functionsService({
    langue: process.env.LANGUE,
    pays:   process.env.PAYS,
    marque: process.env.MARQUE,
    mode:   'MODE_XML',
    typedoc: ['4'],
    ...vinParts(vin),
  });

  console.log('functionsService:', JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Errore:', err.message ?? err);
    process.exit(1);
  });
}
