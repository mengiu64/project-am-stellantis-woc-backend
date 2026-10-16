'use strict';

/**
 * JobcardSyncActivityRepository.js — tabella woc.jobcard_sync_activity
 * (v. sql/create_table_jobcard_sync_activity.sql).
 *
 * Ad ogni saveJobcard, PRIMA dell'invio a DGT, djc registra il payload con un
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
 * da true o errore token/HTTP/rete); con false anche lastupdate = now() (ora
 * del fallimento).
 * ack/techreason/businessreason/lastupdate sono popolati in un secondo momento
 * (esito della sincronizzazione, da synch-status), non da questa lambda, che
 * li legge soltanto (getSyncStatus), insieme a djcsynch, per restituirli nella
 * risposta di saveJobcard come djcsynch/ack/techReason/businessReason/
 * updateDateTime (lastupdate in ISO: updateDateTime DJC salvato da
 * synch-status con ack OK/KO, ora del fallimento con djcsynch false,
 * altrimenti null).
 *
 * Copia di jobcard/JobcardSyncActivityRepository.js, mantenuta in sync, salvo
 * SELECT_LAST_PAYLOAD_SQL/selectLastPayload/getLastPayload e
 * DELETE_SYNC_ACTIVITY_SQL/canDeleteSynch/deleteSyncActivity/deleteSynch (solo
 * jobcard). DELETE_KO_SYNC_ACTIVITY_SQL/deleteKoSyncActivity/
 * getDetailsSyncStatus sono presenti solo per allineamento: in djc non vengono
 * chiamati (l'eliminazione della riga KO avviene solo nell'azione "details"
 * di jobcard, che djc non ha).
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

// Con djcsynch false lastupdate diventa l'ora dell'invio a DGT fallito
// (updateDateTime dello stato rosso); con true resta invariato: lo popola
// synch-status insieme all'esito.
const UPDATE_DJC_SYNCH_SQL = `
  UPDATE woc.jobcard_sync_activity
  SET djcsynch = $2::boolean,
    lastupdate = CASE WHEN $2::boolean THEN lastupdate ELSE now() END
  WHERE jobcardid = $1
  RETURNING jobcardid, djcsynch`;

const SELECT_SYNC_STATUS_SQL = `
  SELECT djcsynch, ack, techreason, businessreason, lastupdate
  FROM woc.jobcard_sync_activity
  WHERE jobcardid = $1`;

// DELETE atomica della riga con esito DMS KO dopo una push accettata da DGT
// (djcsynch true): le condizioni sono valutate sulla versione corrente della
// riga, quindi una save appena registrata (UPSERT che azzera ack a NULL) non
// viene eliminata.
const DELETE_KO_SYNC_ACTIVITY_SQL = `
  DELETE FROM woc.jobcard_sync_activity
  WHERE jobcardid = $1 AND djcsynch IS TRUE AND ack = 'KO'
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
    throw new Error(`[djc] roInfo.${JOBCARD_ID_FIELDS.join('/')} is required`);
  }
  const resolveGetPool = getPool ?? require('./db').getPool;
  const pool = await resolveGetPool();
  const row = await upsertSyncActivity(pool, jobCardId, payload, force);
  if (!row) {
    const err = new Error(`[djc] save blocked for jobCardId ${jobCardId}: previous synchronization not acknowledged yet`);
    err.isAckPending = true;
    err.jobCardId = jobCardId;
    throw err;
  }
  console.log(`[djc] jobcard_sync_activity upsert jobcardid=${jobCardId}${force === true ? ' (force)' : ''}`);
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
      console.warn(`[djc] jobcard_sync_activity aggiornamento djcsynch: jobcardid=${id} non presente`);
      return false;
    }
    console.log(`[djc] jobcard_sync_activity djcsynch=${value} jobcardid=${id}`);
    return true;
  } catch (err) {
    console.warn(`[djc] jobcard_sync_activity aggiornamento djcsynch fallito jobcardid=${id}: ${err.message}`);
    return false;
  }
}

// Valori di ack per cui lastupdate è l'updateDateTime DJC scritto da
// synch-status insieme all'esito (v. toUpdateDateTime).
const SYNC_OUTCOME_ACKS = new Set(['OK', 'KO']);

/**
 * updateDateTime della risposta: lastupdate in ISO 8601 solo se l'esito è
 * presente (ack OK/KO) o se l'ultimo invio a DGT è fallito (djcsynch false:
 * lastupdate è l'ora del fallimento, v. UPDATE_DJC_SYNCH_SQL); negli altri
 * casi lastupdate non è l'ora dell'esito corrente (es. riga appena riscritta
 * dall'UPSERT), quindi null. null anche se lastupdate è assente o non valido.
 * @param {string|null|undefined} ack
 * @param {Date|string|null|undefined} lastupdate
 * @param {boolean|null|undefined} [djcsynch]
 * @returns {string|null}
 */
function toUpdateDateTime(ack, lastupdate, djcsynch) {
  if (!SYNC_OUTCOME_ACKS.has(ack) && djcsynch !== false) return null;
  if (lastupdate === undefined || lastupdate === null || lastupdate === '') return null;
  const date = lastupdate instanceof Date ? lastupdate : new Date(lastupdate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Converte una riga di woc.jobcard_sync_activity nei campi della risposta
 * (camelCase). Riga assente (o eliminata, o non letta per errore/timeout):
 * tutti i campi null. Riga presente con valori NULL (esito non ancora
 * popolato): null per djcsynch e stringa vuota per ack/techReason/
 * businessReason. updateDateTime: v. toUpdateDateTime.
 * @param {{djcsynch?: boolean|null, ack?: string|null, techreason?: string|null,
 *          businessreason?: string|null, lastupdate?: Date|string|null}|null} [row]
 * @returns {{djcsynch: boolean|null, ack: string|null, techReason: string|null,
 *          businessReason: string|null, updateDateTime: string|null}}
 */
function toSyncStatus(row) {
  if (!row) {
    return { djcsynch: null, ack: null, techReason: null, businessReason: null, updateDateTime: null };
  }
  return {
    djcsynch: row?.djcsynch ?? null,
    ack: row?.ack ?? '',
    techReason: row?.techreason ?? '',
    businessReason: row?.businessreason ?? '',
    updateDateTime: toUpdateDateTime(row?.ack, row?.lastupdate, row?.djcsynch),
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
 * errori DB o attesa oltre SYNC_STATUS_TIMEOUT_MS producono tutti i campi
 * null (valori NULL di una riga presente: v. toSyncStatus); l'errore viene
 * solo loggato e non fa fallire la risposta.
 * @param {string|number|null|undefined} jobCardId
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @param {number} [deps.timeoutMs] - attesa massima in ms (iniettabile nei test)
 * @returns {Promise<{djcsynch: boolean|null, ack: string|null, techReason: string|null,
 *          businessReason: string|null}>}
 */
async function getSyncStatus(jobCardId, { getPool, timeoutMs = SYNC_STATUS_TIMEOUT_MS } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) return toSyncStatus(null);

  try {
    const resolveGetPool = getPool ?? require('./db').getPool;
    return toSyncStatus(await withTimeout((async () => selectSyncStatus(await resolveGetPool(), id))(), timeoutMs));
  } catch (err) {
    console.warn(`[djc] jobcard_sync_activity lettura esito fallita jobcardid=${id}: ${err.message}`);
    return toSyncStatus(null);
  }
}

/**
 * DELETE della riga con djcsynch true e ack KO per jobcardid (v.
 * DELETE_KO_SYNC_ACTIVITY_SQL).
 * @param {import('pg').Pool} pool
 * @param {string} jobCardId
 * @returns {Promise<{jobcardid: string}|null>} la riga eliminata, o null se la
 *          jobcard non è presente o non ha l'esito KO
 */
async function deleteKoSyncActivity(pool, jobCardId) {
  const { rows } = await pool.query(DELETE_KO_SYNC_ACTIVITY_SQL, [jobCardId]);
  return rows[0] ?? null;
}

/**
 * Esito della jobcard per l'azione "details" di jobcard (copia allineata, non
 * chiamata in djc): se la riga ha djcsynch true e ack KO (push accettata da
 * DGT, rifiuto o errore del DMS) la elimina (DELETE atomica con RETURNING) e
 * restituisce tutti i campi null; altrimenti rilegge l'esito come
 * getSyncStatus. Best-effort come getSyncStatus, con un unico timeout
 * SYNC_STATUS_TIMEOUT_MS per DELETE e SELECT: id assente, errori DB o timeout
 * producono tutti i campi null, l'errore viene solo loggato.
 * @param {string|number|null|undefined} jobCardId
 * @param {object} [deps]
 * @param {() => Promise<import('pg').Pool>} [deps.getPool] - iniettabile nei test
 * @param {number} [deps.timeoutMs] - attesa massima in ms (iniettabile nei test)
 * @returns {Promise<{djcsynch: boolean|null, ack: string|null, techReason: string|null,
 *          businessReason: string|null}>}
 */
async function getDetailsSyncStatus(jobCardId, { getPool, timeoutMs = SYNC_STATUS_TIMEOUT_MS } = {}) {
  const id = jobCardId === undefined || jobCardId === null ? '' : String(jobCardId).trim();
  if (!id) return toSyncStatus(null);

  try {
    const resolveGetPool = getPool ?? require('./db').getPool;
    const row = await withTimeout((async () => {
      const pool = await resolveGetPool();
      if (await deleteKoSyncActivity(pool, id)) {
        console.log(`[djc] jobcard_sync_activity delete esito KO jobcardid=${id}`);
        return null;
      }
      return selectSyncStatus(pool, id);
    })(), timeoutMs);
    return toSyncStatus(row);
  } catch (err) {
    console.warn(`[djc] jobcard_sync_activity lettura/eliminazione esito KO fallita jobcardid=${id}: ${err.message}`);
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

module.exports = {
  resolveJobCardId,
  withTimeout,
  upsertSyncActivity,
  recordSyncActivity,
  updateDjcSynch,
  recordDjcSynch,
  selectSyncStatus,
  getSyncStatus,
  deleteKoSyncActivity,
  getDetailsSyncStatus,
  withSyncStatus,
  UPSERT_SQL,
  UPDATE_DJC_SYNCH_SQL,
  SELECT_SYNC_STATUS_SQL,
  DELETE_KO_SYNC_ACTIVITY_SQL,
};
