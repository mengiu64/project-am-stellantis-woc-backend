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
 * setEnablingConfiguration(configurations) crea/aggiorna (upsert), in un
 * loop, la riga di configurazione per ciascun elemento dell'array
 * configurations ({ codmarket, oic, enableWOC, enableSignature }).
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
 * deleteDomain(market, iddomain) (cancellazione logica, deleted = 1) e
 * insertPackage(market, oic, iddomain, descr, timeop, pricewithvat)/
 * setPackage(idpackage, iddomain, descr, timeop, pricewithvat)/
 * deletePackage(idpackage) espongono la
 * gerarchia di configurazione mercato -> OIC -> dominio -> pacchetto
 * (woc.hq_pk_market/hq_pk_oic/hq_pk_domain/hq_pk_packages).
 *
 * getPackageList(market, oic) legge la gerarchia mercato -> OIC -> dominio ->
 * pacchetto configurata per il mercato (ed eventualmente l'OIC) richiesto
 * (i domini cancellati logicamente sono esclusi).
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
   *
   * @param {Array<{ codmarket: string, oic: string, enableWOC: number, enableSignature: number }>} configurations
   * @returns {Promise<void>}
   */
  async setEnablingConfiguration(configurations) {
    if (!Array.isArray(configurations) || configurations.length === 0) {
      throw new Error('"configurations" is required');
    }

    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setEnablingConfiguration } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    for (const { codmarket, oic, enableWOC, enableSignature } of configurations) {
      await setEnablingConfiguration(pool, codmarket, oic, enableWOC, enableSignature);
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
   * @param {string} market
   * @param {string|null} [oic]
   * @returns {Promise<Array<{ market: string|null, oic: string|null, domainDescr: string|null, idpackage: number|null, packageDescr: string|null, timeop: number|null, pricewithvat: number|null }>>}
   */
  async getPackageList(market, oic) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { getPackageList } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return getPackageList(pool, market, oic);
  }
}

module.exports = { HqManager };
