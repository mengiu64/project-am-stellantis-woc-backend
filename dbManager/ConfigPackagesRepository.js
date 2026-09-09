'use strict';

/**
 * ConfigPackagesRepository.js — Query SQL sulla tabella woc.config_packages (Aurora
 * PostgreSQL, db "wiadvisor", schema "woc").
 *
 * Schema:
 *   woc.config_packages(pkwstouse VARCHAR(20) NOT NULL, department VARCHAR(20) NOT NULL, pkcod VARCHAR(20) NOT NULL)
 *
 * Sostituisce la costante statica CONFIG_PACKAGES precedentemente hardcoded in
 * pkManager/PkManager.js: getConfigPackages raggruppa i codici pacchetto per
 * department, per un dato pkwstouse (eper/docsoa/menupricing). Il confronto è
 * case-insensitive e trim-safe (UPPER+TRIM), per tollerare eventuali differenze
 * di maiuscole/spazi tra il valore inviato dal chiamante e quello salvato in
 * tabella.
 */

/**
 * @param {import('pg').Pool} pool
 * @param {{ pkwstouse: string }} params
 * @returns {Promise<object>} { [department]: [pkcod, ...] } — solo i department
 *                             con almeno un codice configurato sono inclusi.
 *                             Oggetto vuoto {} se pkwstouse non ha righe configurate.
 */
async function getConfigPackages(pool, { pkwstouse }) {
  if (!pkwstouse) throw new Error('"pkwstouse" is required');

  const { rows } = await pool.query(
    `SELECT department, pkcod
       FROM woc.config_packages
      WHERE UPPER(TRIM(pkwstouse)) = UPPER(TRIM($1))
      ORDER BY department, pkcod`,
    [pkwstouse],
  );

  const config = {};
  for (const { department, pkcod } of rows) {
    if (!config[department]) config[department] = [];
    config[department].push(pkcod);
  }

  return config;
}

module.exports = { getConfigPackages };
