'use strict';

/**
 * HqRepository.js — Query SQL sulle tabelle woc.ang_snowflakes / woc.addr_snowflakes /
 * woc.hq_application_enabling (Aurora PostgreSQL, db "wiadvisor", schema "woc"),
 * stessa logica di accesso al DB di AnagSnowflakesRepository.js (pool "pg"
 * iniettato dal chiamante, query parametrizzate).
 *
 * getEnablingConfiguration(codmarket) incrocia l'anagrafica siti/contratti
 * (ang_snowflakes) con l'anagrafica indirizzi (addr_snowflakes) sullo stesso
 * sito (cd_unique_site_code / cd_site_identification_code) e recupera, in
 * LEFT JOIN, l'eventuale configurazione di abilitazione WOC/firma per l'OIC
 * del sito (hq_application_enabling), con COALESCE a 0 quando non e' ancora
 * stata configurata.
 *
 * setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature) fa
 * l'upsert della configurazione di abilitazione: (codmarket, oic) sono PK di
 * woc.hq_application_enabling, quindi si tenta prima un INSERT e, se questo
 * fallisce per violazione della chiave primaria (record gia' esistente), si
 * esegue un UPDATE dei soli campi enablewoc/enablesignature per la riga
 * (market, oic) gia' presente.
 *
 * getDisabledOics(pairs) risolve, per un elenco di coppie (market, oic), gli
 * OIC esplicitamente disabilitati per WOC (enablewoc = 0), usata da session
 * (MyPeopleDmsSessionRepository) per togliere dall'elenco `oics` quelli non
 * abilitati. A differenza di getEnablingConfiguration() (usata dall'endpoint
 * admin, che ritorna enableWOC=0 quando manca la riga di configurazione),
 * qui una coppia (market, oic) SENZA riga in hq_application_enabling e'
 * considerata abilitata di default (opt-out): un oic viene escluso dalla
 * sessione SOLO se esiste esplicitamente una riga con enablewoc = 0.
 *
 * getAddressByOics(oics) risolve, per un elenco di oic (cd_paired_oic_code),
 * l'indirizzo del sito letto da woc.addr_snowflakes (stesso join
 * ang_snowflakes/addr_snowflakes di getEnablingConfiguration), in un'unica
 * query batch: address <- gn_address_1, zipcode <- cd_zip_code, city <-
 * gn_town. Usata da session (MyPeopleDmsSessionRepository) per sovrascrivere
 * address/zipcode/city di ciascun oic.
 */

/** Codice errore Postgres per violazione di unique/primary key ("unique_violation"). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * @param {import('pg').Pool} pool
 * @param {string} codmarket
 * @returns {Promise<Array<{ siteName: string|null, oic: string|null, address: string|null, legalEntity: string|null, enableWOC: number, enableSignature: number }>>}
 */
async function getEnablingConfiguration(pool, codmarket) {
  if (!codmarket) throw new Error('"codmarket" is required');

  const { rows } = await pool.query(
    `SELECT DISTINCT t2.gn_site_name, t.cd_paired_oic_code, t2.gn_address_1, t.gn_legal_entity
                    , COALESCE(hae.enablewoc, 0) AS enablewoc
                    , COALESCE(hae.enablesignature, 0) AS enablesignature
       FROM woc.ang_snowflakes t
       JOIN woc.addr_snowflakes t2 ON t.cd_unique_site_code = t2.cd_site_identification_code
       LEFT JOIN woc.hq_application_enabling hae ON hae.oic = t.cd_paired_oic_code
      WHERE t.cd_market_code = $1`,
    [codmarket],
  );

  return rows.map((row) => ({
    siteName: row.gn_site_name,
    oic: row.cd_paired_oic_code,
    address: row.gn_address_1,
    legalEntity: row.gn_legal_entity,
    enableWOC: row.enablewoc,
    enableSignature: row.enablesignature,
  }));
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} codmarket
 * @param {string} oic
 * @param {number} enableWOC
 * @param {number} enableSignature
 * @returns {Promise<void>}
 */
async function setEnablingConfiguration(pool, codmarket, oic, enableWOC, enableSignature) {
  if (!codmarket) throw new Error('"codmarket" is required');
  if (!oic) throw new Error('"oic" is required');

  try {
    await pool.query(
      `INSERT INTO woc.hq_application_enabling (market, oic, enablewoc, enablesignature)
       VALUES ($1, $2, $3, $4)`,
      [codmarket, oic, enableWOC, enableSignature],
    );
  } catch (err) {
    if (err.code !== PG_UNIQUE_VIOLATION) throw err;

    await pool.query(
      `UPDATE woc.hq_application_enabling
          SET enablewoc = $3, enablesignature = $4
        WHERE market = $1
          AND oic = $2`,
      [codmarket, oic, enableWOC, enableSignature],
    );
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ market: string, oic: string }[]} pairs - coppie (market, oic) da verificare
 * @returns {Promise<Set<string>>} set di chiavi "market|oic" esplicitamente
 *          disabilitate (enablewoc = 0); le coppie assenti dal set sono da
 *          considerarsi abilitate (default opt-out, v. sopra)
 */
async function getDisabledOics(pool, pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return new Set();

  const markets = pairs.map((p) => p.market);
  const oics = pairs.map((p) => p.oic);

  const { rows } = await pool.query(
    `SELECT pairs.market, pairs.oic
       FROM unnest($1::varchar[], $2::varchar[]) AS pairs(market, oic)
       JOIN woc.hq_application_enabling hae
         ON hae.market = pairs.market
        AND hae.oic = pairs.oic
      WHERE hae.enablewoc = 0`,
    [markets, oics],
  );

  return new Set(rows.map((row) => `${row.market}|${row.oic}`));
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ oics: string[] }} params - elenco di cd_paired_oic_code da risolvere
 * @returns {Promise<Map<string, { address: string|null, zipcode: string|null, city: string|null }>>}
 *          mappa oic -> indirizzo del sito; un oic senza riga corrispondente
 *          in woc.ang_snowflakes/woc.addr_snowflakes non compare nella mappa
 *          (il chiamante deve gestire il default per gli oic assenti)
 */
async function getAddressByOics(pool, { oics } = {}) {
  if (!Array.isArray(oics) || oics.length === 0) return new Map();

  const { rows } = await pool.query(
    `SELECT DISTINCT s.cd_paired_oic_code AS oic
                    , a.gn_address_1 AS address
                    , a.cd_zip_code AS zipcode
                    , a.gn_town AS city
       FROM woc.ang_snowflakes s
       JOIN woc.addr_snowflakes a ON s.cd_unique_site_code = a.cd_site_identification_code
      WHERE s.cd_paired_oic_code = ANY($1::varchar[])`,
    [oics],
  );

  const addressByOic = new Map();
  for (const row of rows) {
    addressByOic.set(row.oic, {
      address: row.address ?? null,
      zipcode: row.zipcode ?? null,
      city: row.city ?? null,
    });
  }
  return addressByOic;
}

module.exports = {
  getEnablingConfiguration, setEnablingConfiguration, getDisabledOics, getAddressByOics,
};
