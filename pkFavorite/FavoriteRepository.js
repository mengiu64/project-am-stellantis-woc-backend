'use strict';

/**
 * FavoriteRepository.js — Query SQL sulla tabella PKFAVORITE (Aurora PostgreSQL).
 *
 * Schema (vedi sql/create_tables.sql):
 *   PKFAVORITE(ID, USERNAME, VIN, PACKAGE_CODE, CREATED_AT)
 *   UNIQUE(USERNAME, VIN, PACKAGE_CODE)
 *
 * Regole:
 *  - listFavorites: elenca i codici pacchetto preferiti di un dealer (username) per un VIN.
 *  - toggleFavorite: se la riga (username, vin, packageCode) esiste la elimina
 *    ("rimuove dai preferiti"), altrimenti la crea ("aggiunge ai preferiti").
 */

/**
 * @param {import('pg').Pool} pool
 * @param {{ username: string, vin: string }} params
 * @returns {Promise<Array<{ packageCode: string, createdAt: Date }>>}
 */
async function listFavorites(pool, { username, vin }) {
  if (!username) throw new Error('"username" is required');
  if (!vin) throw new Error('"vin" is required');

  const { rows } = await pool.query(
    `SELECT package_code, created_at
       FROM pkfavorite
      WHERE username = $1
        AND vin = $2
      ORDER BY created_at ASC`,
    [username, vin],
  );

  return rows.map((row) => ({
    packageCode: row.package_code,
    createdAt: row.created_at,
  }));
}

/**
 * Crea il preferito se non esiste, altrimenti lo elimina (comportamento "toggle").
 *
 * @param {import('pg').Pool} pool
 * @param {{ username: string, vin: string, packageCode: string }} params
 * @returns {Promise<{ action: 'added'|'removed', packageCode: string, id?: number, createdAt?: Date }>}
 */
async function toggleFavorite(pool, { username, vin, packageCode }) {
  if (!username) throw new Error('"username" is required');
  if (!vin) throw new Error('"vin" is required');
  if (!packageCode) throw new Error('"packageCode" is required');

  const deleted = await pool.query(
    `DELETE FROM pkfavorite
      WHERE username = $1
        AND vin = $2
        AND package_code = $3
      RETURNING id`,
    [username, vin, packageCode],
  );

  if (deleted.rowCount > 0) {
    return { action: 'removed', packageCode };
  }

  const inserted = await pool.query(
    `INSERT INTO pkfavorite (username, vin, package_code)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [username, vin, packageCode],
  );

  return {
    action: 'added',
    packageCode,
    id: inserted.rows[0].id,
    createdAt: inserted.rows[0].created_at,
  };
}

module.exports = { listFavorites, toggleFavorite };
