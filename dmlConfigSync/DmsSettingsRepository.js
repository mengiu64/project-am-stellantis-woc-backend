'use strict';

/**
 * DmsSettingsRepository.js — Query SQL sulle tabelle
 * woc.dms_settings_enabled_dealers / woc.dms_settings (Aurora PostgreSQL, db
 * "wiadvisor", schema "woc").
 *
 * Vedi sql/create_table_dms_settings.sql per lo schema completo.
 */

/**
 * Elenca le combinazioni country+brand+dealer abilitate alla sync giornaliera
 * di dms/settings.
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{country: string, brand: string, dealer: string}>>}
 */
async function listEnabledDealers(pool) {
  const { rows } = await pool.query({
    text: `SELECT country, brand, dealer
             FROM woc.dms_settings_enabled_dealers
            WHERE active = TRUE
            ORDER BY country, brand, dealer`,
    statement_timeout: 5000,
  });
  return rows;
}

/**
 * Upserta (INSERT ... ON CONFLICT UPDATE) la cache dms/settings per una
 * combinazione country+brand+dealer. Come dml_configurations.company_types/
 * customer_titles, si scompone la risposta in due colonne separate
 * (success/data) anziche' salvare l'intero blob JSON: "data" e' l'array
 * "data" della risposta di dms/getDmsSettings (o [] se assente/non trovato),
 * "success" ne rispecchia il flag "success". updated_at è impostato
 * esplicitamente ad ogni chiamata (now()) per riflettere l'orario reale
 * dell'ultima sync riuscita.
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.country  - es. "it"
 * @param {string} params.brand    - es. "FT"
 * @param {string} params.dealer   - es. "0073741"
 * @param {object} params.settings - risposta completa di dms/getDmsSettings (es. {success, data})
 * @returns {Promise<void>}
 */
async function upsertDmsSettings(pool, { country, brand, dealer, settings }) {
  if (!country) throw new Error('"country" is required');
  if (!brand) throw new Error('"brand" is required');
  if (!dealer) throw new Error('"dealer" is required');

  const success = Boolean(settings && settings.success === true);
  const data = Array.isArray(settings && settings.data) ? settings.data : [];

  await pool.query({
    text: `INSERT INTO woc.dms_settings (country, brand, dealer, success, data, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, now())
           ON CONFLICT (country, brand, dealer)
           DO UPDATE SET success    = EXCLUDED.success,
                         data       = EXCLUDED.data,
                         updated_at = now()`,
    values: [country, brand, dealer, success, JSON.stringify(data)],
    statement_timeout: 5000,
  });
}

/**
 * Legge la riga cache più recente per una combinazione country+brand+dealer,
 * ricostruendo la stessa forma {success, data} della risposta originale di
 * dms/getDmsSettings, cosi' che session la mappi (isdml/dmlcustomerupdate/
 * dmldiscount) esattamente come faceva quando chiamava il servizio live.
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.country - es. "it"
 * @param {string} params.brand   - es. "FT"
 * @param {string} params.dealer  - es. "0073741"
 * @returns {Promise<{success: boolean, data: Array}|null>} la risposta dms/settings
 *   ricostruita da cache, oppure `null` se non esiste ancora nessuna riga per la
 *   combinazione richiesta (mai un errore per una riga assente).
 */
async function getDmsSettings(pool, { country, brand, dealer }) {
  if (!country) throw new Error('"country" is required');
  if (!brand) throw new Error('"brand" is required');
  if (!dealer) throw new Error('"dealer" is required');

  const { rows } = await pool.query({
    text: `SELECT success, data, updated_at
             FROM woc.dms_settings
            WHERE UPPER(TRIM(country)) = UPPER(TRIM($1))
              AND UPPER(TRIM(brand))   = UPPER(TRIM($2))
              AND UPPER(TRIM(dealer))  = UPPER(TRIM($3))
            LIMIT 1`,
    values: [country, brand, dealer],
    statement_timeout: 5000,
  });

  if (rows.length === 0) return null;

  const { success, data } = rows[0];
  return {
    success: success === true,
    data: Array.isArray(data) ? data : [],
  };
}

/**
 * Registra (best-effort, INSERT ... ON CONFLICT DO NOTHING) una nuova
 * combinazione country+brand+dealer nel registro delle combinazioni
 * abilitate, cosi' che la prossima esecuzione schedulata di dmlConfigSync
 * la sincronizzi. Chiamata da session al primo cache-miss su woc.dms_settings
 * (vedi MyPeopleDmsSessionRepository): non deve mai far fallire la sessione,
 * quindi il chiamante attende (await) questa chiamata ma ignora sempre un
 * eventuale errore (mai propagato/bloccante).
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.country - es. "it"
 * @param {string} params.brand   - es. "FT"
 * @param {string} params.dealer  - es. "0073741"
 * @returns {Promise<void>}
 */
async function registerDealer(pool, { country, brand, dealer }) {
  if (!country || !brand || !dealer) return;

  await pool.query({
    text: `INSERT INTO woc.dms_settings_enabled_dealers (country, brand, dealer, active)
           VALUES ($1, $2, $3, TRUE)
           ON CONFLICT (country, brand, dealer) DO NOTHING`,
    values: [country, brand, dealer],
    statement_timeout: 5000,
  });
}

module.exports = { listEnabledDealers, upsertDmsSettings, getDmsSettings, registerDealer };
