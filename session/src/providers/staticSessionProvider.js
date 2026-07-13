'use strict';

const SessionProvider = require('./sessionProvider');
const { getSessionDataForMarket } = require('../data/sessionDataByMarket');

/**
 * Provider "statico": ritorna i valori predefiniti in sessionDataByMarket.js,
 * parametrizzati in base al mercato (criteria.codmarket).
 * Usato come default (SESSION_DATA_SOURCE=static) e come fallback per sviluppo/test.
 */
class StaticSessionProvider extends SessionProvider {
  /**
   * @param {object} [criteria] - Criteri di ricerca.
   * @param {string} [criteria.codmarket] - Codice mercato (es. "IT", "FR", "DE").
   *   Se assente, viene usato il mercato di default (IT). Eventuali altri campi
   *   presenti in criteria vengono uniti (override) ai valori predefiniti del mercato,
   *   utile per simulare risposte diverse nei test.
   * @returns {Promise<object>}
   */
  async getSessionData(criteria = {}) {
    const { codmarket, ...overrides } = criteria;
    const marketData = getSessionDataForMarket(codmarket);
    return {
      ...marketData,
      ...overrides,
    };
  }
}

module.exports = StaticSessionProvider;

