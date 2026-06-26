'use strict';

/**
 * test.js — chiamata singola via riga di comando
 *
 * Uso:
 *   node test.js <metodo> [argomenti...]
 *
 * Metodi disponibili:
 *   getJobs         <vin>
 *   getJobDetails   <vin> <id>
 *
 * Se gli argomenti non sono passati usa i valori da .env
 *
 * Esempi:
 *   node test.js getJobs
 *   node test.js getJobs W0VZT6GT7M1017935
 *   node test.js getJobDetails
 *   node test.js getJobDetails W0VZT6GT7M1017935 020320055429
 *
 * Debug:
 *   DEBUG_SOAP=1 node test.js getJobDetails
 */

require('dotenv').config();
const { MenuPricingSoapClient } = require('./MenuPricingSoapClient');

// ─── Parametri base (da .env) ─────────────────────────────────────────────────
const BASE = {
  languageCode:            process.env.LANGUAGE_CODE,
  countryCode:             process.env.COUNTRY_CODE,
  dealerIdentificationCode: process.env.DEALER_IDENTIFICATION_CODE,
  manufacturer:            process.env.MANUFACTURER,
  vin:                     process.env.VIN,
  id:                      process.env.ID,
};

// ─── Definizione metodi ───────────────────────────────────────────────────────
const METHODS = {
  getJobs: {
    args:  ['vin'],
    build: (cli) => ({
      ...BASE,
      ...(cli[0] ? { vin: cli[0] } : {}),
    }),
  },
  getJobDetails: {
    args:  ['vin', 'id'],
    build: (cli) => ({
      ...BASE,
      ...(cli[0] ? { vin: cli[0] } : {}),
      ...(cli[1] ? { id:  cli[1] } : {}),
    }),
  },
};

// ─── Utility ─────────────────────────────────────────────────────────────────
function printResult(label, data) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${label}`);
  console.log('═'.repeat(70));
  console.log(JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log('\nUso: node test.js <metodo> [argomenti opzionali]\n');
  console.log('Metodi disponibili:\n');
  for (const [name, { args }] of Object.entries(METHODS)) {
    const argStr = args.length ? `[${args.join('] [')}]` : '';
    console.log(`  ${name.padEnd(18)} ${argStr}  (default da .env)`);
  }
  console.log('\nEsempi:');
  console.log('  node test.js getJobs');
  console.log('  node test.js getJobs W0VZT6GT7M1017935');
  console.log('  node test.js getJobDetails');
  console.log('  node test.js getJobDetails W0VZT6GT7M1017935 020320055429\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const [, , methodName, ...cliArgs] = process.argv;

  if (!methodName || !METHODS[methodName]) {
    if (methodName) console.error(`\n❌ Metodo sconosciuto: "${methodName}"`);
    printUsage();
    process.exit(methodName ? 1 : 0);
  }

  const { build } = METHODS[methodName];
  const params    = build(cliArgs);

  console.log(`\n▶  ${methodName}`, params);

  const client = new MenuPricingSoapClient();

  try {
    const result = await client[methodName](params);
    printResult(methodName, result);
    console.log('\n✅ Completato.');
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    if (err.response) {
      console.error('   HTTP status:', err.response.status);
      console.error('   Response body:', err.response.data);
    }
    process.exit(1);
  }
})();
