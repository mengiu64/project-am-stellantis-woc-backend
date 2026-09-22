'use strict';

const path = require('path');

/**
 * HqManager.js — wrapper applicativo su dbManager/HqRepository.js (Aurora
 * PostgreSQL, db "wiadvisor", schema "woc"), stesso pattern di
 * PkManager.js/getConfigPackages: il pool ("pg") e la repository vengono
 * richiesti a runtime, con path relativo risolto tramite
 * path.resolve(__dirname, '../dbManager/...'), non staticamente in cima al
 * file, cosi' che il require funzioni sia in locale (sibling folder nel
 * repository) sia una volta impacchettato in Lambda (dove dbManager/ viene
 * copiato come sibling da Makefile::build-HqManagerFunction, vedi
 * template.yaml — HqManagerFunction usa BuildMethod: makefile).
 *
 * getEnablingConfiguration(codmarket) espone la configurazione di
 * abilitazione WOC/firma digitale per ciascun sito del mercato richiesto
 * (join ang_snowflakes + addr_snowflakes + hq_application_enabling).
 *
 * setEnablingConfiguration(configurations, event) crea/aggiorna (upsert), in
 * un loop, la riga di configurazione per ciascun elemento dell'array
 * configurations ({ codmarket, oic, enableWOC, enableSignature }),
 * registrando anche una riga di audit (woc.hq_audit) per ciascun elemento,
 * con username risolto da event.requestContext.authorizer.sub.
 *
 * getVehicleInspection(market, type),
 * setVehicleInspectionVisible(payload) (payload contiene un array { id,
 * value } sotto una di queste chiavi: conditions, equipment, damagearea,
 * receptions, vehicleconfiguration — una sola per chiamata; loop su ciascun
 * elemento), deletetVehicleInspection(id, value) e
 * insertVehicleInspection(market, type, descr) espongono la gestione delle
 * voci di controllo veicolo (woc.hq_vehicle_inspection).
 *
 * setMarketEnable(market)/setMarketDisable(market), setOicEnable(market, oic)
 * (che a cascata disabilita anche il mercato, v. sotto),
 * insertDomain(market, oic, descr)/setDomain(market, iddomain, descr)/
 * deleteDomain(market, iddomain) (cancellazione logica, deleted = 1)/
 * setDomainVisible(payload) (payload.domain, array di { iddomain, value },
 * loop) e insertPackage(market, oic, iddomain, descr, timeop, pricewithvat)/
 * setPackage(idpackage, iddomain, descr, timeop, pricewithvat)/
 * deletePackage(idpackage)/setPackageVisible(payload) (payload.package,
 * array di { idpackage, value }, loop) espongono la
 * gerarchia di configurazione mercato -> OIC -> dominio -> pacchetto
 * (woc.hq_pk_market/hq_pk_oic/hq_pk_domain/hq_pk_packages).
 *
 * getPackageList(market, oic) legge la gerarchia mercato -> OIC -> dominio ->
 * pacchetto configurata per il mercato (ed eventualmente l'OIC) richiesto
 * (i domini cancellati logicamente sono esclusi, include anche
 * domVisible/pkVisible).
 *
 * insertAudit(username, section, market, actiontype, descr) e
 * searchAudit(market, section, datefrom, dateto, actiontype) (filtri tutti
 * opzionali) espongono il log di audit HQ (woc.hq_audit).
 *
 * getAnagSection()/getAnagAllocation() espongono le anagrafiche statiche
 * (sezioni HQ / tipi di azione di audit) lette da S3
 * (dbManager/S3ConfigRepository.js, bucket TranslationsBucket).
 */
class HqManager {
  /**
   * Chiavi array note del payload di setVehicleInspectionVisible: solo una
   * e' presente per chiamata, in base alla categoria di controllo veicolo.
   */
  static VEHICLE_INSPECTION_ARRAY_KEYS = ['conditions', 'equipment', 'damagearea', 'receptions', 'vehicleconfiguration'];

  /**
   * @param {string} codmarket
   * @returns {Promise<Array<{ siteName: string|null, oic: string|null, address: string|null, legalEntity: string|null, enableWOC: number, enableSignature: number }>>}
   */
  async getEnablingConfiguration(codmarket) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { getEnablingConfiguration } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return getEnablingConfiguration(pool, codmarket);
  }

  /**
   * Crea/aggiorna (upsert), in un loop, la riga di configurazione per
   * ciascun elemento dell'array configurations, riusando lo stesso pool.
   * Per ciascun elemento registra anche una riga di audit (woc.hq_audit,
   * sezione "enablingConfiguration", actiontype "update"), con lo username
   * risolto da event.requestContext.authorizer.sub (Lambda Authorizer;
   * null se l'evento non lo valorizza, es. invocazione diretta/CLI).
   *
   * @param {Array<{ codmarket: string, oic: string, enableWOC: number, enableSignature: number }>} configurations
   * @param {object} [event]
   * @returns {Promise<void>}
   */
  async setEnablingConfiguration(configurations, event = {}) {
    if (!Array.isArray(configurations) || configurations.length === 0) {
      throw new Error('"configurations" is required');
    }

    const authz = (event.requestContext && event.requestContext.authorizer) || {};
    const username = authz.sub || null;

    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setEnablingConfiguration, insertAudit } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    for (const { codmarket, oic, enableWOC, enableSignature } of configurations) {
      await setEnablingConfiguration(pool, codmarket, oic, enableWOC, enableSignature);
      await insertAudit(pool, username, 'enablingConfiguration', codmarket, 'update', `enableWOC: ${enableWOC} enableSignature:${enableSignature}`);
    }
  }

  /**
   * @param {string} market
   * @param {string} type
   * @returns {Promise<Array<{ id: number, market: string|null, type: string, descr: string, visible: number, deleted: number }>>}
   */
  async getVehicleInspection(market, type) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { getVehicleInspection } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return getVehicleInspection(pool, market, type);
  }

  /**
   * Aggiorna il flag "visible" per ciascun elemento { id, value } contenuto
   * in una delle chiavi array note del payload (conditions, equipment,
   * damagearea, receptions, vehicleconfiguration — solo una e' presente per
   * chiamata), riusando lo stesso pool.
   *
   * @param {{ conditions?: Array<{id:number, value:number}>, equipment?: Array<{id:number, value:number}>, damagearea?: Array<{id:number, value:number}>, receptions?: Array<{id:number, value:number}>, vehicleconfiguration?: Array<{id:number, value:number}> }} payload
   * @returns {Promise<void>}
   */
  async setVehicleInspectionVisible(payload) {
    const key = HqManager.VEHICLE_INSPECTION_ARRAY_KEYS.find((k) => Array.isArray(payload && payload[k]));
    if (!key) {
      throw new Error(`"payload" must contain an array in one of: ${HqManager.VEHICLE_INSPECTION_ARRAY_KEYS.join(', ')}`);
    }

    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setVehicleInspectionVisible } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    for (const { id, value } of payload[key]) {
      await setVehicleInspectionVisible(pool, id, value);
    }
  }

  /**
   * @param {number} id
   * @param {number} value
   * @returns {Promise<void>}
   */
  async deletetVehicleInspection(id, value) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { deletetVehicleInspection } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return deletetVehicleInspection(pool, id, value);
  }

  /**
   * @param {string} market
   * @param {string} type
   * @param {string} descr
   * @returns {Promise<void>}
   */
  async insertVehicleInspection(market, type, descr) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { insertVehicleInspection } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return insertVehicleInspection(pool, market, type, descr);
  }

  /**
   * @param {string} market
   * @returns {Promise<void>}
   */
  async setMarketEnable(market) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setMarketEnable } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return setMarketEnable(pool, market);
  }

  /**
   * @param {string} market
   * @returns {Promise<void>}
   */
  async setMarketDisable(market) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setMarketDisable } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return setMarketDisable(pool, market);
  }

  /**
   * Abilita l'OIC e, a cascata, disabilita il mercato (woc.hq_pk_market),
   * dato che una volta configurato manualmente almeno un OIC del mercato la
   * configurazione "a livello mercato" (setMarketEnable, che abilita tutti
   * gli OIC in blocco) non deve piu' applicarsi.
   *
   * @param {string} market
   * @param {string} oic
   * @returns {Promise<void>}
   */
  async setOicEnable(market, oic) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setOicEnable, setMarketDisable } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    await setOicEnable(pool, market, oic);
    return setMarketDisable(pool, market);
  }

  /**
   * @param {string} market
   * @param {string} oic
   * @param {string} descr
   * @returns {Promise<number>} l'iddomain generato
   */
  async insertDomain(market, oic, descr) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { insertDomain } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return insertDomain(pool, market, oic, descr);
  }

  /**
   * @param {string} market
   * @param {number} iddomain
   * @param {string} descr
   * @returns {Promise<void>}
   */
  async setDomain(market, iddomain, descr) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setDomain } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return setDomain(pool, market, iddomain, descr);
  }

  /**
   * @param {string} market
   * @param {number} iddomain
   * @returns {Promise<void>}
   */
  async deleteDomain(market, iddomain) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { deleteDomain } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return deleteDomain(pool, market, iddomain);
  }

  /**
   * Aggiorna il flag "visible", in un loop, per ciascun elemento
   * { iddomain, value } dell'array presente in payload.domain, riusando lo
   * stesso pool.
   *
   * @param {{ domain: Array<{ iddomain: number, value: number }> }} payload
   * @returns {Promise<void>}
   */
  async setDomainVisible(payload) {
    const domain = payload && payload.domain;
    if (!Array.isArray(domain) || domain.length === 0) {
      throw new Error('"domain" is required');
    }

    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setDomainVisible } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    for (const { iddomain, value } of domain) {
      await setDomainVisible(pool, iddomain, value);
    }
  }

  /**
   * @param {string} market
   * @param {string} oic
   * @param {number} iddomain
   * @param {string} descr
   * @param {number} timeop
   * @param {number} pricewithvat
   * @returns {Promise<number>} l'idpackage generato
   */
  async insertPackage(market, oic, iddomain, descr, timeop, pricewithvat) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { insertPackage } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return insertPackage(pool, market, oic, iddomain, descr, timeop, pricewithvat);
  }

  /**
   * @param {number} idpackage
   * @param {number} iddomain
   * @param {string} descr
   * @param {number} timeop
   * @param {number} pricewithvat
   * @returns {Promise<void>}
   */
  async setPackage(idpackage, iddomain, descr, timeop, pricewithvat) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setPackage } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return setPackage(pool, idpackage, iddomain, descr, timeop, pricewithvat);
  }

  /**
   * @param {number} idpackage
   * @returns {Promise<void>}
   */
  async deletePackage(idpackage) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { deletePackage } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return deletePackage(pool, idpackage);
  }

  /**
   * Aggiorna il flag "visible", in un loop, per ciascun elemento
   * { idpackage, value } dell'array presente in payload.package, riusando lo
   * stesso pool.
   *
   * @param {{ package: Array<{ idpackage: number, value: number }> }} payload
   * @returns {Promise<void>}
   */
  async setPackageVisible(payload) {
    const pkg = payload && payload.package;
    if (!Array.isArray(pkg) || pkg.length === 0) {
      throw new Error('"package" is required');
    }

    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setPackageVisible } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    for (const { idpackage, value } of pkg) {
      await setPackageVisible(pool, idpackage, value);
    }
  }

  /**
   * @param {string} market
   * @param {string|null} [oic]
   * @returns {Promise<Array<{ market: string|null, oic: string|null, domainDescr: string|null, domVisible: number|null, idpackage: number|null, packageDescr: string|null, timeop: number|null, pricewithvat: number|null, pkVisible: number|null }>>}
   */
  async getPackageList(market, oic) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { getPackageList } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return getPackageList(pool, market, oic);
  }

  /**
   * @param {string} username
   * @param {string} section
   * @param {string} market
   * @param {string} actiontype
   * @param {string} descr
   * @returns {Promise<void>}
   */
  async insertAudit(username, section, market, actiontype, descr) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { insertAudit } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return insertAudit(pool, username, section, market, actiontype, descr);
  }

  /**
   * @param {string} [market]
   * @param {string} [section]
   * @param {string} [datefrom]
   * @param {string} [dateto]
   * @param {string} [actiontype]
   * @returns {Promise<Array<{ id: number, username: string|null, creationdate: string|null, section: string|null, market: string|null, actiontype: string|null, descr: string|null }>>}
   */
  async searchAudit(market, section, datefrom, dateto, actiontype) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { searchAudit } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return searchAudit(pool, market, section, datefrom, dateto, actiontype);
  }

  /**
   * @returns {Promise<Array<{ section: string }>>}
   */
  async getAnagSection() {
    const { getAnagSection } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    return getAnagSection();
  }

  /**
   * @returns {Promise<Array<{ type: string }>>}
   */
  async getAnagAllocation() {
    const { getAnagAllocation } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    return getAnagAllocation();
  }
}

module.exports = { HqManager };
