'use strict';

/**
 * AnagSnowflakesRepository.js — Query SQL sulla tabella woc.ang_snowflakes (Aurora
 * PostgreSQL, db "wiadvisor", schema "woc"), snapshot dell'estrazione Snowflake
 * "M2m-queries" (anagrafica siti/contratti M2M brand/activity/status WebDAC-ARCAD).
 *
 * getCountryIsoCode risolve il codice ISO del paese del dealer (colonna
 * cd_dealer_country_iso_code) a partire dal codice mercato (cd_market_code).
 */

/**
 * @param {import('pg').Pool} pool
 * @param {{ market: string }} params
 * @returns {Promise<string|null>} il codice ISO paese (marketIso), o null se non trovato
 */
async function getCountryIsoCode(pool, { market }) {
  if (!market) throw new Error('"market" is required');

  const { rows } = await pool.query(
    `SELECT s.cd_dealer_country_iso_code
       FROM woc.ang_snowflakes s
      WHERE s.cd_market_code = $1
      LIMIT 1`,
    [market],
  );

  return rows.length > 0 ? rows[0].cd_dealer_country_iso_code : null;
}

module.exports = { getCountryIsoCode };
