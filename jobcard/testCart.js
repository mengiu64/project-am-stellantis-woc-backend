'use strict';

/**
 * testCart.js — verifica GET /jobCardDetails via riga di comando (con
 * l'arricchimento DML incluso, per la sola modalità "fetch" — v. sotto
 * e testCartDML.js per ispezionare separatamente la risposta DML grezza).
 *
 * Uso:
 *   node testCart.js file  <jobCardDetailJsonFile>
 *   node testCart.js fetch <jobCardId>
 *
 * Modalità:
 *   file  - Carica un jobCardDetail da un file JSON locale e lo stampa. Il
 *           file può contenere sia { "jobCardDetail": {...} } (risposta
 *           completa di jobCardDetails) sia direttamente il jobCardDetail
 *           (nessun arricchimento DML: il file è statico).
 *   fetch - Esegue una vera GET /jobCardDetails (node index.js details) e
 *           stampa il json restituito da getJobCardDetails, cioè lo stesso
 *           prodotto da sanitizeJobCardDetails, già arricchito con i dati
 *           DML (getDataFromDML, v. jobCardService.js) prima di essere
 *           persistito in cache.
 *
 * Richiede jobcard/.env (PING_CLIENT_ID/SECRET, DGT_CLIENT_ID/SECRET) e
 * dms/.env (DMS_PING_*, DML_IBM_*) valorizzati (solo per "fetch"), dato che
 * getJobCardDetails chiama anche il gateway DML.
 *
 * Esempi:
 *   node testCart.js file  ./jobCardDetail-sample.json
 *   node testCart.js fetch 79
 */

// jobcard/config.js carica già il proprio .env autonomamente al require
// (nessuna dipendenza da dotenv necessaria).
const fs = require('fs');
const path = require('path');
const { getJobCardDetails } = require('./jobCardService');
const { getBearerToken } = require('./authService');

const [, , command, arg1] = process.argv;

function printResult(label, data) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${label}`);
  console.log('═'.repeat(65));
  console.log(JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log('\nUso: node testCart.js <command> <arg>\n');
  console.log('  file  <jobCardDetailJsonFile>  Carica jobCardDetail da file locale');
  console.log('  fetch <jobCardId>              Esegue una vera GET /jobCardDetails (già arricchita con i dati DML)\n');
  console.log('Esempi:');
  console.log('  node testCart.js file  ./jobCardDetail-sample.json');
  console.log('  node testCart.js fetch 79\n');
}

/**
 * Estrae il jobCardDetail da un body letto da file, che può essere sia la
 * risposta completa ({ jobCardDetail: {...} }) sia già il jobCardDetail.
 */
function extractJobCardDetail(body) {
  return body?.jobCardDetail ?? body;
}

async function main() {
  if (!command || !arg1) {
    printUsage();
    process.exit(1);
  }

  try {
    switch (command) {
      case 'file': {
        const filePath = path.resolve(arg1);
        const raw = fs.readFileSync(filePath, 'utf8');
        const jobCardDetail = extractJobCardDetail(JSON.parse(raw));
        printResult('jobCardDetail da file (nessun arricchimento DML)', jobCardDetail);
        break;
      }

      case 'fetch': {
        const token = await getBearerToken();
        const body = await getJobCardDetails(token, arg1);
        printResult('getJobCardDetails result (sanitizeJobCardDetails, già arricchito con i dati DML)', body);
        break;
      }

      default:
        printUsage();
        process.exit(1);
        return;
    }
  } catch (err) {
    console.error('\n❌ Errore:', err.message);
    process.exit(1);
  }
}

main();
