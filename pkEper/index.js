'use strict';

/**
 * index.js — entry point Lambda + demo CLI
 * Espone WsIQPckEper come Lambda handler (event.action / event.body) e,
 * se eseguito direttamente con `node index.js`, mostra un esempio d'uso.
 */

const { WsIQPckEper } = require('./WsIQPckEper');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['getGroupsPRRequest', 'getSubgroupsPR', 'getPackagesPR', 'getPackageDetailsPR'];

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
    const client = new WsIQPckEper({ coddealer: body.coddealer, codmarket: body.codmarket });
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
  const wsIQ = new WsIQPckEper({
    coddealer: '0073741',
    codmarket: '1000',
  });

  // Esempio: ottieni i gruppi per un VIN
  const groups = await wsIQ.getGroupsPRRequest({
    ticket: null,
    lingua: 'IT',
    VIN: 'ZAC5JABL9PJK00363',
  });

  console.log('Gruppi ePer:', JSON.stringify(groups, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Errore:', err.message ?? err);
    process.exit(1);
  });
}
