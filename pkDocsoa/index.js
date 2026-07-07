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

exports.handler = async (event) => {
  const action = event.action;
  const body   = typeof event.body === 'string'
    ? JSON.parse(event.body)
    : (event.body || {});

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
