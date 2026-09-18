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
 * setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature)
 * crea/aggiorna (upsert) la riga di configurazione per la coppia
 * (codmarket, oic).
 *
 * getVehicleInspection(market, type), setVehicleInspectionVisible(id, value),
 * deletetVehicleInspectionVisible(id, value) e
 * insertVehicleInspection(market, type, descr) espongono la gestione delle
 * voci di controllo veicolo (woc.hq_vehicle_inspection).
 */
class HqManager {
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
   * @param {string} codmarket
   * @param {string} oic
   * @param {number} enableWOC
   * @param {number} enableSignature
   * @returns {Promise<void>}
   */
  async setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setEnablingConfiguration } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return setEnablingConfiguration(pool, codmarket, oic, enableWOC, enableSignature);
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
   * @param {number} id
   * @param {number} value
   * @returns {Promise<void>}
   */
  async setVehicleInspectionVisible(id, value) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { setVehicleInspectionVisible } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return setVehicleInspectionVisible(pool, id, value);
  }

  /**
   * @param {number} id
   * @param {number} value
   * @returns {Promise<void>}
   */
  async deletetVehicleInspectionVisible(id, value) {
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { deletetVehicleInspectionVisible } = require(path.resolve(__dirname, '../dbManager/HqRepository'));

    const pool = await getPool();
    return deletetVehicleInspectionVisible(pool, id, value);
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
}

module.exports = { HqManager };
