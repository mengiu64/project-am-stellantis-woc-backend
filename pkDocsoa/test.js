'use strict';

/**
 * test.js — chiamata singola via riga di comando
 *
 * Uso:
 *   node test.js <metodo> [argomenti opzionali da riga di comando]
 *
 * I parametri base (vin, langue, pays, marque, ecc.) vengono letti dal .env.
 * Alcuni metodi richiedono argomenti aggiuntivi specificabili da CLI
 * oppure configurabili nel .env.
 *
 * Metodi disponibili:
 *
 *   functionsService
 *       Parametri .env: VIN, LANGUE, PAYS, MARQUE, TYPEDOC
 *
 *   forfaitService
 *       Parametri .env: VIN, LANGUE, PAYS, MARQUE, CODPDV, LCDV, FONCTION_ID_LISTE, TYPE_INTERNET
 *
 *   ibxDetailForfaitService   [codeFF]
 *       Parametri .env: VIN, LANGUE, PAYS, MARQUE, CODPDV, CODE_FF
 *       CLI: node test.js ibxDetailForfaitService <codeFF>
 *
 *   ibxParametrageService
 *       Parametri .env: VIN, LANGUE, PAYS, MARQUE, FONCTION_ID_LISTE
 *
 *   ibxDetailtpService   [refTp]
 *       Parametri .env: VIN, LANGUE, PAYS, MARQUE, CODPDV, REF_TP
 *       CLI: node test.js ibxDetailtpService <refTp>
 *
 * Esempi:
 *   node test.js functionsService
 *   node test.js forfaitService
 *   node test.js ibxDetailForfaitService FF123456
 *   node test.js ibxParametrageService
 *   node test.js ibxDetailtpService TP789
 *
 * Debug:
 *   DEBUG_SOAP=1 node test.js functionsService
 */

require('dotenv').config();
const { DocSOARestClient, vinParts } = require('./DocSOARestClient');

// ─── Parametri base da .env ────────────────────────────────────────────────────
const VIN    = process.env.VIN;
const LANGUE = process.env.LANGUE;
const PAYS   = process.env.PAYS;
const MARQUE = process.env.MARQUE;
const CODPDV = process.env.CODPDV;
const LCDV   = process.env.LCDV ?? '';
const LDP    = LCDV.substring(0, 4);   // primi 4 char del LCDV
const FONCTION_ID_LISTE = (process.env.FONCTION_ID_LISTE ?? '').split(',').map(s => s.trim()).filter(Boolean);
const TYPE_INTERNET     = process.env.TYPE_INTERNET ?? '';
const CODE_FF           = process.env.CODE_FF ?? '';
const REF_TP            = process.env.REF_TP  ?? '';
const TYPEDOC           = (process.env.TYPEDOC ?? '').split(',').map(s => s.trim()).filter(Boolean);

// ─── Definizione metodi con parametri ─────────────────────────────────────────
const METHODS = {
  functionsService: {
    desc: 'Lista gerarchica funzioni/categorie per il VIN',
    build: () => ({
      langue: LANGUE, pays: PAYS, marque: MARQUE, paysUser: PAYS,
      mode: 'MODE_XML',
      typedoc: TYPEDOC.length ? TYPEDOC : undefined,
      ...vinParts(VIN),
    }),
  },
  forfaitService: {
    desc: 'Lista forfait (pacchetti) per funzioni + VIN',
    build: () => ({
      langue: LANGUE, pays: PAYS, marque: MARQUE, paysUser: PAYS,
      mode: 'MODE_XML',
      codePdv: CODPDV,
      ldp: LDP,
      fonctionIdListe: FONCTION_ID_LISTE,
      typeInternet: TYPE_INTERNET || null,
      ...vinParts(VIN),
    }),
  },
  ibxDetailForfaitService: {
    desc: 'Dettaglio di un forfait specifico (codeFF)',
    cliArgs: ['codeFF'],
    build: (cli) => ({
      langue: LANGUE, pays: PAYS, marque: MARQUE, paysUser: PAYS,
      mode: 'MODE_XML',
      codePdv: CODPDV,
      codeFF: cli[0] || CODE_FF,
      ...vinParts(VIN),
    }),
  },
  ibxParametrageService: {
    desc: 'Parametri QuickEstimate per funzioni selezionate',
    build: () => ({
      langue: LANGUE, pays: PAYS, marque: MARQUE, paysUser: PAYS,
      mode: 'MODE_XML',
      FonctionIdListe: FONCTION_ID_LISTE,
      typeInternet: TYPE_INTERNET || null,
      ...vinParts(VIN),
    }),
  },
  ibxDetailtpService: {
    desc: 'Dettaglio tempo/prezzo di una TP (refTp)',
    cliArgs: ['refTp'],
    build: (cli) => ({
      langue: LANGUE, pays: PAYS, marque: MARQUE, paysUser: PAYS,
      mode: 'MODE_XML',
      codePdv: CODPDV,
      refTp: cli[0] || REF_TP,
      ...vinParts(VIN),
    }),
  },
};

// ─── Utility ──────────────────────────────────────────────────────────────────
function printResult(label, data) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${label}`);
  console.log('═'.repeat(70));
  console.log(JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log('\nUso: node test.js <metodo> [argomenti opzionali]\n');
  console.log('Metodi disponibili:\n');
  for (const [name, { desc, cliArgs }] of Object.entries(METHODS)) {
    const args = cliArgs ? `[${cliArgs.join('] [')}]` : '';
    console.log(`  ${name.padEnd(28)} ${args}`);
    console.log(`  ${''.padEnd(28)} ${desc}\n`);
  }
  console.log('Esempi:');
  console.log('  node test.js functionsService');
  console.log('  node test.js forfaitService');
  console.log('  node test.js ibxDetailForfaitService FF123456');
  console.log('  node test.js ibxParametrageService');
  console.log('  node test.js ibxDetailtpService TP789\n');
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

  console.log(`\n▶  ${methodName}`);
  console.log('   Params:', JSON.stringify(params, null, 2));

  const client = new DocSOARestClient();

  try {
    const result = await client[methodName](params);
    printResult(methodName, result);
    console.log('\n✅ Completato.');
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    if (err.response) {
      console.error('   HTTP status:', err.response.status);
      console.error('   Response:', err.response.data?.substring?.(0, 500));
    }
    process.exit(1);
  }
})();
