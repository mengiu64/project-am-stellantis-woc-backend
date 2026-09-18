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
 * getVehicleInspection(market, type) legge da woc.hq_vehicle_inspection le
 * voci di controllo veicolo non cancellate per il "type" richiesto, con
 * priorita' alla riga specifica del mercato ("market") su quella comune
 * (market NULL): per ogni coppia (descr, type) viene tenuta una sola riga
 * (ROW_NUMBER() PARTITION BY descr, type) scegliendo, in ordine, il match sul
 * mercato, poi la riga condivisa (market NULL), scartando eventuali righe di
 * altri mercati.
 *
 * setVehicleInspectionVisible(id, value) e
 * deletetVehicleInspectionVisible(id, value) aggiornano rispettivamente i
 * flag "visible" e "deleted" della riga con il dato "id".
 *
 * insertVehicleInspection(market, type, descr) inserisce una nuova voce di
 * controllo veicolo.
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
 * @param {string} market
 * @param {string} type
 * @returns {Promise<Array<{ id: number, market: string|null, type: string, descr: string, visible: number, deleted: number }>>}
 */
async function getVehicleInspection(pool, market, type) {
  if (!type) throw new Error('"type" is required');

  const { rows } = await pool.query(
    `SELECT id,
            market,
            type,
            descr,
            visible,
            deleted
       FROM (
         SELECT t.*,
                ROW_NUMBER() OVER (
                    PARTITION BY descr, type
                    ORDER BY CASE
                               WHEN market = $1 THEN 1
                               WHEN market IS NULL THEN 2
                               ELSE 3
                             END
                ) rn
           FROM woc.hq_vehicle_inspection t
          WHERE t.type = $2
            AND t.deleted = 0
            AND (t.market = $1 OR t.market IS NULL)
       ) x
      WHERE rn = 1
      ORDER BY id`,
    [market, type],
  );

  return rows;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} id
 * @param {number} value
 * @returns {Promise<void>}
 */
async function setVehicleInspectionVisible(pool, id, value) {
  if (id === undefined || id === null) throw new Error('"id" is required');

  await pool.query(
    `UPDATE woc.hq_vehicle_inspection SET visible = $2 WHERE id = $1`,
    [id, value],
  );
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} id
 * @param {number} value
 * @returns {Promise<void>}
 */
async function deletetVehicleInspectionVisible(pool, id, value) {
  if (id === undefined || id === null) throw new Error('"id" is required');

  await pool.query(
    `UPDATE woc.hq_vehicle_inspection SET deleted = $2 WHERE id = $1`,
    [id, value],
  );
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} type
 * @param {string} descr
 * @returns {Promise<void>}
 */
async function insertVehicleInspection(pool, market, type, descr) {
  if (!type) throw new Error('"type" is required');
  if (!descr) throw new Error('"descr" is required');

  await pool.query(
    `INSERT INTO woc.hq_vehicle_inspection (market, type, descr)
     VALUES ($1, $2, $3)`,
    [market, type, descr],
  );
}

module.exports = {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspectionVisible,
  insertVehicleInspection,
};
