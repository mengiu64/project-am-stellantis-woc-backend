'use strict';

/**
 * index.js — CLI entry point per PkManager
 *
 * Uso:
 *   node index.js getValidPackages       <pkwstouse> <VIN>   [market]
 *   node index.js getValidPackagesDetail <pkwstouse> <VIN>   [market]
 *   node index.js pkwstouse              <pkwstouse>         [market]
 *
 * Esempi:
 *   node index.js getValidPackages       eper         ZAC5JABL9PJK00363
 *   node index.js getValidPackages       menupricing  W0VZT6GT7M1017935 1000
 *   node index.js getValidPackagesDetail eper         ZAC5JABL9PJK00363
 *   node index.js getValidPackagesDetail menupricing  W0VZT6GT7M1017935 1000
 *   node index.js pkwstouse eper
 *   node index.js pkwstouse menupricing 1000
 */

require('dotenv').config();
const { PkManager } = require('./PkManager');

function printResult(label, data) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${label}`);
  console.log('═'.repeat(65));
  console.log(JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log('\nUso: node index.js <metodo> [argomenti]\n');
  console.log('  getValidPackages       <pkwstouse> <VIN> [market]   Intersezione config ↔ WS live');
  console.log('  getValidPackagesDetail <pkwstouse> <VIN> [market]   Dettaglio pacchetti validi');
  console.log('  pkwstouse              <pkwstouse> [market]         Configurazione statica\n');
  console.log('Esempi:');
  console.log('  node index.js getValidPackages       eper         ZAC5JABL9PJK00363');
  console.log('  node index.js getValidPackages       menupricing  W0VZT6GT7M1017935 1000');
  console.log('  node index.js getValidPackagesDetail eper         ZAC5JABL9PJK00363');
  console.log('  node index.js getValidPackagesDetail docsoa       VF3CABHW6GT204366');
  console.log('  node index.js getValidPackagesDetail menupricing  W0VZT6GT7M1017935 1000');
  console.log('  node index.js pkwstouse eper');
  console.log('  node index.js pkwstouse menupricing 1000\n');
}

(async () => {
  const [, , command, arg1, arg2, arg3] = process.argv;
  const COMMANDS = ['getValidPackages', 'getValidPackagesDetail', 'pkwstouse'];

  if (!command || !COMMANDS.includes(command)) {
    if (command) console.error(`\n❌ Metodo sconosciuto: "${command}"`);
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const manager = new PkManager();

  try {
    if (command === 'pkwstouse') {
      const pkwstouse = arg1;
      const market    = arg2 ?? '1000';
      if (!pkwstouse) { printUsage(); process.exit(1); }
      const result = manager.getConfigPackages(market, pkwstouse);
      printResult(`getConfigPackages  market="${market}"  pkwstouse="${pkwstouse}"`, result);

    } else if (command === 'getValidPackages') {
      const pkwstouse = arg1;
      const VIN       = arg2;
      const market    = arg3 ?? '1000';
      if (!pkwstouse || !VIN) { printUsage(); process.exit(1); }
      console.log(`\n▶  getValidPackages  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`);
      const result = await manager.getValidPackages(market, pkwstouse, VIN);
      printResult(`getValidPackages  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`, result);

    } else if (command === 'getValidPackagesDetail') {
      const pkwstouse = arg1;
      const VIN       = arg2;
      const market    = arg3 ?? '1000';
      if (!pkwstouse || !VIN) { printUsage(); process.exit(1); }
      console.log(`\n▶  getValidPackagesDetail  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`);
      const result = await manager.getValidPackagesDetail(market, pkwstouse, VIN);
      printResult(`getValidPackagesDetail  market="${market}"  pkwstouse="${pkwstouse}"  VIN="${VIN}"`, result);
    }

    console.log('\n✅ Completato.');
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    process.exit(1);
  }
})();
