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
 * (gn_physical_site_arcad), il sincom di brand (cd_sincom_code) e il codice
 * dealer ARCAD (cd_dealer_arcad_code) — usati per completare in modo dinamico
 * il Sender dell'inquiry DMS (physicalSiteId/dealerNumberIdSource) e i dati
 * di sessione (physicalsite/pdvId, v. MyPeopleDmsSessionRepository), invece
 * dei valori statici configurati via env in dms/config.js.
 *
 * Il match su mainSincom e' fatto in OR tra cd_main_sincom_code e
 * gn_legal_entity (stesso dato logico, colonne diverse a seconda della
 * sorgente/estrazione), cosi' da coprire entrambi i casi con un'unica query.
 *
 * Il brand viene sempre cercato tramite un unico criterio uniforme, il
 * codice ARCAD/RefTech a 2 lettere (cd_contract_brand_arcad_code): se il
 * chiamante passa gia' un codice a 2 lettere (es. "FT", "CY", "AR") viene
 * usato cosi' com'e', altrimenti (tipicamente un codice numerico WebDAC, es.
 * "55", "00", "83") viene prima risolto nel corrispondente codice ARCAD
 * tramite resolveArcadBrandCode(), interrogando la stessa tabella.
 */

/** Codice brand a 2 lettere (es. "FT", "CY", "AR"): formato ARCAD/RefTech, usato come unico criterio di ricerca del brand. */
const ARCAD_BRAND_CODE_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Uniforma il codice brand ricevuto al formato ARCAD/RefTech a 2 lettere
 * (cd_contract_brand_arcad_code), unico criterio usato per cercare il brand
 * in woc.ang_snowflakes. Se il valore ricevuto e' gia' in quel formato viene
 * restituito cosi' com'e' (in maiuscolo); altrimenti (tipicamente un codice
 * numerico WebDAC, es. "55", "00", "83") viene risolto interrogando la
 * colonna cd_contract_brand_webdac_code della stessa tabella.
 *
 * @param {import('pg').Pool} pool
 * @param {string} brand
 * @returns {Promise<string|null>} il codice ARCAD a 2 lettere, o null se il
 *          brand ricevuto non e' in formato ARCAD e non e' stato possibile
 *          risolverlo a partire dal codice WebDAC
 */
async function resolveArcadBrandCode(pool, brand) {
  if (ARCAD_BRAND_CODE_PATTERN.test(brand)) return brand.toUpperCase();

  const { rows } = await pool.query(
    `SELECT s.cd_contract_brand_arcad_code
       FROM woc.ang_snowflakes s
      WHERE s.cd_contract_brand_webdac_code = $1
      LIMIT 1`,
    [brand],
  );

  return rows.length > 0 ? rows[0].cd_contract_brand_arcad_code : null;
}

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
 * Risolve physicalSiteId (gn_physical_site_arcad), dealerNumberIdSource
 * (cd_sincom_code) e dealerArcadCode (cd_dealer_arcad_code) per il Sender
 * dinamico dell'inquiry DMS e per i dati di sessione (physicalsite/pdvId, v.
 * MyPeopleDmsSessionRepository::getSessionData), a partire da mainSincom
 * (cd_main_sincom_code/gn_legal_entity, es. session.sincom/MAINSINCOM),
 * market (cd_market_code, es. session.codmarket) e brand (jobCardDetail.roInfo,
 * es. stellantisBrand "FT" o brand "55").
 *
 * mainSincom viene cercato in OR tra le colonne cd_main_sincom_code e
 * gn_legal_entity (stesso dato logico, valorizzato in colonne diverse a
 * seconda della sorgente/estrazione).
 *
 * Il brand e' sempre cercato tramite un unico criterio uniforme, il codice
 * ARCAD/RefTech a 2 lettere (cd_contract_brand_arcad_code): se ricevuto in
 * altro formato (tipicamente numerico WebDAC, es. "55", "00", "83") viene
 * prima trasformato nel corrispondente codice ARCAD tramite
 * resolveArcadBrandCode() — vedi sopra.
 *
 * @param {import('pg').Pool} pool
 * @param {{ mainSincom: string, market: string, brand: string }} params
 * @returns {Promise<{ physicalSiteId: string|null, dealerNumberIdSource: string|null, dealerArcadCode: string|null }>}
 *          tutti null se non e' stata trovata alcuna riga corrispondente
 *          (incluso il caso in cui il brand non sia risolvibile in formato ARCAD)
 */
async function getPhysicalSiteAndSincom(pool, { mainSincom, market, brand } = {}) {
  if (!mainSincom) throw new Error('"mainSincom" is required');
  if (!market) throw new Error('"market" is required');
  if (!brand) throw new Error('"brand" is required');

  const arcadBrand = await resolveArcadBrandCode(pool, brand);
  if (!arcadBrand) {
    return { physicalSiteId: null, dealerNumberIdSource: null, dealerArcadCode: null };
  }

  const { rows } = await pool.query(
    `SELECT s.gn_physical_site_arcad, s.cd_sincom_code, s.cd_dealer_arcad_code
       FROM woc.ang_snowflakes s
      WHERE (s.cd_main_sincom_code = $1 OR s.gn_legal_entity = $1)
        AND s.cd_market_code = $2
        AND s.cd_contract_brand_arcad_code = $3
      LIMIT 1`,
    [mainSincom, market, arcadBrand],
  );

  if (rows.length === 0) {
    return { physicalSiteId: null, dealerNumberIdSource: null, dealerArcadCode: null };
  }

  return {
    physicalSiteId: rows[0].gn_physical_site_arcad,
    dealerNumberIdSource: rows[0].cd_sincom_code,
    dealerArcadCode: rows[0].cd_dealer_arcad_code,
  };
}

/**
 * Risolve physicalsite (gn_physical_site_arcad) e pdvId (cd_dealer_arcad_code)
 * per i dati di sessione (v. MyPeopleDmsSessionRepository::getSessionData), a
 * partire da mainSincom (cd_main_sincom_code/gn_legal_entity, es.
 * session.sincom/MAINSINCOM), market (cd_market_code, es. session.codmarket),
 * brand (jobCardDetail.roInfo, es. stellantisBrand "FT" o brand "55") e oic
 * (cd_paired_oic_code, es. session.oic).
 *
 * mainSincom viene cercato in OR tra le colonne cd_main_sincom_code e
 * gn_legal_entity (stesso dato logico, valorizzato in colonne diverse a
 * seconda della sorgente/estrazione).
 *
 * Il brand e' sempre cercato tramite un unico criterio uniforme, il codice
 * ARCAD/RefTech a 2 lettere (cd_contract_brand_arcad_code): se ricevuto in
 * altro formato (tipicamente numerico WebDAC, es. "55", "00", "83") viene
 * prima trasformato nel corrispondente codice ARCAD tramite
 * resolveArcadBrandCode() — vedi sopra.
 *
 * @param {import('pg').Pool} pool
 * @param {{ mainSincom: string, market: string, brand: string, oic: string }} params
 * @returns {Promise<{ physicalSiteId: string|null, dealerArcadCode: string|null }>}
 *          entrambi null se non e' stata trovata alcuna riga corrispondente
 *          (incluso il caso in cui il brand non sia risolvibile in formato ARCAD)
 */
async function getPhysicalSiteAndPdvId(pool, { mainSincom, market, brand, oic } = {}) {
  if (!mainSincom) throw new Error('"mainSincom" is required');
  if (!market) throw new Error('"market" is required');
  if (!brand) throw new Error('"brand" is required');
  if (!oic) throw new Error('"oic" is required');

  const arcadBrand = await resolveArcadBrandCode(pool, brand);
  if (!arcadBrand) {
    return { physicalSiteId: null, dealerArcadCode: null };
  }

  const { rows } = await pool.query(
    `SELECT s.gn_physical_site_arcad as physicalsite, s.CD_DEALER_ARCAD_CODE as podvInfo 
       FROM woc.ang_snowflakes s
      WHERE (s.cd_main_sincom_code = $1 OR s.gn_legal_entity = $1)
        AND s.cd_market_code = $2
        AND s.cd_contract_brand_arcad_code = $3
        AND s.cd_paired_oic_code = $4
      LIMIT 1`,
    [mainSincom, market, arcadBrand, oic],
  );

  if (rows.length === 0) {
    return { physicalSiteId: null, dealerArcadCode: null };
  }

  return {
    physicalSiteId: rows[0].physicalsite,
    dealerArcadCode: rows[0].podvinfo,
  };
}

module.exports = {
  getCountryIsoCode,
  getPhysicalSiteAndSincom,
  getPhysicalSiteAndPdvId,
  resolveArcadBrandCode,
};
