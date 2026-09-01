'use strict';

/**
 * index.js — Entry point della lambda dmlConfigSync.
 *
 * Sync giornaliera (triggerata da EventBridge Schedule, vedi template.yaml)
 * delle configurazioni DML "company-types"/"customer-titles" per i mercati
 * abilitati (tabella woc.dml_enabled_markets): per ciascun mercato chiama
 * dms/getCompanyTypes + dms/getCustomerTitles (stesso bearer token/credenziali
 * IBM di dms/settings) e upserta il risultato in woc.dml_configurations, cosi'
 * che la lambda "session" possa leggerlo da li' invece di chiamare i due
 * servizi DML ad ogni richiesta.
 *
 * Ogni mercato viene processato in isolamento (Promise.allSettled): un
 * mercato che fallisce (rete, credenziali, DB) non deve bloccare la sync
 * degli altri mercati abilitati.
 *
 * Uso CLI:
 *   node index.js sync
 */

const path = require('path');
const { getPool } = require('./db');
const { listEnabledMarkets, upsertDmlConfiguration } = require('./DmlConfigRepository');

// Cross-lambda-folder require, stesso pattern già usato da pkManager/PkManager.js
// e session/src/repositories/myPeopleDmsSessionRepository.js (require(path.resolve(
// __dirname, '../dms/...'))): il build di DmlConfigSyncFunction (Metadata:
// BuildMethod: makefile, vedi Makefile) impacchetta dms/ come cartella sorella di
// dmlConfigSync/ dentro l'artifact di deploy, cosi' questi require relativi
// continuano a risolvere correttamente anche a runtime in Lambda. Caricati "on
// demand" (lazy) invece che in cima al file: dms/config.js valida le proprie
// variabili d'ambiente non appena richiesto, e nei test unitari questo modulo
// viene eseguito con le funzioni già iniettate (vedi runSync).
let _getBearerToken;
let _getCompanyTypes;
let _getCustomerTitles;

function loadGetBearerToken() {
  if (!_getBearerToken) {
    ({ getBearerToken: _getBearerToken } = require(path.resolve(__dirname, '../dms/authService')));
  }
  return _getBearerToken;
}

function loadGetCompanyTypes() {
  if (!_getCompanyTypes) {
    ({ getCompanyTypes: _getCompanyTypes } = require(path.resolve(__dirname, '../dms/dmsService')));
  }
  return _getCompanyTypes;
}

function loadGetCustomerTitles() {
  if (!_getCustomerTitles) {
    ({ getCustomerTitles: _getCustomerTitles } = require(path.resolve(__dirname, '../dms/dmsService')));
  }
  return _getCustomerTitles;
}

/**
 * Sincronizza un singolo mercato: chiama company-types + customer-titles
 * (in parallelo, stesso bearer token) e upserta il risultato.
 * @returns {Promise<{country: string, language: string, success: true}>}
 */
async function syncMarket(pool, token, { country, language }, { getCompanyTypesFn, getCustomerTitlesFn, upsertFn }) {
  const [companyTypesResponse, customerTitlesResponse] = await Promise.all([
    getCompanyTypesFn(token, { country, language }),
    getCustomerTitlesFn(token, { country, language }),
  ]);

  await upsertFn(pool, {
    country,
    language,
    companyTypes: Array.isArray(companyTypesResponse && companyTypesResponse.data)
      ? companyTypesResponse.data
      : [],
    customerTitles: Array.isArray(customerTitlesResponse && customerTitlesResponse.data)
      ? customerTitlesResponse.data
      : [],
  });

  return { country, language, success: true };
}

/**
 * Esegue la sync per tutti i mercati abilitati. Espone i dipendenti (funzioni
 * dms + repository) come parametri opzionali per consentire l'injection nei
 * test unitari senza mai toccare i moduli reali/il DB reale.
 *
 * @returns {Promise<{success: boolean, results: Array<{country, language, success, error?}>}>}
 */
async function runSync({
  getPoolFn = getPool,
  listEnabledMarketsFn = listEnabledMarkets,
  getBearerTokenFn,
  getCompanyTypesFn,
  getCustomerTitlesFn,
  upsertFn = upsertDmlConfiguration,
} = {}) {
  const pool = await getPoolFn();
  const markets = await listEnabledMarketsFn(pool);

  if (markets.length === 0) {
    console.log('[dmlConfigSync] nessun mercato abilitato in woc.dml_enabled_markets — niente da fare');
    return { success: true, results: [] };
  }

  // Nota: i loader lazy (dms/authService, dms/dmsService) vengono risolti solo
  // qui sotto, uno alla volta e solo se effettivamente necessari — se getBearerToken
  // fallisce, loadGetCompanyTypes/loadGetCustomerTitles non vengono mai chiamati
  // (evita require cross-folder inutili, es. nei test che sostituiscono solo
  // getBearerTokenFn).
  const getBearerToken = getBearerTokenFn || loadGetBearerToken();

  let token;
  try {
    token = await getBearerToken();
  } catch (err) {
    throw new Error(`[dmlConfigSync] getBearerToken failed: ${err.message}`);
  }

  const getCompanyTypes = getCompanyTypesFn || loadGetCompanyTypes();
  const getCustomerTitles = getCustomerTitlesFn || loadGetCustomerTitles();

  const outcomes = await Promise.allSettled(
    markets.map((market) => syncMarket(pool, token, market, {
      getCompanyTypesFn: getCompanyTypes,
      getCustomerTitlesFn: getCustomerTitles,
      upsertFn,
    })),
  );

  const results = outcomes.map((outcome, index) => {
    const { country, language } = markets[index];
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    console.error(`[dmlConfigSync] sync fallita per ${country}/${language}: ${outcome.reason.message}`);
    return { country, language, success: false, error: outcome.reason.message };
  });

  const success = results.every((r) => r.success);
  return { success, results };
}

exports.handler = async () => {
  const summary = await runSync();
  console.log('[dmlConfigSync] risultato sync:', JSON.stringify(summary));
  return summary;
};

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const [, , command] = process.argv;

  try {
    if (command === 'sync') {
      const summary = await runSync();
      console.log('\n=== dmlConfigSync sync ===');
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.success) process.exitCode = 1;
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js sync');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports.runSync = runSync;
module.exports.syncMarket = syncMarket;
module.exports.main = main;
