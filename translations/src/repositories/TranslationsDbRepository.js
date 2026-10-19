'use strict';

const { getPool } = require('../../shared/dbClient');
const { SOURCE_LANGUAGE } = require('../utils/translationsJson');

// Dimensione massima di un batch di INSERT (righe per statement)
const BATCH_SIZE = 1000;

/**
 * TranslationsDbRepository — accesso alla tabella woc.translations (Aurora PostgreSQL).
 * Il repository NON esegue mai DELETE: solo INSERT / UPDATE (upsert) e SELECT.
 */
class TranslationsDbRepository {
  constructor({ pool } = {}) {
    this.pool = pool; // pool opzionale (iniettabile nei test), altrimenti da dbClient
  }

  /**
   * Restituisce il pool pg (riuso tra invocazioni warm).
   */
  async getPool() {
    return this.pool || getPool();
  }

  /**
   * Upsert delle righe in un'unica transazione (tutto o niente).
   * - Lingua sorgente (en): inserisce o aggiorna translation e context se cambiati.
   * - Altre lingue: inserisce se mancano; se esistono aggiorna SOLO il context, mai la
   *   translation, cosi' un nuovo upload dell'inglese non sovrascrive traduzioni reali.
   *
   * @param {Array<{path:string,language:string,context:string,translation:string}>} rows - righe da scrivere
   * @returns {Promise<{inserted:number, updated:number}>} conteggio righe inserite/aggiornate
   */
  async upsertRows(rows) {
    const pool = await this.getPool(); // pool di connessioni
    const client = await pool.connect(); // connessione dedicata alla transazione
    let inserted = 0; // contatore righe nuove
    let updated = 0; // contatore righe aggiornate
    try {
      await client.query('BEGIN'); // inizio transazione
      // Scrivo a blocchi per non superare i limiti di parametri del protocollo PG
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE); // blocco corrente
        for (const isSource of [true, false]) {
          // Separo le righe sorgente dalle derivate: hanno clausole ON CONFLICT diverse
          const part = chunk.filter((r) => (r.language === SOURCE_LANGUAGE) === isSource);
          if (part.length === 0) continue; // niente da scrivere per questo gruppo
          const result = await client.query(buildUpsertSql(isSource), [
            part.map((r) => r.path), // array dei path
            part.map((r) => r.language), // array delle lingue
            part.map((r) => r.translation), // array dei testi
            part.map((r) => r.context), // array dei contesti
          ]);
          for (const r of result.rows) {
            if (r.inserted) inserted += 1; else updated += 1; // xmax = 0 -> riga nuova
          }
        }
      }
      await client.query('COMMIT'); // conferma di tutte le scritture
      return { inserted, updated };
    } catch (err) {
      // Qualsiasi errore: annullo l'intera transazione e propago l'errore
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error(JSON.stringify({ logType: 'rollback_error', service: 'translations', error: rollbackErr.message }));
      }
      throw err;
    } finally {
      client.release(); // rilascio sempre la connessione al pool
    }
  }

  /**
   * Tutti i record di una lingua, ordinati per path.
   *
   * @param {string} language - codice lingua
   * @returns {Promise<Array<{path:string,language:string,context:string,translation:string}>>}
   */
  async findByLanguage(language) {
    const pool = await this.getPool(); // pool di connessioni
    const result = await pool.query(
      'SELECT path, language, context, translation FROM woc.translations WHERE language = $1 ORDER BY path',
      [language], // parametro: lingua richiesta
    );
    return result.rows;
  }

  /**
   * Ricerca con filtri in AND (almeno uno tra path, language, context).
   * path: corrisponde al path esatto oppure a tutti i path sotto quel prefisso
   * (es. "shell.layout" restituisce "shell.layout.toast.close_aria").
   *
   * @param {{path?:string, language?:string, context?:string}} filters - filtri gia' validati
   * @returns {Promise<Array<{path:string,language:string,context:string,translation:string}>>}
   */
  async findByFilters({ path, language, context }) {
    const conditions = []; // condizioni WHERE da concatenare in AND
    const params = []; // valori parametrici corrispondenti
    if (path !== undefined) {
      params.push(path);
      // Path esatto oppure sottoalbero (prefisso seguito da "."); niente LIKE, quindi niente escape
      conditions.push(`(path = $${params.length} OR starts_with(path, $${params.length} || '.'))`);
    }
    if (language !== undefined) {
      params.push(language);
      conditions.push(`language = $${params.length}`); // lingua esatta
    }
    if (context !== undefined) {
      params.push(context);
      conditions.push(`context = $${params.length}`); // contesto esatto
    }
    const pool = await this.getPool(); // pool di connessioni
    const result = await pool.query(
      `SELECT path, language, context, translation FROM woc.translations WHERE ${conditions.join(' AND ')} ORDER BY language, path`,
      params,
    );
    return result.rows;
  }
}

/**
 * SQL di upsert multi-riga basato su unnest (4 parametri array, indipendente dal numero di righe).
 * La chiave di conflitto e' uk_translations_path_language (path, language).
 *
 * @param {boolean} isSource - true per la lingua sorgente (aggiorna anche translation)
 * @returns {string} statement SQL
 */
function buildUpsertSql(isSource) {
  // Per la lingua sorgente si aggiornano testo e contesto, per le altre solo il contesto
  const setClause = isSource
    ? 'SET translation = EXCLUDED.translation, context = EXCLUDED.context'
    : 'SET context = EXCLUDED.context';
  // Aggiorno solo se qualcosa e' davvero cambiato (evita scritture inutili)
  const whereClause = isSource
    ? 'WHERE woc.translations.translation IS DISTINCT FROM EXCLUDED.translation OR woc.translations.context IS DISTINCT FROM EXCLUDED.context'
    : 'WHERE woc.translations.context IS DISTINCT FROM EXCLUDED.context';
  return `INSERT INTO woc.translations (path, language, translation, context)
SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
ON CONFLICT (path, language) DO UPDATE ${setClause} ${whereClause}
RETURNING (xmax = 0) AS inserted`;
}

module.exports = { TranslationsDbRepository, buildUpsertSql };
