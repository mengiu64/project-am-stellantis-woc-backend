'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

/**
 * Builds common HTTPS request options for DGT API calls.
 * @param {string} path         - API path (e.g. '/jobCardList')
 * @param {object} extraHeaders - additional request headers (parameters included)
 * @param {string} bearerToken  - Bearer token
 * @returns {object} https.request options
 */
function buildDgtOptions(path, extraHeaders, bearerToken) {
  const base = new URL(config.dgt.baseUrl);
  return {
    hostname: base.hostname,
    port: base.port || 443,
    path: `${config.dgt.basePath}${path}`,
    method: 'GET',
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
 * Calls jobCardList endpoint.
 *
 * @param {string} bearerToken - Bearer token from PingFederate
 * @param {object} params      - Request parameters
 * @param {string}   params.dealerId            - (Mandatory) Dealer identifier
 * @param {string}  [params.vin]                - VIN number
 * @param {string}  [params.creationStartDate]  - ISO 8601 start of creation range
 * @param {string}  [params.creationEndDate]    - ISO 8601 end of creation range
 * @param {string}  [params.deliveryStartDate]  - ISO 8601 start of delivery range
 * @param {string}  [params.deliveryEndDate]    - ISO 8601 end of delivery range
 * @param {string}  [params.receptionStartDate] - ISO 8601 start of reception range
 * @param {string}  [params.receptionEndDate]   - ISO 8601 end of reception range
 * @param {string}  [params.licensePlate]       - License plate number
 * @param {string}  [params.dmsRepairOrderId]   - DMS repair order ID
 * @param {string}  [params.customerName]       - Customer first/last name or company
 * @param {number}  [params.page]               - 1-based page index
 * @param {number}  [params.pageSize]           - Items per page (10|25|50|100) (default: 50)
 * @param {string}  [params.sortBy]             - Sort attribute (jobCardId|creationDate|vin|status)
 * @param {string}  [params.sortOrder]          - Sort direction (asc|desc)
 * @returns {Promise<object>} parsed response body
 */
async function getJobCardList(bearerToken, params = {}) {
  const {
    dealerId,
    vin,
    creationStartDate,
    creationEndDate,
    deliveryStartDate,
    deliveryEndDate,
    receptionStartDate,
    receptionEndDate,
    licensePlate,
    dmsRepairOrderId,
    customerName,
    page,
    pageSize,
    sortBy,
    sortOrder,
  } = params;

  const resolvedPageSize = pageSize != null ? pageSize : 50;

  if (!dealerId) {
    throw new Error('[jobCard] dealerId is required');
  }

  const headers = { dealerId };
  if (vin)                headers.vin                = vin;
  if (creationStartDate)  headers.creationStartDate  = creationStartDate;
  if (creationEndDate)    headers.creationEndDate    = creationEndDate;
  if (deliveryStartDate)  headers.deliveryStartDate  = deliveryStartDate;
  if (deliveryEndDate)    headers.deliveryEndDate    = deliveryEndDate;
  if (receptionStartDate) headers.receptionStartDate = receptionStartDate;
  if (receptionEndDate)   headers.receptionEndDate   = receptionEndDate;
  if (licensePlate)       headers.licensePlate       = licensePlate;
  if (dmsRepairOrderId)   headers.dmsRepairOrderId   = dmsRepairOrderId;
  if (customerName)       headers.customerName       = customerName;
  if (page      != null)  headers.page               = String(page);
  headers.pageSize = String(resolvedPageSize);
  if (sortBy)             headers.sortBy             = sortBy;
  if (sortOrder)          headers.sortOrder          = sortOrder;

  const options = buildDgtOptions('/jobCardList', headers, bearerToken);

  console.log(`[jobCard] GET jobCardList - dealerId: ${dealerId}`);
  const response = await httpsRequest(options);

  if (response.statusCode !== 200) {
    throw new Error(
      `[jobCard] jobCardList failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * Normalizes an address string coming from the upstream DL API, which separates
 * its sub-fields (street number, city, ...) with ";" (e.g. "13;poissy ;test").
 * Replaces every ";" with a space and collapses/trims extra whitespace.
 * @param {string} address - raw address value
 * @returns {string} sanitized address
 */
function sanitizeAddress(address) {
  if (typeof address !== 'string') return address;
  return address.replace(/;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Checks whether a value is "present" for the purposes of packageType/
 * packageCharge derivation, i.e. not undefined, not null and not an empty
 * string.
 * @param {*} value - value to check
 * @returns {boolean} true if value is present
 */
function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Computes packageType and packageCharge for a single job entry, based on
 * jobType/packageCode/paymentType:
 * - jobType === 'MFP'                              => packageType 'FP',  packageCharge 'CUSTOMER'
 * - jobType === 'STD' with packageCode present      => packageType 'QE',  packageCharge 'CUSTOMER'
 * - jobType === 'LFP'                               => packageType 'LFP', packageCharge 'CUSTOMER'
 * - jobType === 'STD' without packageCode           => packageType 'GC',  packageCharge 'CUSTOMER'
 * - any other present jobType                       => packageType 'GC',  packageCharge 'INTERNAL'
 * - jobType absent/empty/null                       => packageType 'GC',  packageCharge 'CUSTOMER'
 * In every case, if paymentType is present on the job it takes precedence
 * over the packageCharge value derived above.
 * @param {object} job - single entry of jobCardDetail.jobs
 * @returns {{packageType: string, packageCharge: string}}
 */
function computePackageInfo(job) {
  const { jobType, packageCode, paymentType } = job ?? {};

  let packageType;
  let packageCharge;

  if (jobType === 'MFP') {
    packageType   = 'FP';
    packageCharge = 'CUSTOMER';
  } else if (jobType === 'STD' && isPresent(packageCode)) {
    packageType   = 'QE';
    packageCharge = 'CUSTOMER';
  } else if (jobType === 'LFP') {
    packageType   = 'LFP';
    packageCharge = 'CUSTOMER';
  } else if (jobType === 'STD' && !isPresent(packageCode)) {
    packageType   = 'GC';
    packageCharge = 'CUSTOMER';
  } else if (isPresent(jobType)) {
    packageType   = 'GC';
    packageCharge = 'INTERNAL';
  } else {
    // jobType assente/vuoto/null
    packageType   = 'GC';
    packageCharge = 'CUSTOMER';
  }

  if (isPresent(paymentType)) {
    packageCharge = paymentType;
  }

  return { packageType, packageCharge };
}

/**
 * Returns a copy of the job with packageType/packageCharge inserted right
 * before partInfo/laborInfo (whichever comes first), so that they stay easy
 * to spot instead of being buried after the (often long) parts/labor arrays.
 * If neither partInfo nor laborInfo is present, they are simply appended.
 * @param {object} job            - original job entry
 * @param {string} packageType    - computed packageType
 * @param {string} packageCharge  - computed packageCharge
 * @returns {object} new job object with the same keys, reordered
 */
function insertPackageInfoBeforePartsAndLabor(job, packageType, packageCharge) {
  const entries      = Object.entries(job);
  const insertIndex  = entries.findIndex(([key]) => key === 'partInfo' || key === 'laborInfo');
  const packageEntries = [['packageType', packageType], ['packageCharge', packageCharge]];

  const newEntries = insertIndex === -1
    ? [...entries, ...packageEntries]
    : [...entries.slice(0, insertIndex), ...packageEntries, ...entries.slice(insertIndex)];

  return Object.fromEntries(newEntries);
}

/**
 * Adds packageType and packageCharge to every entry of jobCardDetail.jobs in
 * a jobCardDetails response body. The two fields are placed right before
 * partInfo/laborInfo for readability (see computePackageInfo for the
 * derivation rules), which requires replacing each job with a reordered copy.
 * @param {object} body - jobCardDetails response body
 * @returns {object} the same body, with packageType/packageCharge added to jobs
 */
function enrichJobsWithPackageInfo(body) {
  const jobs = body?.jobCardDetail?.jobs;
  if (Array.isArray(jobs)) {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (job && typeof job === 'object') {
        const { packageType, packageCharge } = computePackageInfo(job);
        jobs[i] = insertPackageInfoBeforePartsAndLabor(job, packageType, packageCharge);
      }
    }
  }
  return body;
}

/**
 * Returns a copy of obj with a new key inserted right after an existing key
 * (or appended at the end if that key is not found), preserving all other
 * keys/order. Used to keep derived fields close to the field they mirror.
 * @param {object} obj      - source object
 * @param {string} afterKey - key after which the new key should be inserted
 * @param {string} newKey   - key to insert
 * @param {*} value         - value for newKey
 * @returns {object} new object with the same keys plus newKey, reordered
 */
function insertKeyAfter(obj, afterKey, newKey, value) {
  const entries  = Object.entries(obj);
  const idx      = entries.findIndex(([key]) => key === afterKey);
  const newEntry = [newKey, value];

  const newEntries = idx === -1
    ? [...entries, newEntry]
    : [...entries.slice(0, idx + 1), newEntry, ...entries.slice(idx + 1)];

  return Object.fromEntries(newEntries);
}

/**
 * Adds roInfo.roSource to a jobCardDetails response body, mirroring
 * roInfo.sourceApplication (placed right after it for readability).
 * @param {object} body - jobCardDetails response body
 * @returns {object} the same body, with roInfo.roSource added
 */
function addRoSource(body) {
  const roInfo = body?.jobCardDetail?.roInfo;
  if (roInfo && typeof roInfo === 'object') {
    body.jobCardDetail.roInfo = insertKeyAfter(roInfo, 'sourceApplication', 'roSource', roInfo.sourceApplication);
  }
  return body;
}

/**
 * Sanitizes the address field of every customerInfo.contactInfo entry in a
 * jobCardDetails response body, in place.
 * @param {object} body - jobCardDetails response body
 * @returns {object} the same body, with sanitized addresses
 */
function sanitizeJobCardDetails(body) {
  const customerInfo = body?.jobCardDetail?.customerInfo;
  if (Array.isArray(customerInfo)) {
    for (const customer of customerInfo) {
      if (customer?.contactInfo?.address) {
        customer.contactInfo.address = sanitizeAddress(customer.contactInfo.address);
      }
    }
  }
  enrichJobsWithPackageInfo(body);
  addRoSource(body);
  return body;
}

/**
 * Persiste la risposta di jobCardDetails in /tmp/<jobCardId>.json, così da
 * poter essere letta da un'altra lambda (es. djc) senza rifare la chiamata a
 * DGT. Un eventuale errore di scrittura non deve far fallire la richiesta:
 * viene solo loggato come warning.
 * @param {string|number} jobCardId - usato come nome file (<jobCardId>.json)
 * @param {object} body             - jobCardDetails response body (già sanitizzato)
 */
function saveJobCardDetailsToTmp(jobCardId, body) {
  const filePath = path.join('/tmp', `${jobCardId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(body), 'utf8');
    console.log(`[jobCard] jobCardDetails salvato in ${filePath}`);
  } catch (err) {
    console.warn(`[jobCard] impossibile salvare jobCardDetails in ${filePath}: ${err.message}`);
  }
}

/**
 * Calls jobCardDetails endpoint.
 * @param {string} bearerToken      - Bearer token from PingFederate
 * @param {string|number} jobCardId - JobCard identifier (input parameter)
 * @returns {Promise<object>} parsed response body
 */
async function getJobCardDetails(bearerToken, jobCardId) {
  if (jobCardId === undefined || jobCardId === null || jobCardId === '') {
    throw new Error('[jobCard] jobCardId is required');
  }

  const options = buildDgtOptions('/jobCardDetails', { jobCardId: String(jobCardId) }, bearerToken);

  console.log(`[jobCard] GET jobCardDetails - jobCardId: ${jobCardId}`);
  const response = await httpsRequest(options);

  if (response.statusCode !== 200) {
    throw new Error(
      `[jobCard] jobCardDetails failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  const sanitized = sanitizeJobCardDetails(response.body);
  saveJobCardDetailsToTmp(jobCardId, sanitized);

  return sanitized;
}

module.exports = { getJobCardList, getJobCardDetails };
