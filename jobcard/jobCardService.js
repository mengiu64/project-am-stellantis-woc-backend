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
 * @param {string} method       - HTTP method ('GET'|'POST'|...)
 * @param {object} extraHeaders - additional request headers (parameters included)
 * @param {string} bearerToken  - Bearer token value
 * @returns {object} https.request options
 */
function buildDgtOptions(path, method, extraHeaders, bearerToken) {
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

  const options = buildDgtOptions('/jobCardList', 'GET', headers, bearerToken);

  console.log(`[jobCard] GET jobCardList - dealerId: ${dealerId}`);
  const response = await httpsRequest(options);

  // The DGT API returns HTTP 404 (instead of 200 with an empty array) when a
  // filtered query matches no job cards (e.g. { "message": "No job cards found" }).
  // Treat this as a normal, empty result set rather than a fatal error, so that
  // callers combining several queries (e.g. getJobCardListCurrent) don't abort
  // just because one of the date ranges has no matches.
  if (response.statusCode === 404) {
    console.log(`[jobCard] jobCardList - dealerId: ${dealerId} - no job cards found (404), treating as empty result`);
    return {
      statusCode: 200,
      success: true,
      jobCardList: [],
      pagination: {
        page: page != null ? page : 1,
        pageSize: resolvedPageSize,
        totalItems: 0,
        totalPages: 0,
        hasPrevious: false,
        hasNext: false,
      },
    };
  }

  if (response.statusCode !== 200) {
    throw new Error(
      `[jobCard] jobCardList failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * Adds `days` days to a "YYYY-MM-DD" date string, returning the result in the
 * same format (UTC-based, avoids timezone/DST surprises).
 * @param {string} dateStr - date in "YYYY-MM-DD" format
 * @param {number} days    - number of days to add (may be negative)
 * @returns {string} resulting date in "YYYY-MM-DD" format
 */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Converts a "YYYY-MM-DD" date string into an ISO 8601 UTC date-time, at
 * either the start (00:01:00.000Z) or the end (23:59:00.000Z) of that day.
 * @param {string} dateStr     - date in "YYYY-MM-DD" format
 * @param {boolean} [endOfDay] - true for the end of the day, false (default) for the start
 * @returns {string} ISO 8601 date-time string
 * commit
 */
function toIsoDateTime(dateStr, endOfDay = false) {
  return `${dateStr}T${endOfDay ? '23:59:00.000' : '00:01:00.000'}Z`;
}

/**
 * Checks whether a JobCard list entry already has a reception or delivery
 * date/time set (estimated or actual) on any of its appointments
 * (appointments[].reception.estimatedReceptionDateTime /
 * appointments[].reception.receptionDateTime /
 * appointments[].delivery.estimatedDeliveryDateTime /
 * appointments[].delivery.deliveryDateTime).
 * @param {object} item - JobCard list entry
 * @returns {boolean} true if at least one of these date/times is set
 */
function hasEstimatedDateTime(item) {
  const appointments = Array.isArray(item?.appointments) ? item.appointments : [];
  const isSet = (value) => value !== undefined && value !== null;
  return appointments.some((appt) => (
    isSet(appt?.reception?.estimatedReceptionDateTime)
    || isSet(appt?.reception?.receptionDateTime)
    || isSet(appt?.delivery?.estimatedDeliveryDateTime)
    || isSet(appt?.delivery?.deliveryDateTime)
  ));
}

/**
 * Builds a stable dedup key for a JobCard list entry, preferring jobCardSrpId
 * (the most specific identifier in the JobCard schema), falling back to
 * jobCardLegacyId then dmsRepairOrderId when it is missing.
 * @param {object} item - JobCard list entry
 * @returns {string} dedup key
 */
function jobCardKey(item) {
  return String(item?.jobCardSrpId ?? item?.jobCardLegacyId ?? item?.dmsRepairOrderId ?? JSON.stringify(item));
}

/**
 * Merges several JobCard list arrays into a single array without duplicates:
 * the same JobCard present in more than one input array (e.g. a card with
 * both reception and delivery scheduled today) is kept only once, using the
 * first occurrence found (in the order the arrays are passed).
 * @param {...object[]} arrays - JobCard arrays to merge
 * @returns {object[]} merged, deduplicated JobCard array
 */
function mergeDistinctJobCards(...arrays) {
  const seen = new Map();
  for (const arr of arrays) {
    for (const item of arr) {
      const key = jobCardKey(item);
      if (!seen.has(key)) seen.set(key, item);
    }
  }
  return [...seen.values()];
}

/**
 * Retrieves the "current" JobCard list for a dealer, merging three
 * getJobCardList queries anchored on a reference date:
 *
 *  1) arrayReception — jobCardList filtered by receptionStartDate=currentDate,
 *     receptionEndDate=currentDate+1 day (reception scheduled "today").
 *  2) arrayDelivery  — jobCardList filtered by deliveryStartDate=currentDate,
 *     deliveryEndDate=currentDate+1 day (delivery scheduled "today").
 *  3) arrayCreated   — jobCardList filtered by creationStartDate=currentDate-7 days,
 *     creationEndDate=currentDate (created over the last week), excluding entries
 *     that already have a reception/delivery date/time (estimated or actual) set
 *     (already covered by arrayReception/arrayDelivery above, or scheduled/completed
 *     on a different day) or whose status is not "CREATED".
 *
 * The three arrays are merged into a single, deduplicated JobCard list
 * (same JobCard appearing in more than one array is kept only once).
 *
 * @param {string} bearerToken - ****** from PingFederate
 * @param {string} dealerId    - (Mandatory) Dealer identifier
 * @param {string} currentDate - Reference date, "YYYY-MM-DD" format (e.g. "2026-05-20")
 * @returns {Promise<{ jobCardList: object[] }>} merged, deduplicated JobCard list
 */
async function getJobCardListCurrent(bearerToken, dealerId, currentDate) {
  if (!dealerId) {
    throw new Error('[jobCard] dealerId is required');
  }
  if (!currentDate) {
    throw new Error('[jobCard] currentDate is required');
  }

  const weekAgoDate = addDays(currentDate, -7);

  const [receptionResult, deliveryResult, createdResult] = await Promise.all([
    getJobCardList(bearerToken, {
      dealerId,
      receptionStartDate: toIsoDateTime(currentDate),
      receptionEndDate:   toIsoDateTime(currentDate, true),
    }),
    getJobCardList(bearerToken, {
      dealerId,
      deliveryStartDate: toIsoDateTime(currentDate),
      deliveryEndDate:   toIsoDateTime(currentDate, true),
    }),
    getJobCardList(bearerToken, {
      dealerId,
      creationStartDate: toIsoDateTime(weekAgoDate),
      creationEndDate:   toIsoDateTime(currentDate, true),
    }),
  ]);

  const arrayReception  = Array.isArray(receptionResult?.jobCardList) ? receptionResult.jobCardList : [];
  const arrayDelivery   = Array.isArray(deliveryResult?.jobCardList)  ? deliveryResult.jobCardList  : [];
  const arrayCreatedRaw = Array.isArray(createdResult?.jobCardList)   ? createdResult.jobCardList   : [];

  const arrayCreated = arrayCreatedRaw.filter(
    (item) => !hasEstimatedDateTime(item) && item?.status === 'CREATED',
  );

  return { jobCardList: mergeDistinctJobCards(arrayReception, arrayDelivery, arrayCreated) };
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

  const options = buildDgtOptions('/jobCardDetails', 'GET', { jobCardId: String(jobCardId) }, bearerToken);

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

/**
 * Returns a copy of a job entry without the packageType/packageCharge fields
 * added by enrichJobsWithPackageInfo to jobCardDetails GET responses. Those
 * are derived only for UI display: if a caller round-trips a previously
 * fetched jobCardDetail.jobs entry back into saveJobCard, the DGT API
 * rejects them with "is not allowed" validation errors.
 * @param {object} job - job entry (possibly enriched)
 * @returns {object} job entry without packageType/packageCharge
 */
function stripPackageEnrichment(job) {
  if (!job || typeof job !== 'object') return job;
  const { packageType, packageCharge, ...rest } = job;
  return rest;
}

/**
 * Calls the jobCard (POST) endpoint to persist a Digital Job Card payload —
 * i.e. the same "declination" (djc) payload built by djc/DjcManager.js
 * Save* methods (json_mod). Uses the same PingFederate/DGT client
 * (config.js/authService.js/httpClient.js) as getJobCardList/getJobCardDetails,
 * only the HTTP method and path differ (POST /jobCard vs GET /jobCardList|
 * /jobCardDetails).
 *
 * Difensivo: se payload.jobs porta ancora packageType/packageCharge (es.
 * round-trip di una jobCardDetails GET arricchita — v. enrichJobsWithPackageInfo
 * sopra), vengono rimossi prima di inoltrare a DGT, che li rifiuta in
 * POST /jobCard con "is not allowed".
 * @param {string} bearerToken - Bearer token from PingFederate
 * @param {object} payload     - Digital Job Card payload to persist
 * @returns {Promise<object>} parsed response body
 */
async function saveJobCard(bearerToken, payload) {
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    throw new Error('[jobCard] payload is required');
  }

  const sanitizedPayload = Array.isArray(payload.jobs)
    ? { ...payload, jobs: payload.jobs.map(stripPackageEnrichment) }
    : payload;

  const body = JSON.stringify(sanitizedPayload);
  const options = buildDgtOptions(
    '/jobCard',
    'POST',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    bearerToken
  );

  console.log('[jobCard] POST jobCard');
  const response = await httpsRequest(options, body);

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    throw new Error(
      `[jobCard] jobCard failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

module.exports = { getJobCardList, getJobCardListCurrent, getJobCardDetails, saveJobCard };
