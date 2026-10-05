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
 * voci di controllo veicolo non cancellate (deleted = 0) per il "type"
 * richiesto: se "market" e' valorizzato (non undefined/null/stringa vuota)
 * vengono selezionate SOLO le righe di quel mercato (market = market); se
 * "market" e' assente/vuoto vengono selezionate SOLO le righe comuni, senza
 * mercato (market IS NULL OR market = ''). Nessun fallback/merge tra le due
 * casistiche: sono due insiemi di risultati mutuamente esclusivi.
 *
 * setVehicleInspectionVisible(id, value) e
 * deletetVehicleInspection(id, value) aggiornano rispettivamente i
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
 * setPkMarketEnable/setPkMarketDisable/insertDomain/setDomain/
 * deleteDomain/insertPackage/setPackage/deletePackage operano sulle tabelle
 * woc.hq_pk_market/hq_pk_domain/hq_pk_packages
 * (sql/create_table_hq_packages.sql): gerarchia di configurazione mercato ->
 * dominio -> pacchetto usata per l'amministrazione dei pacchetti HQ (la
 * tabella woc.hq_pk_oic non e' piu' usata: nessuna configurazione di
 * abilitazione a livello di singolo OIC). setPkMarketEnable/Disable fanno
 * un upsert (ON CONFLICT DO UPDATE sulla PK "market") su woc.hq_pk_market.
 * woc.hq_pk_domain NON ha una colonna "oic" (v.
 * sql/alter_table_hq_pk_domain_drop_oic.sql): insertDomain(market, descr)
 * crea domini condivisi da tutti gli OIC del mercato (o globali se market e'
 * assente); la distinzione per singolo OIC resta solo a livello di
 * pacchetto (woc.hq_pk_packages.oic). deleteOicPkHierarchy(market, oic)
 * cancella fisicamente SOLO i pacchetti di quella coppia market+oic (mai i
 * domini, condivisi). deleteDomain cancella logicamente
 * (hq_pk_domain.deleted = 1, v.
 * sql/alter_table_hq_pk_domain_add_deleted.sql) il dominio (market, iddomain)
 * indicato; deletePackage cancella invece fisicamente (DELETE) il pacchetto
 * (idpackage) da woc.hq_pk_packages.
 *
 * setDomainVisible(iddomain, value)/setPackageVisible(idpackage, value)
 * aggiornano il flag "visible" (colonna aggiunta a hq_pk_domain/hq_pk_packages,
 * default 1) rispettivamente del dominio e del pacchetto indicato.
 *
 * getPackageListHQ(market)/getPackageListSM(market, oic) leggono la
 * gerarchia mercato -> dominio -> pacchetto configurata per il mercato
 * (obbligatorio in entrambe) e, per getPackageListSM, anche per l'OIC
 * (obbligatorio, filtro diretto su pk.oic, nessuna tabella hq_pk_oic
 * coinvolta): i domini si agganciano sempre solo per market (condivisi fra
 * tutti gli OIC dello stesso mercato); getPackageListSM restituisce SOLO i
 * pacchetti con pk.oic = oic, getPackageListHQ restituisce SOLO i pacchetti
 * "a livello mercato" (pk.oic IS NULL). I domini cancellati logicamente
 * (deleted = 1) sono esclusi (dom.deleted = 0). Include anche
 * domVisible/pkVisible (hq_pk_domain.visible/hq_pk_packages.visible).
 *
 * clonePk(marketTarget, marketOrig) clona, per il mercato marketOrig, le
 * gerarchie hq_pk_domain/hq_pk_packages nel mercato marketTarget (i domini,
 * condivisi per mercato, vengono clonati una sola volta), rigenerando
 * iddomain/idpackage dalle rispettive sequence e rimappando gli iddomain
 * nei pacchetti clonati per preservare la relazione dominio/pacchetto
 * originale. Esegue tutto in un'unica transazione (BEGIN/COMMIT, ROLLBACK
 * in caso di errore).
 *
 * insertAudit(username, section, market, actiontype, descr) inserisce una
 * riga di log nella tabella di audit woc.hq_audit (creationdate valorizzata
 * automaticamente a CURRENT_DATE).
 *
 * searchAudit(market, section, datefrom, dateto, actiontype, username) legge
 * da woc.hq_audit le righe che soddisfano, in AND, i soli filtri
 * effettivamente valorizzati fra quelli passati (tutti opzionali, username
 * con match case-insensitive parziale), ordinate per creationdate/id
 * decrescente (piu' recenti prima). Se nessun filtro e' valorizzato, il
 * risultato e' limitato alle ultime 100 righe (per creationdate).
 *
 * getAnagSection()/getAnagAllocation() leggono, da S3 (bucket
 * TranslationsBucket, S3ConfigRepository.js), le anagrafiche statiche delle
 * sezioni HQ (config/hq_sections.json) e dei tipi di azione di audit
 * (config/hq_actiontype.json).
 */

/** Codice errore Postgres per violazione di unique/primary key ("unique_violation"). */
const PG_UNIQUE_VIOLATION = '23505';

const { S3ConfigRepository } = require('./S3ConfigRepository');

const s3ConfigRepository = new S3ConfigRepository();

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
 * @param {string} [market] - se valorizzato, filtra sulle sole righe di questo
 *                            mercato (market = market); se assente/vuoto,
 *                            filtra sulle sole righe comuni senza mercato
 *                            (market IS NULL OR market = '')
 * @param {string} type
 * @returns {Promise<Array<{ id: number, market: string|null, type: string, descr: string, visible: number, deleted: number }>>}
 */
async function getVehicleInspection(pool, market, type) {
  if (!type) throw new Error('"type" is required');

  const hasMarket = market !== undefined && market !== null && market !== '';
  const marketCondition = hasMarket ? 'market = $2' : "(market IS NULL OR market = '')";
  const params = hasMarket ? [type, market] : [type];

  const { rows } = await pool.query(
    `SELECT id,
            market,
            type,
            descr,
            visible,
            deleted
       FROM woc.hq_vehicle_inspection
      WHERE type = $1
        AND deleted = 0
        AND ${marketCondition}
      ORDER BY id`,
    params,
  );

  return rows;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} id
 * @param {number} value
 * @param {string} username
 * @param {string} codmarket
 * @returns {Promise<void>}
 */
async function setVehicleInspectionVisible(pool, id, value, username, codmarket) {
  if (id === undefined || id === null) throw new Error('"id" is required');

  await pool.query(
    `UPDATE woc.hq_vehicle_inspection SET visible = $2 WHERE id = $1`,
    [id, value],
  );

  const { rows } = await pool.query(
    `SELECT type,
            descr,
            visible
       FROM woc.hq_vehicle_inspection
      WHERE id = $1`,
    [id],
  );
  const [{ type, descr, visible: enableSignature } = {}] = rows;

  await insertAudit(pool, username, type, codmarket, 'update', `${type} ${descr} enable :${enableSignature}`);
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} id
 * @param {number} value
 * @param {string} username
 * @param {string} codmarket
 * @returns {Promise<void>}
 */
async function deletetVehicleInspection(pool, id, value, username, codmarket) {
  if (id === undefined || id === null) throw new Error('"id" is required');

  await pool.query(
    `UPDATE woc.hq_vehicle_inspection SET deleted = $2 WHERE id = $1`,
    [id, value],
  );

  const { rows } = await pool.query(
    `SELECT type,
            descr,
            visible
       FROM woc.hq_vehicle_inspection
      WHERE id = $1`,
    [id],
  );
  const [{ type, descr } = {}] = rows;

  await insertAudit(pool, username, type, codmarket, 'delete', `deleted ${codmarket} ${descr} `);
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} type
 * @param {string} descr
 * @param {string} username
 * @param {string} codmarket
 * @returns {Promise<void>}
 */
async function insertVehicleInspection(pool, market, type, descr, username, codmarket) {
  if (!type) throw new Error('"type" is required');
  if (!descr) throw new Error('"descr" is required');

  const { rows: insertedRows } = await pool.query(
    `INSERT INTO woc.hq_vehicle_inspection (market, type, descr)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [market, type, descr],
  );
  const [{ id }] = insertedRows;

  const { rows } = await pool.query(
    `SELECT type,
            descr,
            visible
       FROM woc.hq_vehicle_inspection
      WHERE id = $1`,
    [id],
  );
  const [{ type: insertedType, descr: insertedDescr, visible } = {}] = rows;

  await insertAudit(pool, username, insertedType, codmarket, 'insert', `${insertedType} ${insertedDescr} visible: ${visible}`);
}

/**
 * Clona, per il tipo indicato (type), le righe di woc.hq_vehicle_inspection
 * dal mercato marketOrig (eventualmente null/vuoto, cioe' le righe comuni
 * senza mercato) al mercato marketTarget:
 *  1) cancella logicamente (deleted = 1) le righe gia' presenti in
 *     marketTarget per quel type;
 *  2) clona (INSERT) tutte le righe di marketOrig per quel type (descr,
 *     visible, deleted cosi' come sono in origine) con market = marketTarget.
 * L'intera operazione viene eseguita in un'unica transazione (BEGIN/COMMIT
 * su una connessione dedicata, ROLLBACK in caso di errore).
 *
 * @param {import('pg').Pool} pool
 * @param {string} marketTarget
 * @param {string|null} [marketOrig] - se assente/vuoto, clona le righe comuni
 *                                     senza mercato (market IS NULL OR market = '')
 * @param {string} type
 * @returns {Promise<void>}
 */
async function cloneVeicInspection(pool, marketTarget, marketOrig, type) {
  if (!marketTarget) throw new Error('"marketTarget" is required');
  if (!type) throw new Error('"type" is required');

  const hasMarketOrig = marketOrig !== undefined && marketOrig !== null && marketOrig !== '';
  const origCondition = hasMarketOrig ? 'market = $2' : "(market IS NULL OR market = '')";
  const origParams = hasMarketOrig ? [type, marketOrig] : [type];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE woc.hq_vehicle_inspection
          SET deleted = 1
        WHERE market = $1
          AND type = $2`,
      [marketTarget, type],
    );

    const { rows: sourceRows } = await client.query(
      `SELECT descr, visible, deleted
         FROM woc.hq_vehicle_inspection
        WHERE type = $1
          AND ${origCondition}`,
      origParams,
    );
    for (const { descr, visible, deleted } of sourceRows) {
      await client.query(
        `INSERT INTO woc.hq_vehicle_inspection (market, type, descr, visible, deleted)
         VALUES ($1, $2, $3, $4, $5)`,
        [marketTarget, type, descr, visible, deleted],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
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
 * @param {{ market: string, oic: string }[]} pairs - coppie (market, oic) da verificare
 * @returns {Promise<Map<string, boolean>>} mappa "market|oic" -> enablesignature
 *          (true se enablesignature = 1); le coppie assenti dalla mappa
 *          (nessuna riga in hq_application_enabling) sono da considerarsi
 *          NON abilitate (default false, opt-in — a differenza di
 *          getDisabledOics/enablewoc che e' opt-out)
 */
async function getEnableSignatureByOics(pool, pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return new Map();

  const markets = pairs.map((p) => p.market);
  const oics = pairs.map((p) => p.oic);

  const { rows } = await pool.query(
    `SELECT pairs.market, pairs.oic, hae.enablesignature
       FROM unnest($1::varchar[], $2::varchar[]) AS pairs(market, oic)
       JOIN woc.hq_application_enabling hae
         ON hae.market = pairs.market
        AND hae.oic = pairs.oic`,
    [markets, oics],
  );

  return new Map(rows.map((row) => [`${row.market}|${row.oic}`, Number(row.enablesignature) === 1]));
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
 * "market") per il mercato indicato.
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @returns {Promise<void>}
 */
async function setPkMarketEnable(pool, market) {
  await pool.query(
    `INSERT INTO woc.hq_pk_market (market, deleted)
     VALUES ($1, 0)
     ON CONFLICT (market) DO UPDATE SET deleted = 0`,
    [market],
  );
}

/**
 * Disabilita un mercato (woc.hq_pk_market.deleted = 1, upsert sulla PK
 * "market") per il mercato indicato.
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @returns {Promise<void>}
 */
async function setPkMarketDisable(pool, market) {
  await pool.query(
    `INSERT INTO woc.hq_pk_market (market, deleted)
     VALUES ($1, 1)
     ON CONFLICT (market) DO UPDATE SET deleted = 1`,
    [market],
  );
}
/**
 * Verifica se il mercato indicato e' abilitato, leggendo il flag "deleted"
 * di woc.hq_pk_market per il mercato (0 = abilitato, 1 = disabilitato).
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @returns {Promise<number|undefined>} il valore di "deleted" della riga trovata
 */
async function checkIsPkMarketEnabled(pool, market) {
  const { rows } = await pool.query(
    `select deleted from woc.hq_pk_market WHERE market = $1`,
    [market],
  );

  return rows[0]?.deleted;
}

/**
 * Inserisce un nuovo dominio (woc.hq_pk_domain.iddomain generato dalla
 * sequence woc.hq_pk_domain_iddomain_seq). I domini sono condivisi da tutti
 * gli OIC del mercato (woc.hq_pk_domain non ha piu' la colonna "oic", v.
 * sql/alter_table_hq_pk_domain_drop_oic.sql): la distinzione per singolo
 * OIC resta solo a livello di pacchetto (woc.hq_pk_packages.oic).
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} descr
 * @returns {Promise<number>} l'iddomain generato
 */
async function insertDomain(pool, market, descr) {
  const { rows } = await pool.query(
    `INSERT INTO woc.hq_pk_domain (market, descr)
     VALUES (NULLIF($1, ''), $2)
     RETURNING iddomain`,
    [market, descr],
  );

  return rows[0].iddomain;
}

/**
 * Cancella (fisicamente) i pacchetti (woc.hq_pk_packages) configurati per
 * la coppia (market, oic) indicata. I domini (woc.hq_pk_domain) NON vengono
 * toccati: sono condivisi da tutti gli OIC del mercato (v. insertDomain),
 * quindi cancellarli per un singolo oic toglierebbe anche gli altri OIC
 * dello stesso mercato.
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} oic
 * @returns {Promise<void>}
 */
async function deleteOicPkHierarchy(pool, market, oic) {
  if (!market) throw new Error('"market" is required');
  if (!oic) throw new Error('"oic" is required');

  await pool.query(
    `DELETE FROM woc.hq_pk_packages
      WHERE market = $1
        AND oic = $2`,
    [market, oic],
  );
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
 * Cancella (logicamente, woc.hq_pk_domain.deleted = 1) il dominio
 * (market, iddomain) indicato.
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {number} iddomain
 * @returns {Promise<void>}
 */
async function deleteDomain(pool, market, iddomain) {
  if (iddomain === undefined || iddomain === null) throw new Error('"iddomain" is required');

  await pool.query(
    `UPDATE woc.hq_pk_domain
        SET deleted = 1
      WHERE market = $1
        AND iddomain = $2`,
    [market, iddomain],
  );
}

/**
 * Aggiorna il flag "visible" (woc.hq_pk_domain.visible) del dominio con
 * iddomain indicato.
 *
 * @param {import('pg').Pool} pool
 * @param {number} iddomain
 * @param {number} value
 * @returns {Promise<void>}
 */
async function setDomainVisible(pool, iddomain, value) {
  if (iddomain === undefined || iddomain === null) throw new Error('"iddomain" is required');

  await pool.query(
    `UPDATE woc.hq_pk_domain
        SET visible = $2
      WHERE iddomain = $1`,
    [iddomain, value],
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
  if (iddomain === undefined || iddomain === null) throw new Error('"iddomain" is required');

  const { rows } = await pool.query(
    `INSERT INTO woc.hq_pk_packages (market, oic, iddomain, descr, timeop, pricewithvat)
     VALUES (NULLIF($1, ''), $2, $3, $4, $5, $6)
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

/**
 * Cancella (fisicamente) il pacchetto con idpackage indicato da
 * woc.hq_pk_packages (idpackage e' univoco a livello globale, generato dalla
 * sequence woc.hq_pk_packages_idpackage_seq).
 *
 * @param {import('pg').Pool} pool
 * @param {number} idpackage
 * @returns {Promise<void>}
 */
async function deletePackage(pool, idpackage) {
  if (idpackage === undefined || idpackage === null) throw new Error('"idpackage" is required');

  await pool.query(
    `DELETE FROM woc.hq_pk_packages
      WHERE idpackage = $1`,
    [idpackage],
  );
}

/**
 * Aggiorna il flag "visible" (woc.hq_pk_packages.visible) del pacchetto con
 * idpackage indicato.
 *
 * @param {import('pg').Pool} pool
 * @param {number} idpackage
 * @param {number} value
 * @returns {Promise<void>}
 */
async function setPackageVisible(pool, idpackage, value) {
  if (idpackage === undefined || idpackage === null) throw new Error('"idpackage" is required');

  await pool.query(
    `UPDATE woc.hq_pk_packages
        SET visible = $2
      WHERE idpackage = $1`,
    [idpackage, value],
  );
}


/**
 * Elenca la gerarchia mercato -> dominio -> pacchetto "a livello mercato"
 * (nessun OIC) configurata per un mercato, usata dall'amministrazione
 * pacchetti HQ (woc.hq_pk_market/hq_pk_domain/hq_pk_packages; la tabella
 * woc.hq_pk_oic non e' piu' usata).
 *
 * woc.hq_pk_domain non ha piu' la colonna "oic" (v.
 * sql/alter_table_hq_pk_domain_drop_oic.sql): i domini sono condivisi da
 * tutti gli OIC del mercato e si agganciano quindi solo per market. Vengono
 * restituiti SOLO i pacchetti non legati a nessun OIC (pk.oic IS NULL); per
 * i pacchetti di un singolo OIC v. getPackageListSM. I domini cancellati
 * logicamente (dom.deleted = 1) sono sempre esclusi (dom.deleted = 0).
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @returns {Promise<Array<{ market: string, oic: null, domainDescr: string|null, domVisible: number|null, idpackage: number|null, packageDescr: string|null, timeop: number|null, pricewithvat: number|null, pkVisible: number|null }>>}
 */
async function getPackageListHQ(pool, market) {
  if (!market) throw new Error('"market" is required');

  const selectColumns = `dom.iddomain
                          , dom.descr AS domaindescr
                          , dom.visible AS domvisible
                          , pk.idpackage
                          , pk.descr AS packagedescr
                          , pk.timeop
                          , pk.pricewithvat
                          , pk.visible AS pkvisible`;

  const sql = `SELECT mk.market, NULL::varchar AS oic, ${selectColumns}
             FROM woc.hq_pk_market mk
             LEFT JOIN woc.hq_pk_domain dom ON dom.market = mk.market AND dom.deleted = 0
             LEFT JOIN woc.hq_pk_packages pk ON pk.market = mk.market AND pk.oic IS NULL AND pk.iddomain = dom.iddomain
           WHERE mk.market = $1`;

  const { rows } = await pool.query(sql, [market]);

  return rows.map((row) => ({
    market: row.market,
    oic: row.oic,
    iddomain: row.iddomain,
    domainDescr: row.domaindescr,
    domVisible: row.domvisible,
    idpackage: row.idpackage,
    packageDescr: row.packagedescr,
    timeop: row.timeop,
    pricewithvat: row.pricewithvat,
    pkVisible: row.pkvisible,
  }));
}

/**
 * Elenca la gerarchia mercato -> dominio -> pacchetto configurata per un
 * singolo OIC di un mercato, usata dall'amministrazione pacchetti HQ
 * (woc.hq_pk_market/hq_pk_domain/hq_pk_packages; la tabella woc.hq_pk_oic
 * non e' piu' usata).
 *
 * woc.hq_pk_domain non ha piu' la colonna "oic" (v.
 * sql/alter_table_hq_pk_domain_drop_oic.sql): i domini sono condivisi da
 * tutti gli OIC del mercato e si agganciano quindi solo per market. I
 * pacchetti restituiti sono invece SOLO quelli dello specifico oic
 * richiesto (pk.oic = oic, senza alcun controllo su hq_pk_oic); per i
 * pacchetti "a livello mercato" (nessun OIC) v. getPackageListHQ. I domini
 * cancellati logicamente (dom.deleted = 1) sono sempre esclusi
 * (dom.deleted = 0).
 *
 * @param {import('pg').Pool} pool
 * @param {string} market
 * @param {string} oic
 * @returns {Promise<Array<{ market: string, oic: string, domainDescr: string|null, domVisible: number|null, idpackage: number|null, packageDescr: string|null, timeop: number|null, pricewithvat: number|null, pkVisible: number|null }>>}
 */
async function getPackageListSM(pool, market, oic) {
  if (!market) throw new Error('"market" is required');
  if (!oic) throw new Error('"oic" is required');

  const selectColumns = `dom.iddomain
                          , dom.descr AS domaindescr
                          , dom.visible AS domvisible
                          , pk.idpackage
                          , pk.descr AS packagedescr
                          , pk.timeop
                          , pk.pricewithvat
                          , pk.visible AS pkvisible`;

  const sql = `SELECT mk.market, $2::varchar AS oic, ${selectColumns}
             FROM woc.hq_pk_market mk
             LEFT JOIN woc.hq_pk_domain dom ON dom.market = mk.market AND dom.deleted = 0
             LEFT JOIN woc.hq_pk_packages pk ON pk.market = mk.market AND pk.oic = $2 AND pk.iddomain = dom.iddomain
           WHERE mk.market = $1`;

  const { rows } = await pool.query(sql, [market, oic]);

  return rows.map((row) => ({
    market: row.market,
    oic: row.oic,
    iddomain: row.iddomain,
    domainDescr: row.domaindescr,
    domVisible: row.domvisible,
    idpackage: row.idpackage,
    packageDescr: row.packagedescr,
    timeop: row.timeop,
    pricewithvat: row.pricewithvat,
    pkVisible: row.pkvisible,
  }));
}

/**
 * Clona, per il mercato indicato (marketOrig), le gerarchie
 * hq_pk_domain/hq_pk_packages in un nuovo mercato (marketTarget) (la
 * tabella woc.hq_pk_oic non e' piu' usata, nessuna riga da clonare).
 * I domini (condivisi da tutti gli OIC del mercato, v. insertDomain) vengono
 * clonati una sola volta per mercato (non piu' una volta per oic).
 *
 * iddomain/idpackage sono generati dalle rispettive sequence
 * (hq_pk_domain_iddomain_seq/hq_pk_packages_idpackage_seq): i nuovi
 * iddomain vengono quindi rimappati (vecchio -> nuovo) prima di clonare i
 * pacchetti, in modo da mantenere la relazione dominio/pacchetto del
 * mercato originale anche nel mercato clonato.
 *
 * L'intera operazione viene eseguita in un'unica transazione
 * (BEGIN/COMMIT su una connessione dedicata, ROLLBACK in caso di errore),
 * cosi' da non lasciare dati parzialmente clonati.
 *
 * @param {import('pg').Pool} pool
 * @param {string} marketTarget
 * @param {string} marketOrig
 * @returns {Promise<void>}
 */
async function clonePk(pool, marketTarget, marketOrig) {
  if (!marketTarget) throw new Error('"marketTarget" is required');
  if (!marketOrig) throw new Error('"marketOrig" is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: domainRows } = await client.query(
      `SELECT iddomain, descr, deleted FROM woc.hq_pk_domain WHERE market = $1`,
      [marketOrig],
    );
    const iddomainMap = new Map();
    for (const { iddomain, descr, deleted } of domainRows) {
      const { rows } = await client.query(
        `INSERT INTO woc.hq_pk_domain (market, descr, deleted)
         VALUES ($1, $2, $3)
         RETURNING iddomain`,
        [marketTarget, descr, deleted],
      );
      iddomainMap.set(iddomain, rows[0].iddomain);
    }

    const { rows: packageRows } = await client.query(
      `SELECT oic, iddomain, descr, timeop, pricewithvat FROM woc.hq_pk_packages WHERE market = $1`,
      [marketOrig],
    );
    for (const { oic, iddomain, descr, timeop, pricewithvat } of packageRows) {
      await client.query(
        `INSERT INTO woc.hq_pk_packages (market, oic, iddomain, descr, timeop, pricewithvat)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [marketTarget, oic, iddomainMap.get(iddomain), descr, timeop, pricewithvat],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Inserisce una riga di audit in woc.hq_audit (creationdate = CURRENT_DATE).
 *
 * @param {import('pg').Pool} pool
 * @param {string} username
 * @param {string} section
 * @param {string} market
 * @param {string} actiontype
 * @param {string} descr
 * @returns {Promise<void>}
 */
async function insertAudit(pool, username, section, market, actiontype, descr) {
  if (!username) throw new Error('"username" is required');
  if (!section) throw new Error('"section" is required');
  if (!actiontype) throw new Error('"actiontype" is required');

  await pool.query(
    `INSERT INTO woc.hq_audit (username, creationdate, section, market, actiontype, descr)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)`,
    [username, section, market, actiontype, descr],
  );
}

/**
 * Legge da woc.hq_audit le righe che soddisfano, in AND, i soli filtri
 * effettivamente valorizzati fra market/section/datefrom/dateto/actiontype/
 * username (tutti opzionali), ordinate per creationdate/id decrescente.
 * `username` e' un match parziale case-insensitive (UPPER(username) LIKE
 * UPPER('%...%')), a differenza degli altri filtri (uguaglianza esatta).
 * Se nessun filtro e' valorizzato (ricerca senza criteri), il risultato e'
 * limitato alle ultime 100 righe (LIMIT 100, per creationdate/id
 * decrescente).
 *
 * @param {import('pg').Pool} pool
 * @param {string} [market]
 * @param {string} [section]
 * @param {string|Date} [datefrom]
 * @param {string|Date} [dateto]
 * @param {string} [actiontype]
 * @param {string} [username]
 * @returns {Promise<Array<{ id: number, username: string|null, creationdate: string|null, section: string|null, market: string|null, actiontype: string|null, descr: string|null }>>}
 */
async function searchAudit(pool, market, section, datefrom, dateto, actiontype, username) {
  const conditions = [];
  const params = [];

  if (market) {
    params.push(market);
    conditions.push(`market = $${params.length}`);
  }
  if (section) {
    params.push(section);
    conditions.push(`section = $${params.length}`);
  }
  if (datefrom) {
    params.push(datefrom);
    conditions.push(`creationdate >= $${params.length}`);
  }
  if (dateto) {
    params.push(dateto);
    conditions.push(`creationdate <= $${params.length}`);
  }
  if (actiontype) {
    params.push(actiontype);
    conditions.push(`actiontype = $${params.length}`);
  }
  if (username) {
    params.push(`%${username}%`);
    conditions.push(`UPPER(username) LIKE UPPER($${params.length})`);
  }

  const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = conditions.length ? '' : ' LIMIT 100';

  const { rows } = await pool.query(
    `SELECT id, username, creationdate, section, market, actiontype, descr
       FROM woc.hq_audit${whereClause}
      ORDER BY creationdate DESC, id DESC${limitClause}`,
    params,
  );

  return rows;
}

/**
 * Elenco delle sezioni HQ (config/hq_sections.json su S3, TranslationsBucket).
 *
 * @returns {Promise<Array<{ section: string }>>}
 */
async function getAnagSection() {
  return s3ConfigRepository.getAnagSection();
}

/**
 * Elenco dei tipi di azione di audit (config/hq_actiontype.json su S3,
 * TranslationsBucket).
 *
 * @returns {Promise<Array<{ type: string }>>}
 */
async function getAnagAllocation() {
  return s3ConfigRepository.getAnagAllocation();
}

module.exports = {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspection,
  insertVehicleInspection,
  cloneVeicInspection,
  getDisabledOics,
  getEnableSignatureByOics,
  getAddressByOics,
  setPkMarketEnable,
  setPkMarketDisable,
  checkIsPkMarketEnabled,
  insertDomain,
  deleteOicPkHierarchy,
  setDomain,
  deleteDomain,
  setDomainVisible,
  insertPackage,
  setPackage,
  deletePackage,
  setPackageVisible,
  getPackageListHQ,
  getPackageListSM,
  clonePk,
  insertAudit,
  searchAudit,
  getAnagSection,
  getAnagAllocation,
};
