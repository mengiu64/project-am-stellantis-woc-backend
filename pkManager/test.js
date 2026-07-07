'use strict';

/**
 * test.js — verifica getConfigPackages e getValidPackages via riga di comando
 *
 * Uso:
 *   node test.js config     <pkwstouse> [market]
 *   node test.js valid      <pkwstouse> <VIN>   [market]
 *
 * Esempi:
 *   node test.js config eper
 *   node test.js config docsoa
 *   node test.js config menupricing 1000
 *   node test.js valid  eper         ZAC5JABL9PJK00363
 *   node test.js valid  docsoa       VF3CABHW6GT204366
 *   node test.js valid  menupricing  W0VZT6GT7M1017935
 */

require('dotenv').config();
const { PkManager } = require('./PkManager');

const [, , command, arg1, arg2, arg3] = process.argv;

function printResult(label, data) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${label}`);
  console.log('═'.repeat(65));
  console.log(JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log('\nUso: node test.js <command> [argomenti]\n');
  console.log('  config <pkwstouse> [market]      Mostra configurazione statica');
  console.log('  valid  <pkwstouse> <VIN> [market] Intersezione config ↔ WS live\n');
  console.log('Esempi:');
  console.log('  node test.js config eper');
  console.log('  node test.js config docsoa');
  console.log('  node test.js config menupricing 1000');
  console.log('  node test.js valid  eper         ZAC5JABL9PJK00363');
  console.log('  node test.js valid  docsoa       VF3CABHW6GT204366');
  console.log('  node test.js valid  menupricing  W0VZT6GT7M1017935\n');
}

(async () => {
  if (!command || !['config', 'valid'].includes(command)) {
    if (command) console.error(`\n❌ Comando sconosciuto: "${command}"`);
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const manager = new PkManager();

  try {
    if (command === 'config') {
      const pkwstouse = arg1;
      const market    = arg2 ?? '1000';
      if (!pkwstouse) { printUsage(); process.exit(1); }
      const result = manager.getConfigPackages(market, pkwstouse);
      printResult(`getConfigPackages  market="${market}"  pkwstouse="${pkwstouse}"`, result);

    } else if (command === 'valid') {
      const pkwstouse = arg1;
      const VIN       = arg2;
      const market    = arg3 ?? '1000';
      if (!pkwstouse || !VIN) { printUsage(); process.exit(1); }
      console.log(`\n▶  getValidPackages  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`);
      const result = await manager.getValidPackages(market, pkwstouse, VIN);
      printResult(`getValidPackages  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`, result);
    }

    console.log('\n✅ Completato.');
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    process.exit(1);
  }
})();

