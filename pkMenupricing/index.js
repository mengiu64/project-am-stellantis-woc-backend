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

// ── CLI (demo) ──────────────────────────────────────────────────────────────

async function main() {
  const client = new MenuPricingSoapClient();

  // Esempio: getJobs con i parametri da .env
  const jobs = await client.getJobs({
    languageCode:            process.env.LANGUAGE_CODE,
    countryCode:             process.env.COUNTRY_CODE,
    dealerIdentificationCode: process.env.DEALER_IDENTIFICATION_CODE,
    manufacturer:            process.env.MANUFACTURER,
    vin:                     process.env.VIN,
  });

  console.log('getJobs:', JSON.stringify(jobs, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Errore:', err.message ?? err);
    process.exit(1);
  });
}
