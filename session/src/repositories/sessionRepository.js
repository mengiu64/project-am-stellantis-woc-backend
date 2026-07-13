'use strict';

/**
 * SessionRepository — interfaccia astratta per il recupero dei dati di sessione.
 *
 * Implementazioni concrete:
 *  - S3SessionRepository (attuale): legge session/session_data.json da un bucket S3
 *    ed estrae la sezione relativa al mercato richiesto.
 *  - Una futura implementazione (es. su database) potra' mantenere invariata
 *    la firma di getSessionData(codmarket), senza impatti su src/index.js.
 *    Bastera' cambiare src/repositoryFactory.js.
 */
class SessionRepository {
  /**
   * @param {string} codmarket - Codice mercato a 4 caratteri (es. "1000").
   * @returns {Promise<object>} I dati di sessione per il mercato richiesto.
   */
  // eslint-disable-next-line no-unused-vars
  async getSessionData(codmarket) {
    throw new Error('getSessionData(codmarket) non implementato');
  }
}

module.exports = { SessionRepository };
