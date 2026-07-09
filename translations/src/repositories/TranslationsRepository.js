'use strict';

/**
 * TranslationsRepository — interfaccia astratta per il recupero delle traduzioni.
 *
 * Implementazioni concrete:
 *  - S3TranslationsRepository (attuale): legge locales/{lang}/translation.json da un bucket S3.
 *  - Una futura DbTranslationsRepository potrà leggere le stesse informazioni da database,
 *    mantenendo invariata la firma di getTranslations(lang) e quindi senza impatti
 *    su handlers/translations.js né su index.js. Basterà cambiare repositoryFactory.js.
 */
class TranslationsRepository {
  /**
   * @param {string} lang - Codice lingua (es. "en", "it").
   * @returns {Promise<object>} Oggetto JSON con le traduzioni.
   */
  // eslint-disable-next-line no-unused-vars
  async getTranslations(lang) {
    throw new Error('getTranslations(lang) non implementato');
  }
}

module.exports = { TranslationsRepository };
