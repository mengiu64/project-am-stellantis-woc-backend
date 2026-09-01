'use strict';

const { URL } = require('url');
const crypto = require('crypto');
const { httpsRequest } = require('./httpClient');
const config = require('./config');
const { S3ConfigRepository } = require('./s3ConfigRepository');

const configRepository = new S3ConfigRepository();

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
 * @param {string} bearerToken                  - ****** from PingFederate
 * @param {object} params
 * @param {string}   params.vin                 - (Mandatory) Vehicle VIN
 * @param {string}  [params.includeOtaHistoryData] - Include OTA history ("true"/"false") (default: config.otaCompatibilityDefaults.includeOtaHistoryData)
 * @param {string}  [params.locale]             - Locale (e.g. "en_EN") (default: config.otaCompatibilityDefaults.locale)
 * @returns {Promise<object>} parsed response body
 */
async function otaCompatibility(bearerToken, params = {}) {
  const { vin, includeOtaHistoryData, locale } = params;
  const defaults = config.otaCompatibilityDefaults;

  if (!vin) {
    throw new Error('[v360] vin is required for otaCompatibility');
  }

  const body = {
    vin,
    includeOtaHistoryData: includeOtaHistoryData !== undefined ? includeOtaHistoryData : defaults.includeOtaHistoryData,
    locale: locale || defaults.locale,
  };

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
 * Inserts a key into an object right before another key, preserving property order
 * (relevant when the object is later serialized with JSON.stringify).
 * If the target key is not found, the new key is appended at the end.
 *
 * @param {object} obj         - source object
 * @param {string} beforeKey   - key before which the new key must be inserted
 * @param {string} newKey      - key to insert
 * @param {*} newValue         - value for the new key
 * @returns {object} a new object with the key inserted in the desired position
 */
function insertKeyBefore(obj, beforeKey, newKey, newValue) {
  const result = {};
  let inserted = false;

  for (const key of Object.keys(obj)) {
    if (key === beforeKey && !inserted) {
      result[newKey] = newValue;
      inserted = true;
    }
    result[key] = obj[key];
  }

  if (!inserted) {
    result[newKey] = newValue;
  }

  return result;
}

/**
 * Deduces the owner from data.brandCode using the static brandowner.json registry
 * (letto da S3 tramite S3ConfigRepository), e, quando owner è "XP", determina
 * data.energyTypeDesignation individuando il primo codice di energytype.json
 * presente in data.salesCode.
 *
 * @param {object} data - the "data" property of the getdetails response body
 * @returns {Promise<void>} mutates data in place
 */
async function enrichWithBrandOwnerAndEnergyType(data) {
  const brandOwners = await configRepository.getBrandOwners();
  const brandOwner = brandOwners.find((entry) => entry.codbrand === data.brandCode);
  const owner = brandOwner ? brandOwner.owner : undefined;

  if (owner !== 'XP' || !data.salesCode) {
    return;
  }

  const salesCodes = String(data.salesCode)
    .split(',')
    .map((code) => code.trim());

  const energyTypes = await configRepository.getEnergyTypes();
  const energyType = energyTypes.find((entry) => salesCodes.includes(entry.cod));

  if (energyType) {
    data.energyTypeDesignation = energyType.descr;
  }
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
 * @param {string}  [params.offering]          - Comma-separated list of offerings (default: config.getDetailsDefaults.offering, e.g. "Vehicle Description, campaign, warranty")
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

  const result = response.body;

  // TODO: externalHexColor is currently hardcoded to null; in the future it will be
  // populated with a value retrieved from the DB.
  if (result && result.data && typeof result.data === 'object') {
    result.data = insertKeyBefore(result.data, 'externalColor', 'externalHexColor', null);
    await enrichWithBrandOwnerAndEnergyType(result.data);
  }

  return result;
}

module.exports = { otaCompatibility, getDetails };
