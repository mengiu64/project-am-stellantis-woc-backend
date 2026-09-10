'use strict';

const fs = require('fs');
const path = require('path');
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

/** Path del file di cache /tmp per il getdetails di un dato VIN. */
function tmpFilePathForVin(vin) {
  return path.join('/tmp', `v360-getdetails-${vin}.json`);
}

/**
 * Persiste la risposta di getdetails in /tmp/v360-getdetails-<vin>.json, così
 * da poter essere riletta (da questa stessa lambda, azione "getdetails", o da
 * un chiamante in-process come jobcard/pkFavorite/pkManager che bundlano
 * v360/ come cartella sorella — v. dms/dmsService.js
 * ::resolveDynamicSenderFields) senza rifare la chiamata ad ASV360. Un
 * eventuale errore di scrittura non deve far fallire la richiesta: viene
 * solo loggato come warning (stesso pattern di
 * jobcard/jobCardService.js::saveJobCardDetailsToTmp).
 */
function saveGetDetailsToTmp(vin, body) {
  const filePath = tmpFilePathForVin(vin);
  try {
    fs.writeFileSync(filePath, JSON.stringify(body), 'utf8');
    console.log(`[v360] getdetails salvato in ${filePath}`);
  } catch (err) {
    console.warn(`[v360] impossibile salvare getdetails in ${filePath}: ${err.message}`);
  }
  return body;
}

/**
 * Come getDetails, ma legge prima /tmp/v360-getdetails-<vin>.json: se
 * presente (salvato da una precedente chiamata riuscita per lo stesso VIN
 * nella stessa istanza Lambda "warm"), lo restituisce senza richiamare
 * ASV360; altrimenti chiama getDetails e salva la risposta nel file per le
 * richieste successive. Usata sia dall'azione "getdetails" di questa stessa
 * lambda (index.js), sia da getCachedBrand() (chiamata dai chiamanti esterni
 * per il Sender dinamico DMS).
 *
 * @param {string} bearerToken
 * @param {object} params - stessi parametri di getDetails (vin obbligatorio)
 * @returns {Promise<object>} risposta di getdetails (da cache o "live")
 */
async function getDetailsWithCache(bearerToken, params = {}) {
  const { vin } = params;
  if (!vin) {
    throw new Error('[v360] vin is required for getdetails');
  }

  const filePath = tmpFilePathForVin(vin);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    console.log(`[v360] getdetails letto da cache ${filePath}`);
    return JSON.parse(raw);
  } catch (_) {
    // cache assente/non leggibile: richiamo il servizio reale
  }

  const result = await getDetails(bearerToken, params);
  return saveGetDetailsToTmp(vin, result);
}

/**
 * Risolve (best-effort) il codice brand del veicolo (data.brandCode) dato il
 * VIN, tramite getDetailsWithCache (cache /tmp per-vin). Usata dai chiamanti
 * che costruiscono il Sender dinamico dell'inquiry DMS (jobcard, pkFavorite,
 * pkManager — v. dms/dmsService.js::resolveDynamicSenderFields) per popolare
 * il campo `brand` senza doverlo ricevere dal FE: il FE passa solo il VIN
 * (già un dato "di dominio" della richiesta), non un brand esplicito.
 *
 * Interamente best-effort: se il vin è assente, se occorre un ****** e
 * PingFederate/ASV360 non rispondono, o se la risposta non contiene
 * data.brandCode, ritorna null — non blocca mai il chiamante (il Sender
 * resta senza brand, esattamente come prima di questa modifica).
 *
 * @param {string} vin
 * @returns {Promise<string|null>}
 */
async function getCachedBrand(vin) {
  if (!vin) return null;
  try {
    const { getBearerToken } = require(path.resolve(__dirname, './authService'));
    const token = await getBearerToken();
    const result = await getDetailsWithCache(token, { vin });
    return result?.data?.brandCode ?? null;
  } catch (err) {
    console.warn(`[v360] impossibile risolvere il brand per vin="${vin}": ${err.message}`);
    return null;
  }
}

module.exports = { otaCompatibility, getDetails, getDetailsWithCache, getCachedBrand };
