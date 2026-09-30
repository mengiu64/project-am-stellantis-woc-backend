'use strict';

// Client DGT (Digital Layer) condiviso con la lambda jobcard: djc è la
// "declinazione" della jobcard per la POST /jobCard (Save*), mentre jobcard
// gestisce le GET /jobCardList e /jobCardDetails. Le due lambda condividono lo
// stesso client (config.js/authService.js/httpClient.js) verso lo stesso
// endpoint DGT; questo file espone solo saveJobCard (equivalente a quella
// definita in jobcard/jobCardService.js, mantenuta in sync).

const crypto = require('crypto');
const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');

/**
 * Builds common HTTPS request options for DGT API calls.
 * @param {string} path         - API path (e.g. '/jobCard')
 * @param {string} method       - HTTP method ('GET'|'POST'|...)
 * @param {object} extraHeaders - additional request headers (parameters included)
 * @param {string} bearerToken  - Bearer token value
 * @returns {Promise<object>} https.request options
 */
async function buildDgtOptions(path, method, extraHeaders, bearerToken) {
  const config = await getConfig();
  const base = new URL(config.dgt.baseUrl);
  return {
    hostname: base.hostname,
    port: base.port || 443,
    path: `${config.dgt.basePath}${path}`,
    method,
    headers: {
      'X-IBM-Client-Id': config.dgt.clientId,
      'X-IBM-Client-Secret': config.dgt.clientSecret,
      Authorization: `Bearer ${bearerToken}`,
      'x-trace-id': crypto.randomBytes(8).toString('hex'),
      ...extraHeaders,
    },
  };
}

/**
 * Returns a copy of a partInfo entry without the dmsunknown/QuantityAvailable/
 * availability fields added by jobcard/jobCardService.js::applyDataFromDml
 * (arricchimento DML) alle risposte GET di jobCardDetails. Sono derivati solo
 * per la UI: se il FE ri-sottomette a saveJobCard un partInfo proveniente da
 * una precedente GET arricchita, DGT li rifiuta in POST /jobCard con
 * "is not allowed".
 * @param {object} part - partInfo entry (possibly enriched)
 * @returns {object} partInfo entry without dmsunknown/QuantityAvailable/availability
 */
function stripDmlPartEnrichment(part) {
  if (!part || typeof part !== 'object') return part;
  const { dmsunknown, QuantityAvailable, availability, ...rest } = part;
  return rest;
}

/**
 * Returns a copy of a job entry without the packageType/packageCharge fields
 * (v. jobcard/jobCardService.js::enrichJobsWithPackageInfo) and the
 * dmsOverride field (v. jobcard/jobCardService.js::applyDataFromDml) added
 * alle risposte GET di jobCardDetails. Those are derived only for UI
 * display: if a caller round-trips a previously fetched jobCardDetail.jobs
 * entry back into saveJobCard, the DGT API rejects them with "is not
 * allowed" validation errors. partInfo entries are also sanitized (v.
 * stripDmlPartEnrichment).
 * @param {object} job - job entry (possibly enriched)
 * @returns {object} job entry without packageType/packageCharge/dmsOverride,
 *          with sanitized partInfo entries
 */
function stripPackageEnrichment(job) {
  if (!job || typeof job !== 'object') return job;
  const { packageType, packageCharge, dmsOverride, ...rest } = job;
  if (Array.isArray(rest.partInfo)) {
    rest.partInfo = rest.partInfo.map(stripDmlPartEnrichment);
  }
  return rest;
}

/**
 * Valida il payload saveJobcard e ne restituisce la versione effettivamente
 * inviata a DGT (jobs senza gli arricchimenti di sola UI, v.
 * stripPackageEnrichment). Usata anche da index.js per salvare lo stesso
 * payload in woc.jobcard_sync_activity.
 * @param {object} payload - Digital Job Card payload
 * @returns {object} payload sanitizzato
 */
function sanitizeJobCardPayload(payload) {
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    throw new Error('[djc] payload is required');
  }

  return Array.isArray(payload.jobs)
    ? { ...payload, jobs: payload.jobs.map(stripPackageEnrichment) }
    : payload;
}

/**
 * Calls the jobCard (POST) endpoint to persist a Digital Job Card payload —
 * il json_mod costruito dai metodi Save* di DjcManager (SaveRoInfo,
 * SaveDmsSync, SaveCustomer, SaveVehicle, SaveJobs, SaveConsents,
 * SaveAppointments). Stesso client PingFederate/DGT usato da jobcard per le
 * GET /jobCardList e /jobCardDetails: cambiano solo metodo HTTP e path
 * (POST /jobCard).
 *
 * Difensivo: se payload.jobs porta ancora packageType/packageCharge/dmsOverride
 * o partInfo[].dmsunknown/QuantityAvailable/availability (es. round-trip di
 * una jobCardDetails GET arricchita restituita da jobcard/djc - v.
 * enrichJobsWithPackageInfo/applyDataFromDml in jobcard/jobCardService.js),
 * vengono rimossi prima di inoltrare a DGT, che li rifiuta in POST /jobCard
 * con "is not allowed" (stesso comportamento di jobcard/jobCardService.js,
 * mantenuto in sync).
 * @param {string} bearerToken - Bearer token from PingFederate
 * @param {object} payload     - Digital Job Card payload to persist
 * @returns {Promise<object>} parsed response body
 */
async function saveJobCard(bearerToken, payload) {
  const sanitizedPayload = sanitizeJobCardPayload(payload);

  const body = JSON.stringify(sanitizedPayload);
  const options = await buildDgtOptions(
    '/jobCard',
    'POST',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    bearerToken
  );

  console.log('[djc] POST jobCard');
  const response = await httpsRequest(options, body);

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    throw new Error(
      `[djc] jobCard failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

module.exports = { saveJobCard, sanitizeJobCardPayload };
