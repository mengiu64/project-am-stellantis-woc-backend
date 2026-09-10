'use strict';

/**
 * AnagSnowflakesRepository.js — Query SQL sulla tabella woc.ang_snowflakes (Aurora
 * PostgreSQL, db "wiadvisor", schema "woc"), snapshot dell'estrazione Snowflake
 * "M2m-queries" (anagrafica siti/contratti M2M brand/activity/status WebDAC-ARCAD).
 *
 * getCountryIsoCode risolve il codice ISO del paese del dealer (colonna
 * cd_dealer_country_iso_code) a partire dal codice mercato (cd_market_code).
 *
 * getPhysicalSiteAndSincom risolve, a partire da mainSincom/market/brand (dati
 * già disponibili da session/jobCardDetails), il sito fisico ARCAD
 * (gn_physical_site_arcad) e il sincom di brand (cd_sincom_code) — usati per
 * completare in modo dinamico il Sender dell'inquiry DMS
 * (physicalSiteId/dealerNumberIdSource), invece dei valori statici configurati
 * via env in dms/config.js.
 */

/** Codice brand a 2 lettere (es. "FT", "CY", "AR") → colonna ARCAD; qualunque altro formato (tipicamente numerico, es. "55", "00") → colonna WebDAC. */
const ARCAD_BRAND_CODE_PATTERN = /^[A-Za-z]{2}$/;

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

/**
 * Risolve physicalSiteId (gn_physical_site_arcad) e dealerNumberIdSource
 * (cd_sincom_code) per il Sender dinamico dell'inquiry DMS, a partire da
 * mainSincom (cd_main_sincom_code, es. session.sincom/MAINSINCOM), market
 * (cd_market_code, es. session.codmarket) e brand (jobCardDetail.roInfo, es.
 * stellantisBrand "FT" o brand "55").
 *
 * Il brand puo' essere espresso in due formati (stesso dato, due colonne
 * diverse in ang_snowflakes): codice a 2 lettere ARCAD/RefTech (es. "FT",
 * "CY", "AR" → cd_contract_brand_arcad_code) o codice WebDAC, tipicamente
 * numerico (es. "55", "00", "83" → cd_contract_brand_webdac_code). La colonna
 * viene scelta automaticamente in base al formato del valore ricevuto.
 *
 * @param {import('pg').Pool} pool
 * @param {{ mainSincom: string, market: string, brand: string }} params
 * @returns {Promise<{ physicalSiteId: string|null, dealerNumberIdSource: string|null }>}
 *          entrambi null se non e' stata trovata alcuna riga corrispondente
 */
async function getPhysicalSiteAndSincom(pool, { mainSincom, market, brand } = {}) {
  if (!mainSincom) throw new Error('"mainSincom" is required');
  if (!market) throw new Error('"market" is required');
  if (!brand) throw new Error('"brand" is required');

  const brandColumn = ARCAD_BRAND_CODE_PATTERN.test(brand)
    ? 'cd_contract_brand_arcad_code'
    : 'cd_contract_brand_webdac_code';

  const { rows } = await pool.query(
    `SELECT s.gn_physical_site_arcad, s.cd_sincom_code
       FROM woc.ang_snowflakes s
      WHERE s.cd_main_sincom_code = $1
        AND s.cd_market_code = $2
        AND s.${brandColumn} = $3
      LIMIT 1`,
    [mainSincom, market, brand],
  );

  if (rows.length === 0) {
    return { physicalSiteId: null, dealerNumberIdSource: null };
  }

  return {
    physicalSiteId: rows[0].gn_physical_site_arcad,
    dealerNumberIdSource: rows[0].cd_sincom_code,
  };
}

module.exports = { getCountryIsoCode, getPhysicalSiteAndSincom };
