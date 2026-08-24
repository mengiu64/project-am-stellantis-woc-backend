'use strict';

/**
 * ListFunctionsRepository.js — Query SQL sulla tabella woc.listfunctions (Aurora PostgreSQL).
 *
 * Schema (vedi sql/create_table_listFunctions.sql):
 *   woc.listfunctions(function VARCHAR(10) PRIMARY KEY)
 *
 * Usata da DocSOARestClient.functionServiceDb per sostituire functionsService
 * (chiamata SOAP a DocSOA) con un sottoinsieme di funzioni gestito localmente
 * sul DB, mantenendo la stessa struttura di output.
 */

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{ function: string }>>}
 */
async function listFunctions(pool) {
  const { rows } = await pool.query(
    `SELECT function
       FROM woc.listfunctions
      ORDER BY function ASC`,
  );

  return rows;
}

module.exports = { listFunctions };
