'use strict';

/**
 * testCart.js — verifica getCartPriceAndAvailability + applyDataFromDml via
 * riga di comando, senza dover rifare l'intera GET /jobCardDetails ogni volta.
 *
 * Uso:
 *   node testCart.js file   <jobCardDetailJsonFile>
 *   node testCart.js tmp    <jobCardId>
 *   node testCart.js fetch  <jobCardId>
 *
 * Modalità:
 *   file  - Carica un jobCardDetail da un file JSON locale. Il file può
 *           contenere sia { "jobCardDetail": {...} } (risposta completa di
 *           jobCardDetails) sia direttamente il jobCardDetail.
 *   tmp   - Legge /tmp/<jobCardId>.json, già salvato da getJobCardDetails
 *           (saveJobCardDetailsToTmp) durante una precedente chiamata reale
 *           a "node index.js details <jobCardId>": utile per rilanciare
 *           getCartPriceAndAvailability/applyDataFromDml senza richiamare DGT.
 *   fetch - Esegue una vera GET /jobCardDetails (node index.js details) e,
 *           dato che getJobCardDetails chiama già internamente
 *           getCartPriceAndAvailability + applyDataFromDml, mostra qui solo
 *           il payload WorkLines/jobCardDetail arricchito che sarebbe stato
 *           prodotto (ricostruendolo dallo stesso jobCardDetail restituito),
 *           utile per ispezionare il mapping senza dover leggere i log della
 *           lambda dms.
 *
 * Dopo la chiamata a getCartPriceAndAvailability, lo script applica anche
 * applyDataFromDml al jobCardDetail (in place) e ne stampa il risultato, così
 * da poter verificare in un unico passaggio sia la risposta DML grezza sia
 * il jobCardDetail arricchito (originalPriceExclVat/appDiscountPercentage/
 * QuantityAvailable su partInfo, laborDuration/appDiscountPercentage/
 * laborRateAmount su laborInfo).
 *
 * Richiede jobcard/.env (PING_CLIENT_ID/SECRET, DGT_CLIENT_ID/SECRET, solo
 * per "fetch") e dms/.env (DMS_PING_*, DML_IBM_*) valorizzati, dato che
 * getCartPriceAndAvailability chiama davvero il gateway DML.
 *
 * Esempi:
 *   node testCart.js file  ./jobCardDetail-sample.json
 *   node testCart.js tmp   79
 *   node testCart.js fetch 79
 */

// jobcard/config.js e dms/config.js caricano già il proprio .env
// autonomamente al require (nessuna dipendenza da dotenv necessaria).
const fs = require('fs');
const path = require('path');
const { getJobCardDetails, getCartPriceAndAvailability, applyDataFromDml } = require('./jobCardService');
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
  console.log('  tmp   <jobCardId>              Legge /tmp/<jobCardId>.json (già salvato da una GET precedente)');
  console.log('  fetch <jobCardId>              Esegue una vera GET /jobCardDetails + getCartPriceAndAvailability\n');
  console.log('Esempi:');
  console.log('  node testCart.js file  ./jobCardDetail-sample.json');
  console.log('  node testCart.js tmp   79');
  console.log('  node testCart.js fetch 79\n');
}

/**
 * Estrae il jobCardDetail da un body letto da file/tmp, che può essere sia
 * la risposta completa ({ jobCardDetail: {...} }) sia già il jobCardDetail.
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
    let jobCardDetail;

    switch (command) {
      case 'file': {
        const filePath = path.resolve(arg1);
        const raw = fs.readFileSync(filePath, 'utf8');
        jobCardDetail = extractJobCardDetail(JSON.parse(raw));
        break;
      }

      case 'tmp': {
        const filePath = path.join('/tmp', `${arg1}.json`);
        const raw = fs.readFileSync(filePath, 'utf8');
        jobCardDetail = extractJobCardDetail(JSON.parse(raw));
        break;
      }

      case 'fetch': {
        const token = await getBearerToken();
        const body = await getJobCardDetails(token, arg1);
        // getJobCardDetails ha già chiamato getCartPriceAndAvailability +
        // applyDataFromDml internamente: qui li richiamiamo di nuovo solo
        // per stampare il risultato in questo script (stesso jobCardDetail,
        // stessa chiamata).
        jobCardDetail = extractJobCardDetail(body);
        break;
      }

      default:
        printUsage();
        process.exit(1);
        return;
    }

    const dataFromDml = await getCartPriceAndAvailability(jobCardDetail);
    printResult('getCartPriceAndAvailability result (risposta DML grezza)', dataFromDml);

    applyDataFromDml(jobCardDetail, dataFromDml);
    printResult('jobCardDetail dopo applyDataFromDml (jobs arricchiti)', jobCardDetail);
  } catch (err) {
    console.error('\n❌ Errore:', err.message);
    process.exit(1);
  }
}

main();
