'use strict';

/**
 * Test per WsIQPckEper — chiamata singola via riga di comando
 *
 * Uso:
 *   node test.js <metodo> [argomenti...]
 *
 * Metodi disponibili e argomenti richiesti:
 *
 *   getGroupsPRRequest   <VIN>
 *   getSubgroupsPR       <VIN> <codiceGruppo>
 *   getPackagesPR        <VIN> <codiceGruppo> <codiceSottogruppo>
 *   getPackageDetailsPR  <VIN> <codicePacchetto> <codicePosizione> <codicePosizioneGuida>
 *
 * Esempi:
 *   node test.js getGroupsPRRequest ZAC5JABL9PJK00363
 *   node test.js getSubgroupsPR ZAC5JABL9PJK00363 33
 *   node test.js getPackagesPR ZAC5JABL9PJK00363 33 10
 *   node test.js getPackageDetailsPR ZAC5JABL9PJK00363 3310B501 000 U
 */

const { WsIQPckEper } = require('./WsIQPckEper');

// ─── Parametri di sessione ─────────────────────────────────────────────────────
const SESSION = {
  SS_CODDEALER:          '0073741',
  SS_CODMARKET:          '1000',
  authentication_ticket: null,
};
const linguaEper = 'IT';

// ─── Definizione metodi: nome → { argomenti richiesti, builder } ───────────────
const METHODS = {
  getGroupsPRRequest: {
    args: ['VIN'],
    build: ([VIN]) => ({ VIN }),
  },
  getSubgroupsPR: {
    args: ['VIN', 'codiceGruppo'],
    build: ([VIN, codiceGruppo]) => ({ VIN, codiceGruppo }),
  },
  getPackagesPR: {
    args: ['VIN', 'codiceGruppo', 'codiceSottogruppo'],
    build: ([VIN, codiceGruppo, codiceSottogruppo]) => ({ VIN, codiceGruppo, codiceSottogruppo }),
  },
  getPackageDetailsPR: {
    args: ['VIN', 'codicePacchetto', 'codicePosizione', 'codicePosizioneGuida'],
    build: ([VIN, codicePacchetto, codicePosizione, codicePosizioneGuida]) => ({
      VIN, codicePacchetto, codicePosizione, codicePosizioneGuida,
    }),
  },
};

// ─── Utility: stampa risultato ────────────────────────────────────────────────
function printResult(label, data) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${label}`);
  console.log('═'.repeat(70));
  console.log(JSON.stringify(data, null, 2));
}

// ─── Stampa usage ─────────────────────────────────────────────────────────────
function printUsage() {
  console.log('\nUso: node test.js <metodo> [argomenti...]\n');
  console.log('Metodi disponibili:\n');
  for (const [name, { args }] of Object.entries(METHODS)) {
    console.log(`  ${name.padEnd(24)} ${args.join('  ')}`);
  }
  console.log('\nEsempi:');
  console.log('  node test.js getGroupsPRRequest ZAC5JABL9PJK00363');
  console.log('  node test.js getSubgroupsPR ZAC5JABL9PJK00363 33');
  console.log('  node test.js getPackagesPR ZAC5JABL9PJK00363 33 10');
  console.log('  node test.js getPackageDetailsPR ZAC5JABL9PJK00363 3310B501 000 U\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const [, , methodName, ...cliArgs] = process.argv;

  if (!methodName || !METHODS[methodName]) {
    if (methodName) console.error(`\n❌ Metodo sconosciuto: "${methodName}"`);
    printUsage();
    process.exit(1);
  }

  const { args: requiredArgs, build } = METHODS[methodName];

  if (cliArgs.length < requiredArgs.length) {
    console.error(`\n❌ Argomenti mancanti per ${methodName}.`);
    console.error(`   Richiesti: ${requiredArgs.join(', ')}`);
    console.error(`   Ricevuti:  ${cliArgs.join(', ') || '(nessuno)'}`);
    printUsage();
    process.exit(1);
  }

  const wsIQ = new WsIQPckEper({
    coddealer: SESSION.SS_CODDEALER,
    codmarket: SESSION.SS_CODMARKET,
  });

  const params = {
    ticket: SESSION.authentication_ticket,
    lingua: linguaEper,
    ...build(cliArgs),
  };

  console.log(`\n▶  ${methodName}`, params);

  try {
    const result = await wsIQ[methodName](params);
    printResult(methodName, result);
    console.log('\n✅ Completato.');
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    process.exit(1);
  }
})();
