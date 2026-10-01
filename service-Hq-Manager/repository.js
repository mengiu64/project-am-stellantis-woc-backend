'use strict';

// Errore HTTP applicativo
const { HttpError } = require('./errors');

// Codici di errore PostgreSQL gestiti
const PG_UNIQUE_VIOLATION = '23505';

// Colonne esposte di woc.customer_options
const CO_COLUMNS = 'oic_code, customer_waiting_on_site, cleaning_approval_internal, cleaning_approval_external, created_at, updated_at';

// Colonne esposte di woc.hq_settings_email
const HE_COLUMNS = 'id, oic_code, market, dealership_code, signature_email, dpo_email, created_at, updated_at';

/**
 * Traduce gli errori pg in HttpError (409 su chiave duplicata); rilancia gli altri.
 * @param {Error} err - errore originale
 * @param {string} conflictMessage - messaggio per il 409
 */
function mapDbError(err, conflictMessage) {
  // Violazione di unicità: conflitto
  if (err && err.code === PG_UNIQUE_VIOLATION) {
    return new HttpError(409, conflictMessage);
  }
  // Errore tecnico: viene gestito come 500 dall'handler
  return err;
}

/**
 * Costruisce la clausola SET dinamica con parametri posizionali.
 * @param {object} fields - campi da aggiornare
 * @param {number} startIndex - indice del primo parametro
 * @returns {{set:string, values:Array}} clausola e valori
 */
function buildSet(fields, startIndex) {
  // Nomi colonna (provengono solo da whitelist dei validatori)
  const keys = Object.keys(fields);
  // Una assegnazione per colonna con placeholder $n
  const set = keys.map((k, i) => `${k} = $${startIndex + i}`).join(', ');
  // Valori nello stesso ordine
  return { set, values: keys.map((k) => fields[k]) };
}

// ───────────────────────── customer_options ─────────────────────────

/** Elenco paginato di customer_options. */
async function listCustomerOptions(pool, { limit, offset }) {
  // Query parametrica ordinata per chiave
  const r = await pool.query(`SELECT ${CO_COLUMNS} FROM woc.customer_options ORDER BY oic_code LIMIT $1 OFFSET $2`, [limit, offset]);
  // Restituisce le righe
  return r.rows;
}

/** Lettura di una riga per oic_code (null se assente). */
async function getCustomerOption(pool, oicCode) {
  // Query per chiave primaria
  const r = await pool.query(`SELECT ${CO_COLUMNS} FROM woc.customer_options WHERE oic_code = $1`, [oicCode]);
  // Prima riga o null
  return r.rows[0] || null;
}

/** Inserimento di customer_options (409 se oic_code già presente). */
async function insertCustomerOption(pool, oicCode, fields) {
  // Colonne: chiave + campi forniti (i mancanti usano i DEFAULT del DB)
  const cols = ['oic_code', ...Object.keys(fields)];
  // Placeholder $1..$n
  const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
  // Valori nello stesso ordine
  const values = [oicCode, ...Object.values(fields)];
  try {
    // INSERT con RETURNING per restituire la riga creata
    const r = await pool.query(`INSERT INTO woc.customer_options (${cols.join(', ')}) VALUES (${ph}) RETURNING ${CO_COLUMNS}`, values);
    // Riga creata
    return r.rows[0];
  } catch (err) {
    // Mappa eventuale duplicato in 409
    throw mapDbError(err, `customer_options già esistente per oic_code=${oicCode}`);
  }
}

/** Aggiornamento di customer_options (null se non trovato). */
async function updateCustomerOption(pool, oicCode, fields) {
  // Clausola SET dinamica dal parametro $2
  const { set, values } = buildSet(fields, 2);
  // UPDATE per chiave primaria
  const r = await pool.query(`UPDATE woc.customer_options SET ${set} WHERE oic_code = $1 RETURNING ${CO_COLUMNS}`, [oicCode, ...values]);
  // Riga aggiornata o null
  return r.rows[0] || null;
}

/** Cancellazione di customer_options (true se cancellata). */
async function deleteCustomerOption(pool, oicCode) {
  // DELETE per chiave primaria
  const r = await pool.query('DELETE FROM woc.customer_options WHERE oic_code = $1', [oicCode]);
  // true se almeno una riga rimossa
  return r.rowCount > 0;
}

// ───────────────────────── hq_settings_email ─────────────────────────

/** Elenco paginato di hq_settings_email con filtri opzionali. */
async function listHqSettingsEmail(pool, filters, { limit, offset }) {
  // Condizioni WHERE dinamiche (solo colonne in whitelist)
  const conds = [];
  // Valori dei parametri
  const values = [];
  // Per ogni filtro valorizzato aggiunge una condizione
  for (const col of ['market', 'dealership_code', 'oic_code']) {
    if (filters[col]) {
      values.push(filters[col]);
      conds.push(`${col} = $${values.length}`);
    }
  }
  // Clausola WHERE solo se ci sono filtri
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  // Aggiunge limit e offset
  values.push(limit, offset);
  // Esegue la query
  const r = await pool.query(
    `SELECT ${HE_COLUMNS} FROM woc.hq_settings_email ${where} ORDER BY market, dealership_code, oic_code LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  // Restituisce le righe
  return r.rows;
}

/** Lettura per chiave composita (null se assente). */
async function getHqSettingsEmail(pool, key) {
  // Query per market + dealership_code + oic_code
  const r = await pool.query(
    `SELECT ${HE_COLUMNS} FROM woc.hq_settings_email WHERE market = $1 AND dealership_code = $2 AND oic_code = $3`,
    [key.market, key.dealership_code, key.oic_code]
  );
  // Prima riga o null
  return r.rows[0] || null;
}

/** Inserimento (409 se chiave o coppia dealership/market già presente). */
async function insertHqSettingsEmail(pool, key, fields) {
  // Colonne: chiave composita + email fornite
  const cols = ['market', 'dealership_code', 'oic_code', ...Object.keys(fields)];
  // Placeholder $1..$n
  const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
  // Valori nello stesso ordine
  const values = [key.market, key.dealership_code, key.oic_code, ...Object.values(fields)];
  try {
    // INSERT con RETURNING
    const r = await pool.query(`INSERT INTO woc.hq_settings_email (${cols.join(', ')}) VALUES (${ph}) RETURNING ${HE_COLUMNS}`, values);
    // Riga creata
    return r.rows[0];
  } catch (err) {
    // Duplicato (anche su UK dealership_code+market): 409
    throw mapDbError(err, `hq_settings_email già esistente per market=${key.market}, dealership_code=${key.dealership_code}`);
  }
}

/** Aggiornamento per chiave composita (null se non trovato). */
async function updateHqSettingsEmail(pool, key, fields) {
  // Clausola SET dinamica dal parametro $4
  const { set, values } = buildSet(fields, 4);
  // UPDATE per chiave composita
  const r = await pool.query(
    `UPDATE woc.hq_settings_email SET ${set} WHERE market = $1 AND dealership_code = $2 AND oic_code = $3 RETURNING ${HE_COLUMNS}`,
    [key.market, key.dealership_code, key.oic_code, ...values]
  );
  // Riga aggiornata o null
  return r.rows[0] || null;
}

/** Cancellazione per chiave composita (true se cancellata). */
async function deleteHqSettingsEmail(pool, key) {
  // DELETE per chiave composita
  const r = await pool.query(
    'DELETE FROM woc.hq_settings_email WHERE market = $1 AND dealership_code = $2 AND oic_code = $3',
    [key.market, key.dealership_code, key.oic_code]
  );
  // true se almeno una riga rimossa
  return r.rowCount > 0;
}

// Esporta le funzioni del repository
module.exports = {
  listCustomerOptions, getCustomerOption, insertCustomerOption, updateCustomerOption, deleteCustomerOption,
  listHqSettingsEmail, getHqSettingsEmail, insertHqSettingsEmail, updateHqSettingsEmail, deleteHqSettingsEmail,
};
