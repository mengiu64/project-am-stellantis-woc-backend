'use strict';

/**
 * AnagSnowflakesRepository.js — Query SQL sulla tabella woc.ang_snowflakes (Aurora
 * PostgreSQL, db "wiadvisor", schema "woc"), snapshot dell'estrazione Snowflake
 * "M2m-queries" (anagrafica siti/contratti M2M brand/activity/status WebDAC-ARCAD).
 *
 * getCountryIsoCode risolve il codice ISO del paese del dealer (colonna
 * cd_dealer_country_iso_code) a partire dal codice mercato (cd_market_code).
 *
 * getMarkets risolve l'elenco DISTINCT dei mercati (cd_market_code/gn_country_name),
 * senza filtro o per un sottoinsieme di codici mercato — usata da session
 * (src/hqMarketsResolver.js) per valorizzare `hqMarketsList` degli utenti HQ.
 *
 * getPhysicalSiteAndSincom risolve, a partire da mainSincom/market/brand (dati
 * già disponibili da session/jobCardDetails), il physicalSiteId del Sender
 * DMS (cd_paired_oic_code, sempre valorizzata — a differenza di
 * gn_physical_site_arcad che talvolta vale il placeholder "NOT FOUND in
 * PCOD"), il sincom di brand (cd_sincom_code) e il codice dealer ARCAD
 * (cd_dealer_arcad_code) — usati per completare in modo dinamico il Sender
 * dell'inquiry DMS (physicalSiteId/dealerNumberIdSource), invece dei valori
 * statici configurati via env in dms/config.js.
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
 *
 * Tutte le query filtrano sempre fl_is_deleted_flag = 0, escludendo le righe
 * cancellate logicamente dalla sorgente Snowflake (fl_is_deleted_flag = 1).
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
        AND s.fl_is_deleted_flag = 0
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
        AND s.fl_is_deleted_flag = 0
      LIMIT 1`,
    [market],
  );

  return rows.length > 0 ? rows[0].cd_dealer_country_iso_code : null;
}

/**
 * Risolve physicalSiteId (cd_paired_oic_code), dealerNumberIdSource
 * (cd_sincom_code) e dealerArcadCode (cd_dealer_arcad_code) per il Sender
 * dinamico dell'inquiry DMS, a partire da mainSincom
 * (cd_main_sincom_code/gn_legal_entity, es. session.sincom/MAINSINCOM),
 * market (cd_market_code, es. session.codmarket) e brand (jobCardDetail.roInfo,
 * es. stellantisBrand "FT" o brand "55").
 *
 * physicalSiteId era precedentemente mappato su gn_physical_site_arcad: è
 * stato spostato su cd_paired_oic_code (sempre valorizzata, a differenza di
 * gn_physical_site_arcad che talvolta contiene il placeholder "NOT FOUND in
 * PCOD") — cambio richiesto per tutti i chiamanti di postDmsInquiry, dato che
 * il lookup è centralizzato in dms/dmsService.js::buildApplicationArea.
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
    `SELECT s.cd_paired_oic_code, s.cd_sincom_code, s.cd_dealer_arcad_code
       FROM woc.ang_snowflakes s
      WHERE (s.cd_main_sincom_code = $1 OR s.gn_legal_entity = $1)
        AND s.cd_market_code = $2
        AND s.cd_contract_brand_arcad_code = $3
        AND s.fl_is_deleted_flag = 0
      LIMIT 1`,
    [mainSincom, market, arcadBrand],
  );

  if (rows.length === 0) {
    return { physicalSiteId: null, dealerNumberIdSource: null, dealerArcadCode: null };
  }

  return {
    physicalSiteId: rows[0].cd_paired_oic_code,
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
        AND s.fl_is_deleted_flag = 0
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

/**
 * Risolve, per un elenco di oic (cd_paired_oic_code, es. il campo CODE di
 * ciascun elemento di User.OICs di myPeople), l'elenco dei codici brand
 * WebDAC (cd_contract_brand_webdac_code) effettivamente contrattualizzati
 * per quel sito, aggregati in un'unica query batch (un solo round-trip per
 * tutti gli oic dell'utente, invece di una query per oic) — usato da
 * MyPeopleDmsSessionRepository per sovrascrivere il campo `brands` di
 * ciascun oic di session (in origine il CSV fornito da myPeople) con
 * l'elenco effettivo/aggiornato letto da woc.ang_snowflakes.
 *
 * @param {import('pg').Pool} pool
 * @param {{ oics: string[] }} params - elenco di cd_paired_oic_code da risolvere
 * @returns {Promise<Map<string, string[]>>} mappa oic -> array di codici brand
 *          WebDAC distinti (es. ["30", "31"]); un oic senza righe
 *          corrispondenti in woc.ang_snowflakes non compare nella mappa (il
 *          chiamante deve gestire il default per gli oic assenti)
 */
async function getBrandsByOics(pool, { oics } = {}) {
  if (!Array.isArray(oics) || oics.length === 0) return new Map();

  const { rows } = await pool.query(
    `SELECT s.cd_paired_oic_code AS oic
          , array_agg(DISTINCT s.cd_contract_brand_webdac_code ORDER BY s.cd_contract_brand_webdac_code) AS brands
       FROM woc.ang_snowflakes s
      WHERE s.cd_paired_oic_code = ANY($1::varchar[])
        AND s.cd_contract_brand_webdac_code IS NOT NULL
        AND s.fl_is_deleted_flag = 0
      GROUP BY s.cd_paired_oic_code`,
    [oics],
  );

  const brandsByOic = new Map();
  for (const row of rows) {
    brandsByOic.set(row.oic, Array.isArray(row.brands) ? row.brands : []);
  }
  return brandsByOic;
}

/**
 * Risolve l'elenco (DISTINCT) dei mercati presenti in woc.ang_snowflakes,
 * coppie cd_market_code/gn_country_name — usato da session
 * (src/hqMarketsResolver.js) per valorizzare `hqMarketsList` nella risposta
 * di sessione degli utenti HQ:
 *  - HQ centrale: nessun filtro, TUTTI i mercati distinti;
 *  - HQ mercato: `markets` valorizzato con il singolo codice mercato ricavato
 *    dal ruolo (es. "3109"), per risolverne la descrizione (gn_country_name).
 *
 * NOTA: `gn_country_name` NON esiste su woc.ang_snowflakes (colonna presente
 * solo su woc.addr_snowflakes): la descrizione del mercato viene quindi
 * risolta con un LEFT JOIN su woc.addr_snowflakes (stesso cd_market_code,
 * fl_is_deleted_flag = 0), cosi' da restituire comunque tutti i mercati noti
 * ad ang_snowflakes anche quando addr_snowflakes non ha (ancora) righe per
 * quel mercato (description: null in quel caso, mai un errore).
 *
 * @param {import('pg').Pool} pool
 * @param {{ markets?: string[] }} [params] - se valorizzato, filtra solo questi cd_market_code
 * @returns {Promise<Array<{ market: string, description: string|null }>>}
 */
async function getMarkets(pool, { markets } = {}) {
  const hasFilter = Array.isArray(markets) && markets.length > 0;

  const { rows } = await pool.query(
    `SELECT DISTINCT a.cd_market_code AS market, ad.gn_country_name AS description
       FROM woc.ang_snowflakes a
       LEFT JOIN woc.addr_snowflakes ad
         ON ad.cd_market_code = a.cd_market_code AND ad.fl_is_deleted_flag = 0
      WHERE a.fl_is_deleted_flag = 0
        ${hasFilter ? 'AND a.cd_market_code = ANY($1::varchar[])' : ''}
      ORDER BY a.cd_market_code`,
    hasFilter ? [markets] : [],
  );

  return rows;
}

module.exports = {
  getCountryIsoCode,
  getPhysicalSiteAndSincom,
  getPhysicalSiteAndPdvId,
  getBrandsByOics,
  getMarkets,
  resolveArcadBrandCode,
};
