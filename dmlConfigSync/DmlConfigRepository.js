'use strict';

/**
 * DmlConfigRepository.js — Query SQL sulle tabelle woc.dml_enabled_markets /
 * woc.dml_configurations (Aurora PostgreSQL, db "wiadvisor", schema "woc").
 *
 * Vedi sql/create_table_dml_configurations.sql per lo schema completo.
 */

/**
 * Elenca i mercati (country+language) abilitati alla sync giornaliera.
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{country: string, language: string}>>}
 */
async function listEnabledMarkets(pool) {
  const { rows } = await pool.query({
    text: `SELECT country, language
       FROM woc.dml_enabled_markets
      WHERE active = TRUE
      ORDER BY country, language`,
    // Fallisce velocemente invece di restare in attesa indefinitamente (stesso
    // principio di getDmlConfiguration/getBrandLogos: vedi commenti li').
    statement_timeout: 5000,
  });
  return rows;
}

/**
 * Upserta (INSERT ... ON CONFLICT UPDATE) la cache company-types/customer-titles
 * per un mercato. updated_at è impostato esplicitamente ad ogni chiamata (now())
 * per riflettere l'orario reale dell'ultima sync riuscita.
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.country        - es. "fr"
 * @param {string} params.language       - es. "fr"
 * @param {Array}  params.companyTypes   - array "data" della risposta dms/getCompanyTypes ([] se assente)
 * @param {Array}  params.customerTitles - array "data" della risposta dms/getCustomerTitles ([] se assente)
 * @returns {Promise<void>}
 */
async function upsertDmlConfiguration(pool, { country, language, companyTypes, customerTitles }) {
  if (!country) throw new Error('"country" is required');
  if (!language) throw new Error('"language" is required');

  await pool.query({
    text: `INSERT INTO woc.dml_configurations (country, language, company_types, customer_titles, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (country, language)
     DO UPDATE SET company_types   = EXCLUDED.company_types,
                   customer_titles = EXCLUDED.customer_titles,
                   updated_at      = now()`,
    values: [
      country,
      language,
      JSON.stringify(Array.isArray(companyTypes) ? companyTypes : []),
      JSON.stringify(Array.isArray(customerTitles) ? customerTitles : []),
    ],
    statement_timeout: 5000,
  });
}

/**
 * Legge la riga cache più recente per un mercato (country+language).
 * Usata da session al posto delle chiamate live a dms/getCompanyTypes/getCustomerTitles.
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.country  - es. "fr"
 * @param {string} params.language - es. "fr"
 * @returns {Promise<{companyTypes: Array, customerTitles: Array, updatedAt: (Date|null)}>}
 *   Se non esiste nessuna riga per il mercato richiesto, ritorna array vuoti (mai un errore).
 */
async function getDmlConfiguration(pool, { country, language }) {
  if (!country) throw new Error('"country" is required');
  if (!language) throw new Error('"language" is required');

  const { rows } = await pool.query({
    text: `SELECT company_types, customer_titles, updated_at
       FROM woc.dml_configurations
      WHERE UPPER(TRIM(country)) = UPPER(TRIM($1))
        AND UPPER(TRIM(language)) = UPPER(TRIM($2))
      LIMIT 1`,
    values: [country, language],
    statement_timeout: 5000,
  });

  if (rows.length === 0) {
    return { companyTypes: [], customerTitles: [], updatedAt: null };
  }

  const row = rows[0];
  return {
    companyTypes: Array.isArray(row.company_types) ? row.company_types : [],
    customerTitles: Array.isArray(row.customer_titles) ? row.customer_titles : [],
    updatedAt: row.updated_at || null,
  };
}

module.exports = { listEnabledMarkets, upsertDmlConfiguration, getDmlConfiguration };
