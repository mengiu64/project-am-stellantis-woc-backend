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
 * Le chiamate a dms sono REST IAM; token e credenziali IBM restano nella
 * Lambda dms. Session legge entrambe le cache tramite le rotte REST interne
 * di questo servizio, invece di chiamare i tre servizi DML ad ogni richiesta.
 *
 * Ogni mercato/dealer viene processato in isolamento (Promise.allSettled): un
 * elemento che fallisce (rete, credenziali, DB) non deve bloccare la sync
 * degli altri elementi abilitati.
 *
 * Uso CLI:
 *   node index.js sync
 */

const { callService, isInternalRequest } = require('../serviceClient');
const { getPool } = require('./db');
const { listEnabledMarkets, upsertDmlConfiguration } = require('./DmlConfigRepository');
const { listEnabledDealers, upsertDmsSettings } = require('./DmsSettingsRepository');

/**
 * Sincronizza un singolo mercato: chiama company-types + customer-titles
 * (in parallelo, REST IAM) e upserta il risultato.
 * @returns {Promise<{country: string, language: string, success: true}>}
 */
async function syncMarket(pool, { country, language }, { getCompanyTypesFn, getCustomerTitlesFn, upsertFn }) {
  const [companyTypesResponse, customerTitlesResponse] = await Promise.all([
    getCompanyTypesFn({ country, language }),
    getCustomerTitlesFn({ country, language }),
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
 * dms/settings via REST IAM e upserta il risultato in
 * woc.dms_settings.
 * @returns {Promise<{country: string, brand: string, dealer: string, success: true}>}
 */
async function syncDealer(pool, { country, brand, dealer }, { getDmsSettingsFn, upsertDmsSettingsFn }) {
  const settings = await getDmsSettingsFn({ country, brand, dealer });

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
  getCompanyTypesFn = (params) => callService('dms', 'company-types', params),
  getCustomerTitlesFn = (params) => callService('dms', 'customer-titles', params),
  getDmsSettingsFn = (params) => callService('dms', 'settings', params),
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

  let results = [];
  if (markets.length > 0) {
    const outcomes = await Promise.allSettled(
      markets.map((market) => syncMarket(pool, market, {
        getCompanyTypesFn,
        getCustomerTitlesFn,
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
    const dealerOutcomes = await Promise.allSettled(
      dealers.map((dealerEntry) => syncDealer(pool, dealerEntry, {
        getDmsSettingsFn,
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

exports.handler = async (event = {}) => {
  if (isInternalRequest(event)) return require('./internal').handler(event);
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
