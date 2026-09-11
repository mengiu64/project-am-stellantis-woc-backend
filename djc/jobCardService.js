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
 * Calls the jobCard (POST) endpoint to persist a Digital Job Card payload —
 * il json_mod costruito dai metodi Save* di DjcManager (SaveRoInfo,
 * SaveDmsSync, SaveCustomer, SaveVehicle, SaveJobs, SaveConsents,
 * SaveAppointments). Stesso client PingFederate/DGT usato da jobcard per le
 * GET /jobCardList e /jobCardDetails: cambiano solo metodo HTTP e path
 * (POST /jobCard).
 * @param {string} bearerToken - Bearer token from PingFederate
 * @param {object} payload     - Digital Job Card payload to persist
 * @returns {Promise<object>} parsed response body
 */
async function saveJobCard(bearerToken, payload) {
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    throw new Error('[djc] payload is required');
  }

  const body = JSON.stringify(payload);
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

module.exports = { saveJobCard };
