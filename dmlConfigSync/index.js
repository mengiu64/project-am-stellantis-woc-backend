'use strict';

/**
 * index.js — Entry point della lambda dmlConfigSync.
 *
 * Sync giornaliera (triggerata da EventBridge Schedule, vedi template.yaml)
 * che aggiorna due cache indipendenti su Aurora PostgreSQL:
 *
 *   1) configurazioni DML "company-types"/"customer-titles" per i mercati
 *      abilitati (tabella woc.dml_enabled_markets): per ciascun mercato chiama
 *      dms/getCompanyTypes + dms/getCustomerTitles e upserta il risultato in
 *      woc.dml_configurations.
 *   2) dms/settings per le combinazioni country+brand+dealer abilitate
 *      (tabella woc.dms_settings_enabled_dealers, popolata automaticamente da
 *      "session" al primo cache-miss): per ciascuna combinazione chiama
 *      dms/getDmsSettings e upserta il risultato in woc.dms_settings.
 *
 * Entrambe condividono lo stesso bearer token/credenziali IBM (dms/authService),
 * recuperato una sola volta per esecuzione. La lambda "session" legge entrambe
 * le cache invece di chiamare i tre servizi DML ad ogni richiesta.
 *
 * Ogni mercato/dealer viene processato in isolamento (Promise.allSettled): un
 * elemento che fallisce (rete, credenziali, DB) non deve bloccare la sync
 * degli altri elementi abilitati.
 *
 * Uso CLI:
 *   node index.js sync
 */

const path = require('path');
const { getPool } = require('./db');
const { listEnabledMarkets, upsertDmlConfiguration } = require('./DmlConfigRepository');
const { listEnabledDealers, upsertDmsSettings } = require('./DmsSettingsRepository');

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
let _getDmsSettings;

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

function loadGetDmsSettings() {
  if (!_getDmsSettings) {
    ({ getDmsSettings: _getDmsSettings } = require(path.resolve(__dirname, '../dms/dmsService')));
  }
  return _getDmsSettings;
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
 * Sincronizza una singola combinazione country+brand+dealer: chiama
 * dms/settings (stesso bearer token dei mercati) e upserta il risultato in
 * woc.dms_settings.
 * @returns {Promise<{country: string, brand: string, dealer: string, success: true}>}
 */
async function syncDealer(pool, token, { country, brand, dealer }, { getDmsSettingsFn, upsertDmsSettingsFn }) {
  const settings = await getDmsSettingsFn(token, { country, brand, dealer });

  await upsertDmsSettingsFn(pool, { country, brand, dealer, settings });

  return { country, brand, dealer, success: true };
}

/**
 * Esegue la sync per tutti i mercati (company-types/customer-titles) e per
 * tutte le combinazioni country+brand+dealer (dms/settings) abilitate. Espone
 * i dipendenti (funzioni dms + repository) come parametri opzionali per
 * consentire l'injection nei test unitari senza mai toccare i moduli reali/il
 * DB reale.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   results: Array<{country, language, success, error?}>,
 *   dealerResults: Array<{country, brand, dealer, success, error?}>
 * }>}
 */
async function runSync({
  getPoolFn = getPool,
  listEnabledMarketsFn = listEnabledMarkets,
  listEnabledDealersFn = listEnabledDealers,
  getBearerTokenFn,
  getCompanyTypesFn,
  getCustomerTitlesFn,
  getDmsSettingsFn,
  upsertFn = upsertDmlConfiguration,
  upsertDmsSettingsFn = upsertDmsSettings,
} = {}) {
  const pool = await getPoolFn();
  const [markets, dealers] = await Promise.all([
    listEnabledMarketsFn(pool),
    listEnabledDealersFn(pool),
  ]);

  if (markets.length === 0 && dealers.length === 0) {
    console.log('[dmlConfigSync] nessun mercato/dealer abilitato (woc.dml_enabled_markets / woc.dms_settings_enabled_dealers) — niente da fare');
    return { success: true, results: [], dealerResults: [] };
  }

  // Nota: i loader lazy (dms/authService, dms/dmsService) vengono risolti solo
  // qui sotto, uno alla volta e solo se effettivamente necessari — se getBearerToken
  // fallisce, i restanti loader non vengono mai chiamati (evita require
  // cross-folder inutili, es. nei test che sostituiscono solo getBearerTokenFn).
  const getBearerToken = getBearerTokenFn || loadGetBearerToken();

  let token;
  try {
    token = await getBearerToken();
  } catch (err) {
    throw new Error(`[dmlConfigSync] getBearerToken failed: ${err.message}`);
  }

  let results = [];
  if (markets.length > 0) {
    const getCompanyTypes = getCompanyTypesFn || loadGetCompanyTypes();
    const getCustomerTitles = getCustomerTitlesFn || loadGetCustomerTitles();

    const outcomes = await Promise.allSettled(
      markets.map((market) => syncMarket(pool, token, market, {
        getCompanyTypesFn: getCompanyTypes,
        getCustomerTitlesFn: getCustomerTitles,
        upsertFn,
      })),
    );

    results = outcomes.map((outcome, index) => {
      const { country, language } = markets[index];
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      console.error(`[dmlConfigSync] sync company-types/customer-titles fallita per ${country}/${language}: ${outcome.reason.message}`);
      return { country, language, success: false, error: outcome.reason.message };
    });
  }

  let dealerResults = [];
  if (dealers.length > 0) {
    const getDmsSettings = getDmsSettingsFn || loadGetDmsSettings();

    const dealerOutcomes = await Promise.allSettled(
      dealers.map((dealerEntry) => syncDealer(pool, token, dealerEntry, {
        getDmsSettingsFn: getDmsSettings,
        upsertDmsSettingsFn,
      })),
    );

    dealerResults = dealerOutcomes.map((outcome, index) => {
      const { country, brand, dealer } = dealers[index];
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      console.error(`[dmlConfigSync] sync dms/settings fallita per ${country}/${brand}/${dealer}: ${outcome.reason.message}`);
      return { country, brand, dealer, success: false, error: outcome.reason.message };
    });
  }

  const success = results.every((r) => r.success) && dealerResults.every((r) => r.success);
  return { success, results, dealerResults };
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
module.exports.syncDealer = syncDealer;
module.exports.main = main;
