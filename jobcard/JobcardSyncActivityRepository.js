'use strict';

/**
 * JobcardSyncActivityRepository.js — tabella woc.jobcard_sync_activity
 * (v. sql/create_table_jobcard_sync_activity.sql).
 *
 * Ad ogni saveJobcard, PRIMA dell'invio a DGT, jobcard registra il payload con un
 * UPSERT su jobcardid:
 *   - INSERT: jobcardid, creationdate (= now()), payload
 *   - UPDATE (jobcardid già presente): solo payload
 * ack/techreason/businessreason/lastupdate sono popolati in un secondo momento
 * (esito della sincronizzazione), non da questa lambda.
 *
 * Copia di djc/JobcardSyncActivityRepository.js, mantenuta in sync.
 */

const UPSERT_SQL = `
  INSERT INTO woc.jobcard_sync_activity (jobcardid, creationdate, payload)
  VALUES ($1, now(), $2::jsonb)
  ON CONFLICT (jobcardid) DO UPDATE SET payload = EXCLUDED.payload
  RETURNING jobcardid, creationdate`;

// Ordine di priorità dell'identificativo della jobcard in roInfo (almeno uno
// dei tre è obbligatorio per la Push API SRP).
const JOBCARD_ID_FIELDS = ['jobCardSrpId', 'dmsRepairOrderId', 'jobCardLegacyId'];

/**
 * Ricava il jobcardid dal payload saveJobcard: roInfo.jobCardSrpId, fallback
 * roInfo.dmsRepairOrderId, poi roInfo.jobCardLegacyId.
 * @param {object} payload
 * @returns {string|null}
 */
function resolveJobCardId(payload) {
  const roInfo = payload?.roInfo ?? {};
  for (const field of JOBCARD_ID_FIELDS) {
    const value = roInfo[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

/**
 * UPSERT del payload saveJobcard in woc.jobcard_sync_activity.
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @param {object} payload - payload effettivamente inviato a DGT
 * @returns {Promise<{jobcardid: string, creationdate: Date}>}
 */
async function upsertSyncActivity(pool, jobCardId, payload) {
  const { rows } = await pool.query(UPSERT_SQL, [jobCardId, JSON.stringify(payload)]);
  return rows[0];
}

/**
 * Registra il payload saveJobcard (bloccante: eventuali errori vengono
 * propagati al chiamante, che non deve inviare il payload a DGT).
 * @param {object} payload - payload effettivamente inviato a DGT
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @returns {Promise<{jobcardid: string, creationdate: Date}>}
 */
async function recordSyncActivity(payload, { getPool } = {}) {
  const jobCardId = resolveJobCardId(payload);
  if (!jobCardId) {
    throw new Error(`[jobCard] roInfo.${JOBCARD_ID_FIELDS.join('/')} is required`);
  }
  const resolveGetPool = getPool ?? require('./db').getPool;
  const pool = await resolveGetPool();
  const row = await upsertSyncActivity(pool, jobCardId, payload);
  console.log(`[jobCard] jobcard_sync_activity upsert jobcardid=${jobCardId}`);
  return row;
}

module.exports = { resolveJobCardId, upsertSyncActivity, recordSyncActivity, UPSERT_SQL };
