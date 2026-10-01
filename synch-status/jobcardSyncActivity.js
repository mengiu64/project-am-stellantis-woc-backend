'use strict';

/**
 * jobcardSyncActivity.js — esito della sincronizzazione DJC su
 * woc.jobcard_sync_activity (v. sql/create_table_jobcard_sync_activity.sql).
 *
 * Il record (jobcardid, creationdate, payload) è creato dalle lambda
 * jobcard/djc ad ogni saveJobcard; qui, alla ricezione dell'evento DJC:
 *   1) techreason     = djc_sync_status (mappato da eventType), lastupdate = now()
 *   2) businessreason = roInfo.dmsSynchroStatus restituito da jobCardDetails
 *                       (jobcard/jobCardService.js, imbarcato in-process via
 *                       Makefile), lastupdate = now()
 *
 * Interamente best-effort: ogni errore viene loggato e mai propagato, così la
 * risposta verso DJC resta invariata.
 */

const path = require('path');

const UPDATE_TECHREASON_SQL = `
  UPDATE woc.jobcard_sync_activity
  SET techreason = $2, lastupdate = now()
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
 * Richiama jobCardDetails (lambda jobcard) e ne estrae roInfo.dmsSynchroStatus.
 * @param {string} jobCardId
 * @param {object} [deps] - iniettabile nei test
 * @returns {Promise<string|null>}
 */
async function fetchDmsSynchroStatus(jobCardId, deps = loadJobcardServices()) {
  const token = await deps.getBearerToken();
  const body = await deps.getJobCardDetails(token, jobCardId);
  const roInfo = body?.jobCardDetail?.roInfo ?? body?.roInfo;
  return roInfo?.dmsSynchroStatus ?? null;
}

/**
 * Aggiorna techreason e poi businessreason di woc.jobcard_sync_activity per la
 * jobcard indicata. Non solleva mai eccezioni.
 * @param {object} params
 * @param {import('pg').Pool} params.pool
 * @param {string} params.jobCardId
 * @param {string} params.djcSyncStatus
 * @param {object} params.logger
 * @param {object} [params.deps] - servizi jobcard, iniettabili nei test
 * @returns {Promise<{techReasonUpdated: boolean, businessReason: (string|null), businessReasonUpdated: boolean}>}
 */
async function syncJobcardActivity({ pool, jobCardId, djcSyncStatus, logger, deps }) {
  const outcome = { techReasonUpdated: false, businessReason: null, businessReasonUpdated: false };

  try {
    const tech = await pool.query(UPDATE_TECHREASON_SQL, [jobCardId, djcSyncStatus]);
    if (!tech.rows || tech.rows.length === 0) {
      logger.warn('⚠️  jobcard_sync_activity: record non trovato, techreason/businessreason non aggiornati', { jobCardId });
      return outcome;
    }
    outcome.techReasonUpdated = true;
    logger.info('✅ jobcard_sync_activity: techreason aggiornato', { jobCardId, techreason: djcSyncStatus });
  } catch (err) {
    logger.error('❌ jobcard_sync_activity: errore aggiornamento techreason', { jobCardId, errorMessage: err.message });
    return outcome;
  }

  try {
    outcome.businessReason = await fetchDmsSynchroStatus(jobCardId, deps);
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
  fetchDmsSynchroStatus,
  loadJobcardServices,
  UPDATE_TECHREASON_SQL,
  UPDATE_BUSINESSREASON_SQL,
};
