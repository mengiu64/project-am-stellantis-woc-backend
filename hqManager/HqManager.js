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
}

module.exports = { HqManager };
