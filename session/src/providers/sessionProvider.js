'use strict';

/**
 * Interfaccia (contratto) che ogni provider di dati di sessione deve rispettare.
 * Le classi concrete (StaticSessionProvider, DbSessionProvider, ...) devono
 * implementare il metodo `getSessionData(criteria)`.
 *
 * @interface
 */
class SessionProvider {
  /**
   * @param {object} [criteria] - Criteri di ricerca (es. { pdvId, sincom, codmarket }).
   * @returns {Promise<object>} I dati di sessione.
   */
  // eslint-disable-next-line no-unused-vars
  async getSessionData(criteria) {
    throw new Error('getSessionData() non implementato');
  }
}

module.exports = SessionProvider;
