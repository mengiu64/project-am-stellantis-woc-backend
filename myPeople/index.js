'use strict';

/**
 * index.js — Entry point
 *
 * Espone l'unica azione "readUserProfiles" sia come Lambda (API Gateway / invocazione
 * diretta) sia da riga di comando. L'"identifier" è una costante di configurazione
 * (env MYPEOPLE_IDENTIFIER) e non viene più passato dal chiamante.
 *
 * Usage (CLI):
 *   node index.js <username>
 *
 * Esempio:
 *   node index.js 0073741.d235
 */

const { readUserProfiles } = require('./myPeopleService');

// ── Lambda handler ────────────────────────────────────────────────────────────

/**
 * Risolve { username } da:
 *  1) Un'invocazione diretta:  { "username": "..." }
 *  2) Un evento API Gateway (REST API o HTTP API), leggendo il valore da
 *     queryStringParameters (e, se presente, da un body JSON).
 *     Esempio: GET /api/mypeople/readUserProfiles?username=...
 */
function resolveParams(event) {
  if (event && event.username !== undefined) {
    return { username: event.username };
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
  const { username } = resolveParams(event);

  try {
    const result = await readUserProfiles({ username });

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
  const [, , username] = process.argv;

  if (!username) {
    console.error('[ERROR] Argomenti non validi. Usa:');
    console.error('  node index.js <username>');
    console.error('  es: node index.js 0073741.d235');
    process.exit(1);
    return;
  }

  console.log('\n=== myPeople — readUserProfiles ===');

  try {
    const result = await readUserProfiles({ username });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
