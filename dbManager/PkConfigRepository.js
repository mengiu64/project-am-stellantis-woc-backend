'use strict';

/**
 * PkConfigRepository.js — Query SQL sulla tabella HQ_PKCONFIG (Aurora PostgreSQL, db "wiadvisor",
 * schema "woc").
 *
 * Schema:
 *   woc.HQ_PKCONFIG(CODMARKET VARCHAR(20), CODBRAND VARCHAR(20) NOT NULL, APPLICATION VARCHAR(20) NOT NULL)
 *
 * getPkwstouse cerca prima una riga specifica per (CODMARKET, CODBRAND); se non
 * trova nessun risultato, ripete la ricerca con CODMARKET IS NULL (riga di
 * default/fallback valida per tutti i mercati) mantenendo lo stesso CODBRAND.
 * Il confronto è case-insensitive e trim-safe (UPPER+TRIM su entrambi i lati),
 * per tollerare eventuali differenze di maiuscole/spazi tra il valore inviato
 * dal chiamante e quello salvato in tabella.
 */

/**
 * @param {import('pg').Pool} pool
 * @param {{ codmarket: string, codbrand: string }} params
 * @returns {Promise<string|null>} il valore di APPLICATION (pkwstouse), o null se non trovato
 */
async function getPkwstouse(pool, { codmarket, codbrand }) {
  if (!codbrand) throw new Error('"codbrand" is required');

  if (codmarket) {
    const { rows } = await pool.query(
      `SELECT application
         FROM woc.hq_pkconfig
        WHERE UPPER(TRIM(codmarket)) = UPPER(TRIM($1))
          AND UPPER(TRIM(codbrand)) = UPPER(TRIM($2))
        LIMIT 1`,
      [codmarket, codbrand],
    );
    if (rows.length > 0) {
      return rows[0].application;
    }
  }

  const { rows } = await pool.query(
    `SELECT application
       FROM woc.hq_pkconfig
      WHERE codmarket IS NULL
        AND UPPER(TRIM(codbrand)) = UPPER(TRIM($1))
      LIMIT 1`,
    [codbrand],
  );

  return rows.length > 0 ? rows[0].application : null;
}

module.exports = { getPkwstouse };
