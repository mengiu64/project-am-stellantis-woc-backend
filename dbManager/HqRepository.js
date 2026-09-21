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
 *
 * Entrambe le query su woc.ang_snowflakes filtrano fl_is_deleted_flag = 0,
 * escludendo le righe cancellate logicamente dalla sorgente Snowflake
 * (fl_is_deleted_flag = 1).
 *
 * setMarketEnable/setMarketDisable/setOicEnable/insertDomain/setDomain/
 * insertPackage/setPackage operano sulle tabelle woc.hq_pk_market/
 * hq_pk_oic/hq_pk_domain/hq_pk_packages (sql/create_table_hq_packages.sql):
 * gerarchia di configurazione mercato -> OIC -> dominio -> pacchetto usata
 * per l'amministrazione dei pacchetti HQ. Gli upsert su hq_pk_market/
 * hq_pk_oic usano ON CONFLICT DO UPDATE sulla PK (market / market+oic).
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
      WHERE t.cd_market_code = $1
        AND t.fl_is_deleted_flag = 0`,
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
      WHERE s.cd_paired_oic_code = ANY($1::varchar[])
        AND s.fl_is_deleted_flag = 0`,
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

/**
 * Abilita un mercato (woc.hq_pk_market.deleted = 0, upsert sulla PK
 * "market") e disabilita a cascata tutti i suoi OIC (woc.hq_pk_oic.deleted
 * = 1) per il mercato indicato.
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @returns {Promise<void>}
 */
async function setMarketEnable(pool, market) {
  if (!market) throw new Error('"market" is required');

  await pool.query(
    `INSERT INTO woc.hq_pk_market (market, deleted)
     VALUES ($1, 0)
     ON CONFLICT (market) DO UPDATE SET deleted = 0`,
    [market],
  );

  await pool.query(
    `UPDATE woc.hq_pk_oic SET deleted = 1 WHERE market = $1`,
    [market],
  );
}

/**
 * Disabilita un mercato (woc.hq_pk_market.deleted = 1, upsert sulla PK
 * "market") e riabilita tutti i suoi OIC (woc.hq_pk_oic.deleted = 0) per il
 * mercato indicato.
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @returns {Promise<void>}
 */
async function setMarketDisable(pool, market) {
  if (!market) throw new Error('"market" is required');

  await pool.query(
    `INSERT INTO woc.hq_pk_market (market, deleted)
     VALUES ($1, 1)
     ON CONFLICT (market) DO UPDATE SET deleted = 1`,
    [market],
  );

  await pool.query(
    `UPDATE woc.hq_pk_oic SET deleted = 0 WHERE market = $1`,
    [market],
  );
}

/**
 * Abilita un OIC (woc.hq_pk_oic.deleted = 0), upsert sulla PK
 * "market, oic".
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} oic
 * @returns {Promise<void>}
 */
async function setOicEnable(pool, market, oic) {
  if (!market) throw new Error('"market" is required');
  if (!oic) throw new Error('"oic" is required');

  await pool.query(
    `INSERT INTO woc.hq_pk_oic (market, oic, deleted)
     VALUES ($1, $2, 0)
     ON CONFLICT (market, oic) DO UPDATE SET deleted = 0`,
    [market, oic],
  );
}

/**
 * Inserisce un nuovo dominio (woc.hq_pk_domain.iddomain generato dalla
 * sequence woc.hq_pk_domain_iddomain_seq).
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} oic
 * @param {string} descr
 * @returns {Promise<number>} l'iddomain generato
 */
async function insertDomain(pool, market, oic, descr) {
  if (!market) throw new Error('"market" is required');

  const { rows } = await pool.query(
    `INSERT INTO woc.hq_pk_domain (market, oic, descr)
     VALUES ($1, $2, $3)
     RETURNING iddomain`,
    [market, oic, descr],
  );

  return rows[0].iddomain;
}

/**
 * Modifica la descr del dominio (market, iddomain).
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {number} iddomain
 * @param {string} descr
 * @returns {Promise<void>}
 */
async function setDomain(pool, market, iddomain, descr) {
  if (!market) throw new Error('"market" is required');
  if (iddomain === undefined || iddomain === null) throw new Error('"iddomain" is required');

  await pool.query(
    `UPDATE woc.hq_pk_domain
        SET descr = $3
      WHERE market = $1
        AND iddomain = $2`,
    [market, iddomain, descr],
  );
}

/**
 * Inserisce un nuovo pacchetto (woc.hq_pk_packages.idpackage generato dalla
 * sequence woc.hq_pk_packages_idpackage_seq).
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} oic
 * @param {number} iddomain
 * @param {string} descr
 * @param {number} timeop
 * @param {number} pricewithvat
 * @returns {Promise<number>} l'idpackage generato
 */
async function insertPackage(pool, market, oic, iddomain, descr, timeop, pricewithvat) {
  if (!market) throw new Error('"market" is required');
  if (iddomain === undefined || iddomain === null) throw new Error('"iddomain" is required');

  const { rows } = await pool.query(
    `INSERT INTO woc.hq_pk_packages (market, oic, iddomain, descr, timeop, pricewithvat)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING idpackage`,
    [market, oic, iddomain, descr, timeop, pricewithvat],
  );

  return rows[0].idpackage;
}

/**
 * Modifica iddomain/descr/timeop/pricewithvat del pacchetto con idpackage
 * indicato (idpackage e' univoco a livello globale, generato dalla sequence
 * woc.hq_pk_packages_idpackage_seq).
 *
 * @param {import('pg').Pool} pool
 * @param {number} idpackage
 * @param {number} iddomain
 * @param {string} descr
 * @param {number} timeop
 * @param {number} pricewithvat
 * @returns {Promise<void>}
 */
async function setPackage(pool, idpackage, iddomain, descr, timeop, pricewithvat) {
  if (idpackage === undefined || idpackage === null) throw new Error('"idpackage" is required');
  if (iddomain === undefined || iddomain === null) throw new Error('"iddomain" is required');

  await pool.query(
    `UPDATE woc.hq_pk_packages
        SET iddomain = $2,
            descr = $3,
            timeop = $4,
            pricewithvat = $5
      WHERE idpackage = $1`,
    [idpackage, iddomain, descr, timeop, pricewithvat],
  );
}

module.exports = {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspectionVisible,
  insertVehicleInspection,
  getDisabledOics,
  getAddressByOics,
  setMarketEnable,
  setMarketDisable,
  setOicEnable,
  insertDomain,
  setDomain,
  insertPackage,
  setPackage,
};
