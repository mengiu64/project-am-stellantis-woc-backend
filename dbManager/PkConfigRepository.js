'use strict';

/**
 * PkConfigRepository.js — Query SQL sulla tabella HQ_PKCONFIG (Aurora PostgreSQL, db "wiadvisor").
 *
 * Schema:
 *   HQ_PKCONFIG(CODMARKET VARCHAR(20), CODBRAND VARCHAR(20) NOT NULL, APPLICATION VARCHAR(20) NOT NULL)
 *
 * getPkwstouse cerca prima una riga specifica per (CODMARKET, CODBRAND); se non
 * trova nessun risultato, ripete la ricerca con CODMARKET IS NULL (riga di
 * default/fallback valida per tutti i mercati) mantenendo lo stesso CODBRAND.
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
         FROM hq_pkconfig
        WHERE codmarket = $1
          AND codbrand = $2
        LIMIT 1`,
      [codmarket, codbrand],
    );
    if (rows.length > 0) {
      return rows[0].application;
    }
  }

  const { rows } = await pool.query(
    `SELECT application
       FROM hq_pkconfig
      WHERE codmarket IS NULL
        AND codbrand = $1
      LIMIT 1`,
    [codbrand],
  );

  return rows.length > 0 ? rows[0].application : null;
}

module.exports = { getPkwstouse };
