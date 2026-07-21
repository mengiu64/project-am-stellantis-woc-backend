'use strict';

/**
 * index.js — Entry point
 *
 * Espone l'unica azione "readUserProfiles" sia come Lambda (API Gateway / invocazione
 * diretta) sia da riga di comando.
 *
 * Usage (CLI):
 *   node index.js <username> <identifier>
 *
 * Esempio:
 *   node index.js 0073741.d235 B1FD759A-B3E8-4185-BF09-4FA5EF706021
 */

const { readUserProfiles } = require('./myPeopleService');

// ── Lambda handler ────────────────────────────────────────────────────────────

/**
 * Risolve { username, identifier } da:
 *  1) Un'invocazione diretta:  { "username": "...", "identifier": "..." }
 *  2) Un evento API Gateway (REST API o HTTP API), leggendo i valori da
 *     queryStringParameters (e, se presente, da un body JSON).
 *     Esempio: GET /api/mypeople/readUserProfiles?username=...&identifier=...
 */
function resolveParams(event) {
  if (event && (event.username !== undefined || event.identifier !== undefined)) {
    return { username: event.username, identifier: event.identifier };
  }

  const qs = (event && event.queryStringParameters) || {};

  let parsedBody = {};
  if (event && event.body) {
    try {
      parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (_) {
      parsedBody = {};
    }
  }

  return { ...qs, ...parsedBody };
}

exports.handler = async (event) => {
  const { username, identifier } = resolveParams(event);

  try {
    const result = await readUserProfiles({ username, identifier });

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

async function main() {
  const [, , username, identifier] = process.argv;

  if (!username || !identifier) {
    console.error('[ERROR] Argomenti non validi. Usa:');
    console.error('  node index.js <username> <identifier>');
    console.error('  es: node index.js 0073741.d235 B1FD759A-B3E8-4185-BF09-4FA5EF706021');
    process.exit(1);
    return;
  }

  console.log('\n=== myPeople — readUserProfiles ===');

  try {
    const result = await readUserProfiles({ username, identifier });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
