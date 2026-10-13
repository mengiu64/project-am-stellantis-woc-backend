'use strict';

/**
 * JobcardSyncActivityRepository.js — tabella woc.jobcard_sync_activity
 * (v. sql/create_table_jobcard_sync_activity.sql).
 *
 * Ad ogni saveJobcard, PRIMA dell'invio a DGT, jobcard registra il payload con un
 * UPSERT su jobcardid:
 *   - INSERT: jobcardid, creationdate (= now()), payload (djcsynch NULL)
 *   - UPDATE (jobcardid già presente): payload, con djcsynch e l'esito della
 *     push precedente (ack/techreason/businessreason) azzerati a NULL: l'esito
 *     del nuovo invio non è ancora noto e quello vecchio non deve essere letto
 *     come esito del nuovo invio
 *   - nessuna scrittura se la push precedente è stata accettata da DGT
 *     (djcsynch true) ma non ha ancora l'ack (NULL o vuoto), salvo force:
 *     errore con isAckPending (409 SYNC_ACK_PENDING)
 * DOPO l'invio, recordDjcSynch registra in djcsynch l'esito della chiamata a
 * DGT: true se DGT risponde success: true, false altrimenti (success diverso
 * da true o errore token/HTTP/rete).
 * ack/techreason/businessreason/lastupdate sono popolati in un secondo momento
 * (esito della sincronizzazione, da synch-status), non da questa lambda, che
 * li legge soltanto (getSyncStatus), insieme a djcsynch, per restituirli nelle
 * risposte di jobCardDetails e saveJobcard come djcsynch/ack/techReason/
 * businessReason.
 * getLastPayload rilegge il payload registrato, insieme a djcsynch/ack/
 * techreason/businessreason della stessa riga (azione GET "lastPayload"), per
 * recuperare le modifiche inviate quando l'aggiornamento verso DJC/DGT fallisce.
 * deleteSynch elimina la riga della jobcard (azione POST "deleteSynch") solo se
 * djcsynch è false (ultimo invio a DGT fallito) e ack/techreason/businessreason
 * sono vuoti (NULL o stringa vuota: nessun esito registrato da synch-status).
 * canDeleteSynch verifica le stesse condizioni sull'esito già letto: l'azione
 * "lastPayload", dopo aver letto il payload, elimina la riga con deleteSynch
 * solo se rispettate.
 *
 * Copia di djc/JobcardSyncActivityRepository.js, mantenuta in sync, salvo
 * SELECT_LAST_PAYLOAD_SQL/selectLastPayload/getLastPayload e
 * DELETE_SYNC_ACTIVITY_SQL/canDeleteSynch/deleteSyncActivity/deleteSynch (solo
 * jobcard).
 */

// UPSERT condizionale atomico: se la riga esiste con djcsynch true e ack vuoto
// (NULL o stringa vuota: push precedente accettata da DGT, esito non ancora
// arrivato da synch-status) l'UPDATE non viene eseguito e RETURNING non
// restituisce righe, salvo $3 (force) true. La condizione è valutata sulla
// versione corrente della riga, quindi anche con UPDATE concorrenti.
// djcsynch NULL o false non blocca.
const UPSERT_SQL = `
  INSERT INTO woc.jobcard_sync_activity (jobcardid, creationdate, payload)
  VALUES ($1, now(), $2::jsonb)
  ON CONFLICT (jobcardid) DO UPDATE SET payload = EXCLUDED.payload, djcsynch = NULL,
    ack = NULL, techreason = NULL, businessreason = NULL
  WHERE $3::boolean
    OR NOT (woc.jobcard_sync_activity.djcsynch IS TRUE
            AND COALESCE(woc.jobcard_sync_activity.ack, '') = '')
  RETURNING jobcardid, creationdate`;

const UPDATE_DJC_SYNCH_SQL = `
  UPDATE woc.jobcard_sync_activity
  SET djcsynch = $2
  WHERE jobcardid = $1
  RETURNING jobcardid, djcsynch`;

const SELECT_SYNC_STATUS_SQL = `
  SELECT djcsynch, ack, techreason, businessreason
  FROM woc.jobcard_sync_activity
  WHERE jobcardid = $1`;

const SELECT_LAST_PAYLOAD_SQL = `
  SELECT jobcardid, djcsynch, ack, techreason, businessreason, payload
  FROM woc.jobcard_sync_activity
  WHERE jobcardid = $1`;

// Le condizioni di deleteSynch sono nella stessa DELETE, quindi verificate
// sulla versione corrente della riga anche con UPDATE concorrenti (djcsynch da
// jobcard/djc, esito da synch-status): djcsynch NULL (esito non ancora noto)
// non è false, la riga resta.
const DELETE_SYNC_ACTIVITY_SQL = `
  DELETE FROM woc.jobcard_sync_activity
  WHERE jobcardid = $1
    AND djcsynch IS FALSE
    AND COALESCE(ack, '') = ''
    AND COALESCE(techreason, '') = ''
    AND COALESCE(businessreason, '') = ''
  RETURNING jobcardid`;

// Attesa massima della lettura dell'esito e della scrittura di djcsynch
// (best-effort): un DB lento o irraggiungibile non deve bloccare la risposta di
// jobCardDetails/saveJobcard (stesso limite di 5 s di connectionTimeoutMillis/
// statement_timeout usato negli altri moduli).
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
 * Attende promise al massimo timeoutMs ms, poi rifiuta con "timeout dopo
 * <timeoutMs> ms" (l'operazione sottostante non viene annullata). Il timer non
 * trattiene l'event loop e viene sempre cancellato.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout dopo ${timeoutMs} ms`)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * UPSERT condizionale del payload saveJobcard in woc.jobcard_sync_activity
 * (v. UPSERT_SQL).
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @param {object} payload - payload effettivamente inviato a DGT
 * @param {boolean} [force=false] - scrive anche se la push precedente attende l'ack
 * @returns {Promise<{jobcardid: string, creationdate: Date}|undefined>} la riga
 *          registrata, undefined se bloccata (push precedente senza ack)
 */
async function upsertSyncActivity(pool, jobCardId, payload, force = false) {
  const { rows } = await pool.query(UPSERT_SQL, [jobCardId, JSON.stringify(payload), force === true]);
  return rows[0];
}

/**
 * Registra il payload saveJobcard (bloccante: eventuali errori vengono
 * propagati al chiamante, che non deve inviare il payload a DGT).
 * Se la riga ha djcsynch true e ack vuoto (push precedente non ancora
 * confermata) e force non è true, nessuna scrittura: errore con
 * isAckPending (409 SYNC_ACK_PENDING nell'handler).
 * @param {object} payload - payload effettivamente inviato a DGT
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @param {boolean} [deps.force=false] - salvataggio forzato dall'utente
 * @returns {Promise<{jobcardid: string, creationdate: Date}>}
 */
async function recordSyncActivity(payload, { getPool, force = false } = {}) {
  const jobCardId = resolveJobCardId(payload);
  if (!jobCardId) {
    throw new Error(`[jobCard] roInfo.${JOBCARD_ID_FIELDS.join('/')} is required`);
  }
  const resolveGetPool = getPool ?? require('./db').getPool;
  const pool = await resolveGetPool();
  const row = await upsertSyncActivity(pool, jobCardId, payload, force);
  if (!row) {
    const err = new Error(`[jobCard] save blocked for jobCardId ${jobCardId}: previous synchronization not acknowledged yet`);
    err.isAckPending = true;
    err.jobCardId = jobCardId;
    throw err;
  }
  console.log(`[jobCard] jobcard_sync_activity upsert jobcardid=${jobCardId}${force === true ? ' (force)' : ''}`);
  return row;
}

/**
 * UPDATE di djcsynch per jobcardid.
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @param {boolean} djcsynch
 * @returns {Promise<{jobcardid: string, djcsynch: boolean}|null>} la riga
 *          aggiornata, o null se la jobcard non è presente
 */
async function updateDjcSynch(pool, jobCardId, djcsynch) {
  const { rows } = await pool.query(UPDATE_DJC_SYNCH_SQL, [jobCardId, djcsynch]);
  return rows[0] ?? null;
}

/**
 * Registra in djcsynch l'esito della chiamata saveJobcard verso DGT: true solo
 * se djcsynch === true (DGT ha risposto success: true), altrimenti false.
 * Best-effort, a differenza di recordSyncActivity: il payload è già stato
 * inviato a DGT, quindi id assente, riga inesistente, errori DB o attesa oltre
 * SYNC_STATUS_TIMEOUT_MS vengono solo loggati e non fanno fallire la risposta.
 * @param {string|number|null|undefined} jobCardId
 * @param {boolean} djcsynch
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @param {number} [deps.timeoutMs] - attesa massima in ms (iniettabile nei test)
 * @returns {Promise<boolean>} true se djcsynch è stato aggiornato
 */
async function recordDjcSynch(jobCardId, djcsynch, { getPool, timeoutMs = SYNC_STATUS_TIMEOUT_MS } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) return false;

  const value = djcsynch === true;
  try {
    const resolveGetPool = getPool ?? require('./db').getPool;
    const row = await withTimeout((async () => updateDjcSynch(await resolveGetPool(), id, value))(), timeoutMs);
    if (!row) {
      console.warn(`[jobCard] jobcard_sync_activity aggiornamento djcsynch: jobcardid=${id} non presente`);
      return false;
    }
    console.log(`[jobCard] jobcard_sync_activity djcsynch=${value} jobcardid=${id}`);
    return true;
  } catch (err) {
    console.warn(`[jobCard] jobcard_sync_activity aggiornamento djcsynch fallito jobcardid=${id}: ${err.message}`);
    return false;
  }
}

/**
 * Converte una riga di woc.jobcard_sync_activity nei campi della risposta
 * (camelCase). Riga assente o valori NULL (esito non ancora popolato) diventano
 * null per djcsynch e stringa vuota per ack/techReason/businessReason.
 * @param {{djcsynch?: boolean|null, ack?: string|null, techreason?: string|null,
 *          businessreason?: string|null}|null} [row]
 * @returns {{djcsynch: boolean|null, ack: string, techReason: string, businessReason: string}}
 */
function toSyncStatus(row) {
  return {
    djcsynch: row?.djcsynch ?? null,
    ack: row?.ack ?? '',
    techReason: row?.techreason ?? '',
    businessReason: row?.businessreason ?? '',
  };
}

/**
 * SELECT di djcsynch/ack/techreason/businessreason per jobcardid.
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @returns {Promise<{djcsynch: boolean|null, ack: string|null, techreason: string|null,
 *          businessreason: string|null}|null>} la riga, o null se la jobcard non è presente
 */
async function selectSyncStatus(pool, jobCardId) {
  const { rows } = await pool.query(SELECT_SYNC_STATUS_SQL, [jobCardId]);
  return rows[0] ?? null;
}

/**
 * Legge l'esito della jobcard (djcsynch/ack/techreason/businessreason di
 * woc.jobcard_sync_activity, per jobcardid) da restituire nelle risposte di
 * jobCardDetails/saveJobcard. Best-effort: id assente, riga inesistente,
 * valori NULL, errori DB o attesa oltre SYNC_STATUS_TIMEOUT_MS producono
 * djcsynch null e stringhe vuote; l'errore viene solo loggato e non fa
 * fallire la risposta.
 * @param {string|number|null|undefined} jobCardId
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @param {number} [deps.timeoutMs] - attesa massima in ms (iniettabile nei test)
 * @returns {Promise<{djcsynch: boolean|null, ack: string, techReason: string, businessReason: string}>}
 */
async function getSyncStatus(jobCardId, { getPool, timeoutMs = SYNC_STATUS_TIMEOUT_MS } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) return toSyncStatus(null);

  try {
    const resolveGetPool = getPool ?? require('./db').getPool;
    return toSyncStatus(await withTimeout((async () => selectSyncStatus(await resolveGetPool(), id))(), timeoutMs));
  } catch (err) {
    console.warn(`[jobCard] jobcard_sync_activity lettura esito fallita jobcardid=${id}: ${err.message}`);
    return toSyncStatus(null);
  }
}

/**
 * Aggiunge djcsynch/ack/techReason/businessReason (v. getSyncStatus) al body
 * della risposta: subito prima di jobCardDetail quando presente
 * (jobCardDetails), altrimenti in coda (saveJobcard). Un body non oggetto
 * viene restituito invariato.
 * @param {object} body - risposta DGT (eventualmente già arricchita)
 * @param {{djcsynch: boolean|null, ack: string, techReason: string, businessReason: string}} syncStatus
 * @returns {object} nuovo body con i campi dell'esito
 */
function withSyncStatus(body, syncStatus) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (!Object.prototype.hasOwnProperty.call(body, 'jobCardDetail')) return { ...body, ...syncStatus };

  const { jobCardDetail, ...head } = body;
  return { ...head, ...syncStatus, jobCardDetail };
}

/**
 * SELECT del payload registrato e dell'esito (djcsynch/ack/techreason/
 * businessreason) per jobcardid.
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @returns {Promise<{jobcardid: string, djcsynch: boolean|null, ack: string|null,
 *          techreason: string|null, businessreason: string|null, payload: object}|null>}
 *          la riga, o null se la jobcard non è presente
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
 * Con la stessa SELECT restituisce anche djcsynch (esito dell'ultima chiamata
 * saveJobcard verso DGT; NULL -> null) e ack/techReason/businessReason della
 * riga (esito dell'ultima sincronizzazione registrata da synch-status; NULL ->
 * stringa vuota), come getSyncStatus.
 * Bloccante, a differenza di getSyncStatus: id assente -> errore "is
 * required" senza accesso al DB; errori DB/pool propagati al chiamante.
 * @param {string|number|null|undefined} jobCardId
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @returns {Promise<{jobCardId: string, djcsynch: boolean|null, ack: string,
 *          techReason: string, businessReason: string, payload: object}|null>}
 *          null se la jobcard non ha un payload registrato
 */
async function getLastPayload(jobCardId, { getPool } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) throw new Error('[jobCard] jobCardId is required');

  const resolveGetPool = getPool ?? require('./db').getPool;
  const row = await selectLastPayload(await resolveGetPool(), id);
  return row ? { jobCardId: row.jobcardid, ...toSyncStatus(row), payload: row.payload } : null;
}

/**
 * true se l'esito (campi camelCase, v. toSyncStatus) rispetta le condizioni di
 * DELETE_SYNC_ACTIVITY_SQL: djcsynch false e ack/techReason/businessReason
 * NULL o stringa vuota (senza trim, come COALESCE(x, '') = ''). Evita la
 * DELETE quando la riga letta non è eliminabile; la DELETE ricontrolla comunque
 * le condizioni sulla versione corrente della riga.
 * @param {{djcsynch?: boolean|null, ack?: string|null, techReason?: string|null,
 *          businessReason?: string|null}|null} [syncStatus]
 * @returns {boolean}
 */
function canDeleteSynch(syncStatus) {
  const { djcsynch, ack, techReason, businessReason } = syncStatus ?? {};
  return djcsynch === false && [ack, techReason, businessReason].every((value) => (value ?? '') === '');
}

/**
 * DELETE condizionato per jobcardid (v. DELETE_SYNC_ACTIVITY_SQL).
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @returns {Promise<{jobcardid: string}|null>} la riga eliminata, o null se la
 *          jobcard non è presente o non rispetta le condizioni
 */
async function deleteSyncActivity(pool, jobCardId) {
  const { rows } = await pool.query(DELETE_SYNC_ACTIVITY_SQL, [jobCardId]);
  return rows[0] ?? null;
}

/**
 * Elimina la riga della jobcard (azione POST "deleteSynch") solo se djcsynch è
 * false (ultimo invio a DGT fallito) e ack/techreason/businessreason sono vuoti
 * (NULL o stringa vuota: nessun esito registrato da synch-status). Se nessuna
 * riga viene eliminata, rilegge l'esito (selectSyncStatus) per distinguere la
 * jobcard non presente dalle condizioni non rispettate.
 * Bloccante, come getLastPayload: id assente -> errore "is required" senza
 * accesso al DB; errori DB/pool propagati al chiamante.
 * @param {string|number|null|undefined} jobCardId
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @returns {Promise<{jobCardId: string, deleted: true}|{jobCardId: string,
 *          deleted: false, djcsynch: boolean|null, ack: string, techReason: string,
 *          businessReason: string}|null>} deleted: true se la riga è stata
 *          eliminata, deleted: false con l'esito attuale se non rispetta le
 *          condizioni, null se la jobcard non è presente
 */
async function deleteSynch(jobCardId, { getPool } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) throw new Error('[jobCard] jobCardId is required');

  const resolveGetPool = getPool ?? require('./db').getPool;
  const pool = await resolveGetPool();
  const deletedRow = await deleteSyncActivity(pool, id);
  if (deletedRow) {
    console.log(`[jobCard] jobcard_sync_activity delete jobcardid=${id}`);
    return { jobCardId: deletedRow.jobcardid, deleted: true };
  }
  const row = await selectSyncStatus(pool, id);
  return row ? { jobCardId: id, deleted: false, ...toSyncStatus(row) } : null;
}

module.exports = {
  resolveJobCardId,
  withTimeout,
  upsertSyncActivity,
  recordSyncActivity,
  updateDjcSynch,
  recordDjcSynch,
  selectSyncStatus,
  getSyncStatus,
  withSyncStatus,
  selectLastPayload,
  getLastPayload,
  canDeleteSynch,
  deleteSyncActivity,
  deleteSynch,
  UPSERT_SQL,
  UPDATE_DJC_SYNCH_SQL,
  SELECT_SYNC_STATUS_SQL,
  SELECT_LAST_PAYLOAD_SQL,
  DELETE_SYNC_ACTIVITY_SQL,
};
