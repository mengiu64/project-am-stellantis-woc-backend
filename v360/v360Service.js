'use strict';

const { URL } = require('url');
const crypto = require('crypto');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

/**
 * Builds common HTTPS request options for ASV360 API POST calls.
 * @param {string} apiPath     - API path (e.g. '/otaCompatibility')
 * @param {string} bearerToken - Bearer token
 * @param {object} body        - JSON body object
 * @returns {{ options: object, bodyStr: string }}
 */
function buildAsvOptions(apiPath, bearerToken, body) {
  const base = new URL(config.asv.baseUrl);
  const bodyStr = JSON.stringify(body);
  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: `${config.asv.basePath}${apiPath}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'X-IBM-Client-Id': config.asv.clientId,
      'X-IBM-Client-Secret': config.asv.clientSecret,
      Authorization: `Bearer ${bearerToken}`,
      'x-trace-id': crypto.randomBytes(8).toString('hex'),
    },
  };
  return { options, bodyStr };
}

/**
 * Calls otaCompatibility endpoint.
 *
 * @param {string} bearerToken                  - Bearer token from PingFederate
 * @param {object} params
 * @param {string}   params.vin                 - (Mandatory) Vehicle VIN
 * @param {string}  [params.includeOtaHistoryData] - Include OTA history ("true"/"false")
 * @param {string}  [params.locale]             - Locale (e.g. "fr_FR")
 * @returns {Promise<object>} parsed response body
 */
async function otaCompatibility(bearerToken, params = {}) {
  const { vin, includeOtaHistoryData, locale } = params;

  if (!vin) {
    throw new Error('[v360] vin is required for otaCompatibility');
  }

  const body = { vin };
  if (includeOtaHistoryData !== undefined) body.includeOtaHistoryData = includeOtaHistoryData;
  if (locale)                               body.locale = locale;

  const { options, bodyStr } = buildAsvOptions('/otaCompatibility', bearerToken, body);

  console.log(`[v360] POST https://${options.hostname}${options.path}`);
  console.log(`[v360] Body: ${bodyStr}`);
  const response = await httpsRequest(options, bodyStr);

  if (response.statusCode !== 200) {
    throw new Error(
      `[v360] otaCompatibility failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * Calls getdetails endpoint.
 *
 * @param {string} bearerToken                 - Bearer token from PingFederate
 * @param {object} params
 * @param {string}   params.vin                - (Mandatory) Vehicle VIN
 * @param {string}  [params.searchType]        - Search type (default: "vin")
 * @param {string}  [params.countryCode]       - Country code (default: config.getDetailsDefaults.countryCode, e.g. "FR")
 * @param {string}  [params.clientId]          - Client identifier (default: config.getDetailsDefaults.clientId)
 * @param {string}  [params.offering]          - Comma-separated list of offerings (default: config.getDetailsDefaults.offering, e.g. "Vehicle Description,campaign")
 * @param {string}  [params.languageCode]      - Language code (default: config.getDetailsDefaults.languageCode, e.g. "fr")
 * @returns {Promise<object>} parsed response body
 */
async function getDetails(bearerToken, params = {}) {
  const { vin, searchType, countryCode, clientId, offering, languageCode } = params;
  const defaults = config.getDetailsDefaults;

  if (!vin) {
    throw new Error('[v360] vin is required for getdetails');
  }

  const body = {
    searchType: searchType || 'vin',
    vin,
    countryCode: countryCode || defaults.countryCode,
    clientId: clientId || defaults.clientId,
    offering: offering || defaults.offering,
    languageCode: languageCode || defaults.languageCode,
  };

  const { options, bodyStr } = buildAsvOptions('/getdetails', bearerToken, body);

  console.log(`[v360] POST https://${options.hostname}${options.path}`);
  console.log(`[v360] Body: ${bodyStr}`);
  const response = await httpsRequest(options, bodyStr);

  if (response.statusCode !== 200) {
    throw new Error(
      `[v360] getdetails failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

module.exports = { otaCompatibility, getDetails };
