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
 * (esito della sincronizzazione, da synch-status), non da questa lambda, che
 * li legge soltanto (getSyncStatus) per restituirli nelle risposte di
 * jobCardDetails e saveJobcard come ack/techReason/businessReason.
 * getLastPayload rilegge il payload registrato, insieme ad ack/techreason/
 * businessreason della stessa riga (azione GET "lastPayload"), per recuperare
 * le modifiche inviate quando l'aggiornamento verso DJC/DGT fallisce.
 *
 * Copia di djc/JobcardSyncActivityRepository.js, mantenuta in sync, salvo
 * SELECT_LAST_PAYLOAD_SQL/selectLastPayload/getLastPayload (solo jobcard).
 */

const UPSERT_SQL = `
  INSERT INTO woc.jobcard_sync_activity (jobcardid, creationdate, payload)
  VALUES ($1, now(), $2::jsonb)
  ON CONFLICT (jobcardid) DO UPDATE SET payload = EXCLUDED.payload
  RETURNING jobcardid, creationdate`;

const SELECT_SYNC_STATUS_SQL = `
  SELECT ack, techreason, businessreason
  FROM woc.jobcard_sync_activity
  WHERE jobcardid = $1`;

const SELECT_LAST_PAYLOAD_SQL = `
  SELECT jobcardid, ack, techreason, businessreason, payload
  FROM woc.jobcard_sync_activity
  WHERE jobcardid = $1`;

// Attesa massima della lettura dell'esito (best-effort): un DB lento o
// irraggiungibile non deve bloccare la risposta di jobCardDetails/saveJobcard
// (stesso limite di 5 s di connectionTimeoutMillis/statement_timeout usato negli
// altri moduli).
const SYNC_STATUS_TIMEOUT_MS = 5000;

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

/**
 * Converte una riga di woc.jobcard_sync_activity nei campi della risposta
 * (camelCase). Riga assente o valori NULL (esito non ancora popolato da
 * synch-status) diventano stringa vuota.
 * @param {{ack?: string|null, techreason?: string|null, businessreason?: string|null}|null} [row]
 * @returns {{ack: string, techReason: string, businessReason: string}}
 */
function toSyncStatus(row) {
  return {
    ack: row?.ack ?? '',
    techReason: row?.techreason ?? '',
    businessReason: row?.businessreason ?? '',
  };
}

/**
 * SELECT di ack/techreason/businessreason per jobcardid.
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @returns {Promise<{ack: string|null, techreason: string|null, businessreason: string|null}|null>}
 *          la riga, o null se la jobcard non è presente
 */
async function selectSyncStatus(pool, jobCardId) {
  const { rows } = await pool.query(SELECT_SYNC_STATUS_SQL, [jobCardId]);
  return rows[0] ?? null;
}

/**
 * Legge l'esito della sincronizzazione della jobcard (ack/techreason/
 * businessreason di woc.jobcard_sync_activity, per jobcardid) da restituire
 * nelle risposte di jobCardDetails/saveJobcard. Best-effort: id assente, riga
 * inesistente, valori NULL, errori DB o attesa oltre SYNC_STATUS_TIMEOUT_MS
 * producono stringhe vuote; l'errore viene solo loggato e non fa fallire la
 * risposta.
 * @param {string|number|null|undefined} jobCardId
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @param {number} [deps.timeoutMs] - attesa massima in ms (iniettabile nei test)
 * @returns {Promise<{ack: string, techReason: string, businessReason: string}>}
 */
async function getSyncStatus(jobCardId, { getPool, timeoutMs = SYNC_STATUS_TIMEOUT_MS } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) return toSyncStatus(null);

  let timer;
  try {
    const resolveGetPool = getPool ?? require('./db').getPool;
    const read = (async () => selectSyncStatus(await resolveGetPool(), id))();
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout dopo ${timeoutMs} ms`)), timeoutMs);
      timer.unref?.();
    });
    return toSyncStatus(await Promise.race([read, timeout]));
  } catch (err) {
    console.warn(`[jobCard] jobcard_sync_activity lettura esito fallita jobcardid=${id}: ${err.message}`);
    return toSyncStatus(null);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aggiunge ack/techReason/businessReason (v. getSyncStatus) al body della
 * risposta: subito prima di jobCardDetail quando presente (jobCardDetails),
 * altrimenti in coda (saveJobcard). Un body non oggetto viene restituito
 * invariato.
 * @param {object} body - risposta DGT (eventualmente già arricchita)
 * @param {{ack: string, techReason: string, businessReason: string}} syncStatus
 * @returns {object} nuovo body con i campi dell'esito
 */
function withSyncStatus(body, syncStatus) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (!Object.prototype.hasOwnProperty.call(body, 'jobCardDetail')) return { ...body, ...syncStatus };

  const { jobCardDetail, ...head } = body;
  return { ...head, ...syncStatus, jobCardDetail };
}

/**
 * SELECT del payload registrato e dell'esito (ack/techreason/businessreason)
 * per jobcardid.
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @returns {Promise<{jobcardid: string, ack: string|null, techreason: string|null,
 *          businessreason: string|null, payload: object}|null>} la riga, o null
 *          se la jobcard non è presente
 */
async function selectLastPayload(pool, jobCardId) {
  const { rows } = await pool.query(SELECT_LAST_PAYLOAD_SQL, [jobCardId]);
  return rows[0] ?? null;
}

/**
 * Legge l'ultimo payload saveJobcard registrato per la jobcard (colonna
 * payload di woc.jobcard_sync_activity, sovrascritta ad ogni saveJobcard PRIMA
 * dell'invio a DGT, quindi presente anche se l'invio è poi fallito): consente
 * di recuperare le modifiche inviate in delta (azione GET "lastPayload").
 * Con la stessa SELECT restituisce anche ack/techReason/businessReason della
 * riga (esito dell'ultima sincronizzazione registrata da synch-status; NULL ->
 * stringa vuota, come getSyncStatus).
 * Bloccante, a differenza di getSyncStatus: id assente -> errore "is
 * required" senza accesso al DB; errori DB/pool propagati al chiamante.
 * @param {string|number|null|undefined} jobCardId
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @returns {Promise<{jobCardId: string, ack: string, techReason: string,
 *          businessReason: string, payload: object}|null>} null se la jobcard
 *          non ha un payload registrato
 */
async function getLastPayload(jobCardId, { getPool } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) throw new Error('[jobCard] jobCardId is required');

  const resolveGetPool = getPool ?? require('./db').getPool;
  const row = await selectLastPayload(await resolveGetPool(), id);
  return row ? { jobCardId: row.jobcardid, ...toSyncStatus(row), payload: row.payload } : null;
}

module.exports = {
  resolveJobCardId,
  upsertSyncActivity,
  recordSyncActivity,
  selectSyncStatus,
  getSyncStatus,
  withSyncStatus,
  selectLastPayload,
  getLastPayload,
  UPSERT_SQL,
  SELECT_SYNC_STATUS_SQL,
  SELECT_LAST_PAYLOAD_SQL,
};
