'use strict';

/**
 * jobcardSyncActivity.js — esito della sincronizzazione DJC su
 * woc.jobcard_sync_activity (v. sql/create_table_jobcard_sync_activity.sql).
 *
 * Il record (jobcardid, creationdate, payload) è creato dalle lambda
 * jobcard/djc ad ogni saveJobcard; qui, alla ricezione dell'evento DJC:
 *   1) techreason     = djc_sync_status (mappato da eventType),
 *      ack            = OK (DMS_PUSH_SUCCESS_WITHOUT_UPDATE / DMS_PUSH_SUCCESS_WITH_UPDATE)
 *                       o KO (DMS_PUSH_REFUSAL / DMS_PUSH_FAILURE), lastupdate = now()
 *   2) businessreason = roInfo.dmsSynchroStatus + dmsReturnMessage restituiti
 *                       da jobCardDetails
 *                       (jobcard/jobCardService.js, imbarcato in-process via
 *                       Makefile), lastupdate = now()
 *
 * Interamente best-effort: ogni errore viene loggato e mai propagato, così la
 * risposta verso DJC resta invariata.
 */

const path = require('path');

const EVENT_TYPE_TO_ACK = Object.freeze({
  DMS_PUSH_SUCCESS_WITHOUT_UPDATE: 'OK',
  DMS_PUSH_SUCCESS_WITH_UPDATE: 'OK',
  DMS_PUSH_REFUSAL: 'KO',
  DMS_PUSH_FAILURE: 'KO',
});

const UPDATE_TECHREASON_SQL = `
  UPDATE woc.jobcard_sync_activity
  SET techreason = $2, ack = $3, lastupdate = now()
  WHERE jobcardid = $1
  RETURNING jobcardid`;

const UPDATE_BUSINESSREASON_SQL = `
  UPDATE woc.jobcard_sync_activity
  SET businessreason = $2, lastupdate = now()
  WHERE jobcardid = $1
  RETURNING jobcardid`;

/**
 * Carica in modo lazy i servizi della lambda jobcard (cartella sorella), così
 * il loro albero di dipendenze viene caricato solo quando serve.
 */
function loadJobcardServices() {
  const { getBearerToken } = require(path.resolve(__dirname, '../jobcard/authService'));
  const { getJobCardDetails } = require(path.resolve(__dirname, '../jobcard/jobCardService'));
  return { getBearerToken, getJobCardDetails };
}

/**
 * Richiama jobCardDetails (lambda jobcard) e compone il businessreason da
 * roInfo.dmsSynchroStatus e roInfo.dmsReturnMessage.
 * @param {string} jobCardId
 * @param {object} [deps] - iniettabile nei test
 * @returns {Promise<string|null>}
 */
async function fetchBusinessReason(jobCardId, deps = loadJobcardServices()) {
  const token = await deps.getBearerToken();
  const body = await deps.getJobCardDetails(token, jobCardId);
  const roInfo = body?.jobCardDetail?.roInfo ?? body?.roInfo;
  const reasonParts = [roInfo?.dmsSynchroStatus, roInfo?.dmsReturnMessage]
    .filter((value) => typeof value === 'string' && value.trim() !== '');
  return reasonParts.length > 0 ? reasonParts.join(' - ') : null;
}

/**
 * Aggiorna techreason/ack e poi businessreason di woc.jobcard_sync_activity per la
 * jobcard indicata. Non solleva mai eccezioni.
 * @param {object} params
 * @param {import('pg').Pool} params.pool
 * @param {string} params.jobCardId
 * @param {string} params.djcSyncStatus
 * @param {string} params.eventType - evento DJC, determina ack (OK/KO)
 * @param {object} params.logger
 * @param {object} [params.deps] - servizi jobcard, iniettabili nei test
 * @returns {Promise<{techReasonUpdated: boolean, businessReason: (string|null), businessReasonUpdated: boolean}>}
 */
async function syncJobcardActivity({ pool, jobCardId, djcSyncStatus, eventType, logger, deps }) {
  const outcome = { techReasonUpdated: false, ack: EVENT_TYPE_TO_ACK[eventType] ?? null, businessReason: null, businessReasonUpdated: false };

  try {
    const tech = await pool.query(UPDATE_TECHREASON_SQL, [jobCardId, djcSyncStatus, outcome.ack]);
    if (!tech.rows || tech.rows.length === 0) {
      logger.warn('⚠️  jobcard_sync_activity: record non trovato, techreason/ack/businessreason non aggiornati', { jobCardId });
      return outcome;
    }
    outcome.techReasonUpdated = true;
    logger.info('✅ jobcard_sync_activity: techreason/ack aggiornati', { jobCardId, techreason: djcSyncStatus, ack: outcome.ack });
  } catch (err) {
    logger.error('❌ jobcard_sync_activity: errore aggiornamento techreason', { jobCardId, errorMessage: err.message });
    return outcome;
  }

  try {
    outcome.businessReason = await fetchBusinessReason(jobCardId, deps);
  } catch (err) {
    logger.error('❌ jobcard_sync_activity: errore jobCardDetails, businessreason non aggiornato', { jobCardId, errorMessage: err.message });
    return outcome;
  }

  try {
    const business = await pool.query(UPDATE_BUSINESSREASON_SQL, [jobCardId, outcome.businessReason]);
    outcome.businessReasonUpdated = Boolean(business.rows && business.rows.length > 0);
    logger.info('✅ jobcard_sync_activity: businessreason aggiornato', { jobCardId, businessreason: outcome.businessReason });
  } catch (err) {
    logger.error('❌ jobcard_sync_activity: errore aggiornamento businessreason', { jobCardId, errorMessage: err.message });
  }

  return outcome;
}

module.exports = {
  syncJobcardActivity,
  fetchBusinessReason,
  loadJobcardServices,
  EVENT_TYPE_TO_ACK,
  UPDATE_TECHREASON_SQL,
  UPDATE_BUSINESSREASON_SQL,
};
