'use strict';

const { callService } = require('../serviceClient');
const { URL } = require('url');
const crypto = require('crypto');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');
const { getBearerToken } = require('./authService');
const { getCacheItem, setCacheItem } = require('./dynamoCache');

/**
 * TTL (in secondi) della cache DynamoDB usata per jobCardDetails: default 1
 * ora, configurabile via env SESSION_CACHE_TTL_SECONDS (stessa variabile
 * usata da v360/v360Service.js per uniformare la durata di sessione).
 */
const JOBCARD_DETAILS_CACHE_TTL_SECONDS = Number(process.env.SESSION_CACHE_TTL_SECONDS) || 3600;

/**
 * Chiave di cache DynamoDB per jobCardDetails, condivisa con djc (che legge
 * lo stesso item per evitare di rifare la chiamata a DGT).
 * @param {string|number} jobCardId
 * @returns {string}
 */
function cacheKeyForJobCard(jobCardId) {
  return `jobcard:jobcarddetails:${jobCardId}`;
}

/**
 * Builds common HTTPS request options for DGT API calls.
 * @param {string} path         - API path (e.g. '/jobCardList')
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

  const options = await buildDgtOptions('/jobCardList', 'GET', headers, bearerToken);

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

  return sanitizeJobCardList(response.body);
}

/**
 * Ensures workshopReturn is a real boolean on every entry of body.jobCardList,
 * as documented in the swagger schema (`JobCard.workshopReturn`), coercing any
 * string/number value returned by the upstream DGT API.
 * @param {object} body - jobCardList response body
 * @returns {object} the same body, with each entry's workshopReturn coerced to boolean
 */
function sanitizeJobCardList(body) {
  const jobCardList = body?.jobCardList;
  if (Array.isArray(jobCardList)) {
    for (const jobCard of jobCardList) {
      if (jobCard && 'workshopReturn' in jobCard) {
        jobCard.workshopReturn = toBoolean(jobCard.workshopReturn);
      }
    }
  }
  return body;
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
 * Retrieves the "current" JobCard list for a dealer, combining three
 * getJobCardList queries anchored on a reference date:
 *
 *  1) arrayReception — jobCardList filtered by receptionStartDate=currentDate,
 *     receptionEndDate=currentDate+1 day (reception scheduled "today"), each
 *     entry tagged with 'type': 'reception'.
 *  2) arrayDelivery  — jobCardList filtered by deliveryStartDate=currentDate,
 *     deliveryEndDate=currentDate+1 day (delivery scheduled "today"), each
 *     entry tagged with 'type': 'delivery'.
 *  3) arrayCreated   — jobCardList filtered by creationStartDate=currentDate-6 days,
 *     creationEndDate=currentDate (created over the last week), excluding entries
 *     that already have a reception/delivery date/time (estimated or actual) set
 *     (already covered by arrayReception/arrayDelivery above, or scheduled/completed
 *     on a different day) or whose status is not "CREATED".
 *
 * The three arrays are concatenated as-is: arrayReception, arrayDelivery and
 * arrayCreatedRaw may contain duplicate JobCards (e.g. a card with both
 * reception and delivery scheduled today).
 *
 * @param {string} bearerToken - ****** from PingFederate
 * @param {string} dealerId    - (Mandatory) Dealer identifier
 * @param {string} currentDate - Reference date, "YYYY-MM-DD" format (e.g. "2026-05-20")
 * @returns {Promise<{ jobCardList: object[] }>} combined JobCard list (may contain duplicates)
 */
async function getJobCardListCurrent(bearerToken, dealerId, currentDate) {
  if (!dealerId) {
    throw new Error('[jobCard] dealerId is required');
  }
  if (!currentDate) {
    throw new Error('[jobCard] currentDate is required');
  }

  const weekAgoDate = addDays(currentDate, -6);

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

  const arrayReception  = (Array.isArray(receptionResult?.jobCardList) ? receptionResult.jobCardList : [])
    .map((item) => ({ ...item, type: 'reception' }));
  const arrayDelivery   = (Array.isArray(deliveryResult?.jobCardList) ? deliveryResult.jobCardList : [])
    .map((item) => ({ ...item, type: 'delivery' }));
  const arrayCreatedRaw = Array.isArray(createdResult?.jobCardList) ? createdResult.jobCardList : [];

  const arrayCreated = arrayCreatedRaw.filter(
    (item) => !hasEstimatedDateTime(item) && item?.status === 'CREATED',
  );

  return { jobCardList: [...arrayReception, ...arrayDelivery, ...arrayCreated] };
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
 * Normalizza appDiscountPercentage/dmsDiscountPercentage su ogni elemento di
 * jobs[].partInfo[]/laborInfo[], in place.
 *
 * Regola (concordata con l'analista): dmsDiscountPercentage arriva dal DMS
 * e NON va MAI modificato; lo sconto effettivo di un figlio e'
 * dmsDiscountPercentage + appDiscountPercentage, quindi per "bilanciare" si
 * agisce solo su appDiscountPercentage (che puo' essere negativo).
 *
 *  - se job.discountInPercentage e' valorizzato (diverso da null/undefined/0),
 *    cioe' c'e' uno sconto sulla workline (padre), i figli devono risultare
 *    a prezzo pieno: dmsDiscountPercentage resta invariato (0 se assente) e
 *    appDiscountPercentage = -dmsDiscountPercentage, cosi' che lo sconto
 *    effettivo del figlio sia 0 (stessa logica di
 *    reconcileDiscountPercentages con wlDiscount=true);
 *  - altrimenti, i campi mancanti vengono aggiunti con valore 0, senza
 *    toccare eventuali valori gia' presenti.
 * @param {object} body - jobCardDetails response body
 * @returns {object} the same body, with appDiscountPercentage/dmsDiscountPercentage normalized
 */
function checkDiscount(body) {
  const jobs = body?.jobCardDetail?.jobs;
  if (!Array.isArray(jobs)) return body;

  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    const hasWorklineDiscount = Boolean(job.discountInPercentage);

    for (const list of [job.partInfo, job.laborInfo]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        if (hasWorklineDiscount) {
          // dms invariato (mai azzerato); app compensa dms per annullare lo
          // sconto del figlio. Il "|| 0" evita di restituire -0 quando dms=0.
          const dmsDiscount = Number(item.dmsDiscountPercentage) || 0;
          item.dmsDiscountPercentage = dmsDiscount;
          item.appDiscountPercentage = -dmsDiscount || 0;
        } else {
          if (!('appDiscountPercentage' in item)) item.appDiscountPercentage = 0;
          if (!('dmsDiscountPercentage' in item)) item.dmsDiscountPercentage = 0;
        }
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
 * Coerces a value coming from the upstream DGT API (which may serialize
 * booleans as strings, e.g. "true"/"false"/"1"/"0") into a real JS boolean.
 * @param {*} value - raw value to coerce
 * @returns {boolean} coerced boolean value
 */
function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['true', '1'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

/**
 * Ensures jobCardDetail.workshopReturn.workshopReturn is a real boolean, as
 * documented in the swagger schema (`WorkshopReturn.workshopReturn`), coercing
 * any string/number value returned by the upstream DGT API.
 * @param {object} body - jobCardDetails response body
 * @returns {object} the same body, with workshopReturn.workshopReturn coerced to boolean
 */
function sanitizeWorkshopReturn(body) {
  const workshopReturn = body?.jobCardDetail?.workshopReturn;
  if (workshopReturn && typeof workshopReturn === 'object' && 'workshopReturn' in workshopReturn) {
    workshopReturn.workshopReturn = toBoolean(workshopReturn.workshopReturn);
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
      // TODO TEMP: rimuovere questo blocco quando la DGT restituirà una email
      // valida. Valorizza contactInfo.email con un default fittizio quando è
      // vuota, per poter testare i flussi a valle che richiedono un'email.
      if (customer?.contactInfo && customer.contactInfo.email === '') {
        customer.contactInfo.email = 'test@eng.it';
      }
      // FINE TODO TEMP
    }
  }
  enrichJobsWithPackageInfo(body);
  checkDiscount(body);
  addRoSource(body);
  sanitizeWorkshopReturn(body);
  return body;
}

/**
 * Persiste la risposta di jobCardDetails in DynamoDB (TmpCacheTable), così da
 * poter essere letta da un'altra lambda (es. djc) senza rifare la chiamata a
 * DGT, con TTL (default 1h) invece del precedente /tmp locale all'istanza.
 * Un eventuale errore di scrittura non deve far fallire la richiesta: viene
 * solo loggato come warning (v. dynamoCache.js::setCacheItem).
 * @param {string|number} jobCardId - usato per costruire la cache key
 * @param {object} body             - jobCardDetails response body (già sanitizzato)
 */
async function saveJobCardDetailsToTmp(jobCardId, body) {
  await setCacheItem(cacheKeyForJobCard(jobCardId), body, JOBCARD_DETAILS_CACHE_TTL_SECONDS);
  return body;
}

/**
 * Costruisce il Sender dinamico (ApplicationArea.Sender) dell'inquiry DMS per
 * getCartPriceAndAvailability, chiamata SEMPRE dopo che il chiamante e' gia'
 * entrato nel dettaglio dell'ordine di riparazione — ha quindi gia' a
 * disposizione il jobCardDetail appena recuperato/sanificato (da cui si
 * legge il VIN). Il **frontend non passa (e non deve passare) mainSincom/
 * market/brand/lingua/country**: se `sessionContext` non li contiene già,
 * vengono risolti automaticamente da `callService('dms', 'resolveSender',
 * { context: { username, vin }, overrides })` — STESSO meccanismo
 * centralizzato usato anche da pkFavorite/index.js::buildDmsSender e
 * pkManager/PkManager.js::_buildDmsSender, cosicché tutti i chiamanti
 * dell'inquiry DMS risolvano il Sender dinamico con gli identici criteri:
 *  - mainSincom/market/language/dealerCountryCode <- username (authorizer.sub),
 *    tramite session/src/sessionContextCache.js (myPeople, cache /tmp)
 *  - brand <- jobCardDetail.roInfo.stellantisBrand (gia' disponibile dalla
 *    jobCardDetails DGT appena recuperata, nessuna chiamata aggiuntiva); solo
 *    se assente si ricade su VIN + v360/v360Service.js::getCachedBrand (v360
 *    getdetails, campo data.brandCode, cache /tmp) — il brand del VEICOLO,
 *    non quello (di default) del dealer/sessione: un dealer multi-brand può
 *    servire un veicolo di un brand diverso dal proprio. Solo jobcard
 *    conosce roInfo.stellantisBrand (dalla propria jobCardDetails), quindi
 *    questa scorciatoia e' locale a jobcard: pkFavorite/pkManager continuano
 *    a risolvere il brand solo tramite v360.
 *
 * componentId e currencyId NON vengono sovrascritti qui: restano i valori
 * statici configurati via env in dms/config.js (config.sender), come da
 * indicazione esplicita — solo i campi realmente dipendenti dal dealer/
 * mercato/utente/veicolo della richiesta corrente vengono valorizzati:
 *  - dealerNumberId          <- sessionContext.mainSincom, o (fallback automatico) session.sincom
 *  - serviceId               <- sessionContext.username (da authorizer.sub)
 *  - languageCode            <- sessionContext.language, o (fallback automatico) session.language
 *  - dealerCountryCode       <- sessionContext.dealerCountryCode, o (fallback automatico) session.marketIso
 *  - brand                   <- sessionContext.brand, o (fallback automatico) jobCardDetail.roInfo.stellantisBrand, o (ultimo fallback) v360 getdetails.data.brandCode per il VIN
 *  - market                  <- sessionContext.market, o (fallback automatico) session.codmarket (solo chiave di lookup, non un campo Sender)
 *
 * physicalSiteId/dealerNumberIdSource NON vengono più risolti qui: il lookup
 * su woc.ang_snowflakes (dbManager/AnagSnowflakesRepository.js
 * ::getPhysicalSiteAndSincom) e' centralizzato in dms/dmsService.js
 * ::buildApplicationArea(), che riceve dealerNumberId/market/brand tramite
 * questo stesso sender e applica lo stesso identico meccanismo/criteri per
 * qualunque chiamante (jobcard, pkManager, pkFavorite) — jobcard non accede
 * più direttamente a dbManager.
 *
 * La risoluzione automatica è **best-effort**: se manca username/vin, o la
 * risoluzione fallisce per qualunque motivo (myPeople/ASV360 irraggiungibili,
 * cache /tmp non scrivibile, ...), i campi mancanti restano semplicemente
 * assenti dal sender (mai un'eccezione che blocchi
 * getCartPriceAndAvailability) — il Sender ricade sui default statici di
 * dms/config.js per quei soli campi.
 *
 * @param {object} jobCardDetail - usato per derivare il VIN (vehicleInfo.identification.vin)
 *                     e il pairedOicCode (roInfo.pairedOicCode, se presente)
 * @param {object} [sessionContext] - dati già disponibili al chiamante (solo username è garantito)
 * @param {string} [sessionContext.username]         - da event.requestContext.authorizer.sub — usato sia come serviceId sia come chiave per la risoluzione automatica via session
 * @param {string} [sessionContext.mainSincom]       - override esplicito (opzionale); se assente, risolto da session.sincom
 * @param {string} [sessionContext.market]           - override esplicito (opzionale); se assente, risolto da session.codmarket (solo per il lookup DB lato dms, non inviato al DML)
 * @param {string} [sessionContext.brand]            - override esplicito (opzionale); se assente, risolto da jobCardDetail.roInfo.stellantisBrand, o (ultimo fallback) da v360 getdetails.data.brandCode per il VIN
 * @param {string} [sessionContext.language]         - override esplicito (opzionale); se assente, risolto da session.language
 * @param {string} [sessionContext.dealerCountryCode] - override esplicito (opzionale); se assente, risolto da session.marketIso
 * @returns {Promise<object>} sender override per l'inquiry REST dms
 */
async function buildDmsSender(jobCardDetail, sessionContext = {}) {
  const { username } = sessionContext;
  const vin = jobCardDetail?.vehicleInfo?.identification?.vin ?? null;
  const pairedOicCode = jobCardDetail?.roInfo?.pairedOicCode ?? null;
  const stellantisBrand = jobCardDetail?.roInfo?.stellantisBrand ?? null;

  // Se sessionContext non porta gia' un brand esplicito, uso quello gia'
  // presente nel jobCardDetail (roInfo.stellantisBrand, valorizzato da DGT
  // nella jobCardDetails appena recuperata): evita una chiamata v360
  // (getdetails) altrimenti sempre necessaria per il solo brand, e con essa
  // il rischio che un v360 lento/irraggiungibile blocchi l'intera richiesta
  // (v. resolveDynamicSenderFields, che ricade su v360 solo se anche
  // roInfo.stellantisBrand e' assente).
  const overrides = { ...sessionContext };
  if (!overrides.brand && stellantisBrand) {
    overrides.brand = stellantisBrand;
  }

  let resolved = overrides;
  try {
    resolved = await callService('dms', 'resolveSender', { context: { username, vin }, overrides });
  } catch (err) {
    console.warn('[jobCard] DMS resolveSender non disponibile, uso gli override:', err.message ?? err);
  }
  const { mainSincom, market, brand, language, dealerCountryCode } = resolved;

  const sender = {};
  if (mainSincom) sender.dealerNumberId = mainSincom;
  if (username) sender.serviceId = username;
  if (language) sender.languageCode = language;
  if (dealerCountryCode) sender.dealerCountryCode = dealerCountryCode;
  if (market) sender.market = market;
  if (brand) sender.brand = brand;
  // Chiave di lookup aggiuntiva (woc.ang_snowflakes.cd_paired_oic_code) per
  // disambiguare il physicalSiteId/dealerNumberIdSource quando più righe
  // corrisponderebbero a mainSincom+market+brand — v. dms/dmsService.js::
  // buildApplicationArea e dbManager/AnagSnowflakesRepository.js::
  // getPhysicalSiteAndSincom. Solo jobcard la conosce (dalla jobCardDetails
  // già recuperata/cache), quindi resta assente per pkManager/pkFavorite.
  if (pairedOicCode) sender.pairedOicCode = pairedOicCode;

  return sender;
}

/**
 * Interroga il servizio REST privato dms (inquiry, MessageType=WL)
 * per prezzo/disponibilita di ricambi e manodopera del jobCardDetail appena
 * recuperato/sanificato, sullo stesso modello di
 * pkManager/PkManager.js::getPriceAndAvailability(). A differenza di
 * quest'ultimo, che passa a postDmsInquiry le workLines "semplificate"
 * (workLineReference/partNumbers/laborOperationIds, con PartType/PartStatus/
 * LaborType fissi decisi dalla lambda dms), qui costruiamo direttamente la
 * struttura WorkLines completa (una sola riga, WorkLineReference '001'), cosi
 * da poter fissare noi stessi PartType/PartStatus/LaborType secondo le
 * specifiche richieste, indipendentemente dai default di dms/dmsService.js.
 *
 * @param {object} jobCardDetail - jobCardDetail (da jobCardDetails GET, dopo
 *                                 sanitizeJobCardDetails): roInfo, vehicleInfo,
 *                                 jobs[].partInfo[]/laborInfo[]
 * @param {object} [sessionContext] - dati di sessione gia' disponibili al chiamante,
 *                                 usati per costruire un Sender dinamico — v. buildDmsSender()
 * @returns {Promise<object>} risultato di dominio InquiryResponse
 */
async function getCartPriceAndAvailability(jobCardDetail, sessionContext = {}) {
  const documentId = jobCardDetail?.roInfo?.jobCardSrpId ?? null;
  const vehicleId = jobCardDetail?.vehicleInfo?.identification?.vin ?? null;

  // Aggrego partNumber/laborOperationCode di tutti i jobs in un'unica WorkLine
  // (WorkLineReference '001'), come da specifica.
  const partNumbers = [];
  const laborOperationIds = [];
  for (const job of jobCardDetail?.jobs ?? []) {
    for (const part of job?.partInfo ?? []) {
      if (part?.partNumber) partNumbers.push(part.partNumber);
    }
    for (const labor of job?.laborInfo ?? []) {
      if (labor?.laborOperationCode) laborOperationIds.push(labor.laborOperationCode);
    }
  }

  const body = {
    PartsInquiryHeader: {
      DocumentID: documentId,
      CustomerIdDms: null,
      MessageType: 'WL',
      VehicleID: vehicleId,
    },
    WorkLines: [
      {
        CustomerAccountDMSID: null,
        WorkLineReference: '001',
        TransactionType: 1,
        PartsItem: partNumbers.map((partNumber) => ({
          PartNumber: partNumber,
          PartType: 'O',
          PartStatus: 'L',
        })),
        LaborItem: laborOperationIds.map((laborOperationId) => ({
          LaborOperationID: laborOperationId,
          LaborType: 'L',
        })),
      },
    ],
    sender: await buildDmsSender(jobCardDetail, sessionContext),
  };

  return callService('dms', 'inquiry', body);
}

/**
 * Estrae, da un WorkLine della risposta DML (getCartPriceAndAvailability),
 * l'elemento "effettivo" da cui leggere prezzo/sconto/disponibilita per un
 * dato PartsItem: se il ricambio richiesto e stato sostituito dal DMS (fuori
 * produzione, ecc.) il PartsItem porta un array ReplacementItem con i dati
 * del ricambio sostitutivo, che ha priorita sui dati del PartsItem originale
 * (stesso schema/campi, piu PartNumber/PartNumberDescription del ricambio
 * sostitutivo).
 * @param {object} partsItem - elemento di WorkLines[].PartsItem[]
 * @returns {{ source: object, isReplacement: boolean }} il record dati da
 *          usare (partsItem stesso o il primo ReplacementItem) e un flag che
 *          indica se e un ricambio sostitutivo (non piu usato per
 *          sovrascrivere partNumber/partDescription in applyDataFromDml,
 *          mantenuto per eventuali usi futuri)
 */
function resolveDmlPartSource(partsItem) {
  const replacement = Array.isArray(partsItem?.ReplacementItem) ? partsItem.ReplacementItem[0] : undefined;
  return replacement ? { source: replacement, isReplacement: true } : { source: partsItem, isReplacement: false };
}

/**
 * Applica alla jobCardDetail (gia sanitizzata) i dati di prezzo/sconto/
 * disponibilita ottenuti da getCartPriceAndAvailability (risposta DML,
 * MessageType=WL), sovrascrivendo/aggiungendo in place i campi di ciascun
 * jobs[].partInfo[]/laborInfo[] che trovano corrispondenza per PartNumber/
 * laborOperationCode nelle WorkLines della risposta.
 *
 * Match:
 *  - partInfo[].partNumber       <-> WorkLines[].PartsItem[].PartNumber
 *  - laborInfo[].laborOperationCode <-> WorkLines[].LaborItems[].LaborOperationID
 *
 * Ogni part riceve inoltre il flag part.dmsunknown: 1 se il partNumber non
 * trova corrispondenza in nessun PartsItem della risposta DML (il ricambio
 * non e' quindi arricchito con prezzo/sconto/disponibilita), 0 altrimenti.
 *
 * Ogni job (workline) riceve anche il flag job.dmsOverride: true se ALMENO
 * uno dei suoi partInfo[]/laborInfo[] ha subito un vero e proprio override
 * da parte del DMS, cioe' se il prezzo (originalPriceExclVat) ricalcolato
 * con i dati DML risulta effettivamente diverso da quello precedente (v.
 * isPriceChanged) e/o se lo sconto DMS e' cambiato rispetto al dettaglio.
 * Uno sconto DMS gia' uguale non viene applicato una seconda volta.
 * Un semplice match PartNumber/LaborOperationID nella risposta DML che non
 * porta ne' un prezzo diverso ne' uno sconto (es. solo dati di
 * disponibilita/BinLocation, come nel caso di ricambi "in stock" senza
 * prezzo valorizzato) NON fa scattare dmsOverride: il part/labor viene
 * comunque arricchito con QuantityAvailable/availability (v. sotto) ma il
 * job resta considerato invariato ai fini di dmsOverride/ricalcolo totali.
 *
 * Per i ricambi (partInfo), se il PartsItem corrispondente porta un
 * ReplacementItem (ricambio sostitutivo proposto dal DMS), i dati vengono
 * letti da li invece che dal PartsItem originale (v. resolveDmlPartSource).
 *
 * Per ciascun job (workline) si determina se lo sconto e' applicato a
 * livello di workline (wlDiscount, v. hasWorkLineDiscount) in base a
 * job.discountInAmountOnPriceWithVat/job.discountInPercentage; questo flag
 * guida la riconciliazione tra sconto applicativo (appDiscountPercentage) e
 * sconto DMS (dmsDiscountPercentage) di ogni part/labor (v.
 * reconcileDiscountPercentages), solo quando lo sconto restituito e' diverso
 * da quello gia' presente. I prezzi vengono ricalcolati solo quando cambia
 * prezzo o sconto, usando la somma dei due sconti, e arrotondati a due
 * decimali (v. computePartPriceFields/computeLaborPriceFields) — ma solo se
 * itemQuantity/unitaryPriceExclVat (part) o
 * laborDuration/UnitaryTimeAmount (labor) sono entrambi definiti e diversi da
 * zero, per evitare di sovrascrivere i campi prezzo con zeri quando manca
 * quantita' o prezzo/tariffa unitaria (v. computePartPriceFields).
 *
 * Per ogni job con dmsOverride===true, i totali a livello di job vengono
 * ricalcolati sommando i partInfo[]/laborInfo[] correnti (v.
 * recalculateJobTotals); se almeno un job ha dmsOverride===true, anche
 * roInfo.totalPrice viene ricalcolato sommando i totali dei soli job
 * CUSTOMER e applicando alla fine lo sconto generale
 * (v. recalculateRoInfoTotals). Se nessun job ha subito un vero override
 * (prezzo diverso o sconto DMS applicato), ne' i job ne' roInfo.totalPrice
 * vengono toccati (restano i totali originali, tipicamente da DGT).
 *
 * @param {object} jobCardDetail - jobCardDetail (jobs[].partInfo[]/laborInfo[]),
 *                                 modificato in place
 * @param {object} dmlResponse   - risposta di getCartPriceAndAvailability (con WorkLines[])
 * @returns {object} lo stesso jobCardDetail, con i campi sovrascritti/aggiunti
 */
/**
 * Deduce il livello di disponibilita di un ricambio confrontando la quantita
 * richiesta (itemQuantity, dal jobCardDetail originale) con la quantita
 * disponibile a magazzino (QuantityAvailable, dalla risposta DML):
 *  - itemQuantity > QuantityAvailable => 'red'    (quantita richiesta non coperta)
 *  - itemQuantity = QuantityAvailable => 'orange' (quantita richiesta al limite)
 *  - itemQuantity < QuantityAvailable => 'green'  (quantita richiesta coperta)
 *
 * @param {number} itemQuantity      - quantita richiesta (part.itemQuantity)
 * @param {number} quantityAvailable - quantita disponibile (part.QuantityAvailable)
 * @returns {'red'|'orange'|'green'|undefined} il livello di disponibilita, o
 *          undefined se uno dei due valori non e disponibile
 */
function computeAvailability(itemQuantity, quantityAvailable) {
  if (itemQuantity === undefined || itemQuantity === null
    || quantityAvailable === undefined || quantityAvailable === null) {
    return undefined;
  }
  if (itemQuantity > quantityAvailable) return 'red';
  if (itemQuantity === quantityAvailable) return 'orange';
  return 'green';
}

/**
 * Determina se, per un job (workline) del jobCardDetail, lo sconto e'
 * applicato a livello di workline: vero se almeno uno tra
 * job.discountInAmountOnPriceWithVat e job.discountInPercentage e'
 * valorizzato (diverso da null/undefined/0). Guida la riconciliazione tra
 * sconto applicativo e sconto DMS di ciascun part/labor del job (v.
 * reconcileDiscountPercentages).
 * @param {object} job - elemento di jobCardDetail.jobs[]
 * @returns {boolean}
 */
function hasWorkLineDiscount(job) {
  return Boolean(job?.discountInAmountOnPriceWithVat) || Boolean(job?.discountInPercentage);
}

/**
 * Riconcilia, in place su `target` (un elemento di partInfo[]/laborInfo[]),
 * lo sconto applicativo (target.appDiscountPercentage) con lo sconto
 * ricevuto dal DML (dmsSourceDiscountPercentage, letto da
 * source.DiscountPercentage per i ricambi o da laborItem.DiscountPercentage
 * per la manodopera), in base a `wlDiscount` (v. hasWorkLineDiscount):
 *
 *  - wlDiscount=true, dmsSourceDiscountPercentage!=0:
 *      appDiscountPercentage = -dmsSourceDiscountPercentage, dmsDiscountPercentage = dmsSourceDiscountPercentage
 *  - wlDiscount=true, dmsSourceDiscountPercentage=0:
 *      dmsDiscountPercentage = dmsSourceDiscountPercentage (appDiscountPercentage invariato)
 *  - wlDiscount=false, appDiscountPercentage!=0, dmsDiscountPercentage=0:
 *      appDiscountPercentage -= dmsSourceDiscountPercentage, dmsDiscountPercentage = dmsSourceDiscountPercentage
 *  - wlDiscount=false, appDiscountPercentage!=0, dmsDiscountPercentage!=0:
 *      appDiscountPercentage = (appDiscountPercentage + dmsDiscountPercentage) - dmsSourceDiscountPercentage,
 *      dmsDiscountPercentage = dmsSourceDiscountPercentage
 *  - wlDiscount=false, appDiscountPercentage=0:
 *      dmsDiscountPercentage = dmsSourceDiscountPercentage
 *
 * @param {object} target - part o labor (jobs[].partInfo[]/laborInfo[] item), modificato in place
 * @param {boolean} wlDiscount - v. hasWorkLineDiscount
 * @param {number} [dmsSourceDiscountPercentage] - sconto restituito dal DML per questo ricambio/manodopera
 */
function reconcileDiscountPercentages(target, wlDiscount, dmsSourceDiscountPercentage) {
  const oldAppDiscount = target.appDiscountPercentage ?? 0;
  const oldDmsDiscount = target.dmsDiscountPercentage ?? 0;
  const dmsDiscount = dmsSourceDiscountPercentage ?? 0;

  if (wlDiscount) {
    if (dmsDiscount !== 0) {
      target.appDiscountPercentage = -dmsDiscount;
      target.dmsDiscountPercentage = dmsDiscount;
    } else {
      target.dmsDiscountPercentage = dmsDiscount;
    }
  } else if (oldAppDiscount !== 0 && oldDmsDiscount === 0) {
    target.appDiscountPercentage = oldAppDiscount - dmsDiscount;
    target.dmsDiscountPercentage = dmsDiscount;
  } else if (oldAppDiscount !== 0 && oldDmsDiscount !== 0) {
    target.appDiscountPercentage = (oldAppDiscount + oldDmsDiscount) - dmsDiscount;
    target.dmsDiscountPercentage = dmsDiscount;
  } else if (oldAppDiscount === 0) {
    target.dmsDiscountPercentage = dmsDiscount;
  }
}

/**
 * Calcola i campi di prezzo/sconto di un ricambio (partInfo[]), considerando
 * come sconto complessivo la somma di appDiscountPercentage e
 * dmsDiscountPercentage (gia' riconciliati, v. reconcileDiscountPercentages).
 * @param {number} itemQuantity          - part.itemQuantity
 * @param {number} unitaryPriceExclVat   - part.unitaryPriceExclVat
 * @param {number} appDiscountPercentage - part.appDiscountPercentage
 * @param {number} dmsDiscountPercentage - part.dmsDiscountPercentage
 * @param {number} vatPercentage         - part.vatPercentage
 * @returns {{ originalPriceExclVat: number, originalPriceWithVat: number,
 *             priceExclVatAfterDiscount: number, priceWithVatAfterDiscount: number,
 *             discountInAmountOnPriceWithVat: number }}
 */
function computePartPriceFields(itemQuantity, unitaryPriceExclVat, appDiscountPercentage, dmsDiscountPercentage, vatPercentage) {
  const quantity = itemQuantity ?? 0;
  const unitPrice = unitaryPriceExclVat ?? 0;
  const vat = vatPercentage ?? 0;
  const discount = (appDiscountPercentage ?? 0) + (dmsDiscountPercentage ?? 0);

  const originalPriceExclVat = roundMoney(quantity * unitPrice);
  const originalPriceWithVat = roundMoney(originalPriceExclVat * (1 + vat / 100));
  const priceExclVatAfterDiscount = roundMoney(originalPriceExclVat * (1 - discount / 100));
  const priceWithVatAfterDiscount = roundMoney(priceExclVatAfterDiscount * (1 + vat / 100));
  const discountInAmountOnPriceWithVat = roundMoney(originalPriceWithVat - priceWithVatAfterDiscount);

  return {
    originalPriceExclVat,
    originalPriceWithVat,
    priceExclVatAfterDiscount,
    priceWithVatAfterDiscount,
    discountInAmountOnPriceWithVat,
  };
}

/**
 * Calcola i campi di prezzo/sconto di una manodopera (laborInfo[]),
 * considerando come sconto complessivo la somma di appDiscountPercentage e
 * dmsDiscountPercentage (gia' riconciliati, v. reconcileDiscountPercentages).
 * @param {number} laborDuration         - labor.laborDuration
 * @param {number} laborRate             - tariffa oraria (DML: LaborItem.UnitaryTimeAmount)
 * @param {number} appDiscountPercentage - labor.appDiscountPercentage
 * @param {number} dmsDiscountPercentage - labor.dmsDiscountPercentage
 * @param {number} vatPercentage         - labor.vatPercentage
 * @returns {{ laborRateAmount: number, originalPriceExclVat: number, originalPriceWithVat: number,
 *             priceExclVatAfterDiscount: number, priceWithVatAfterDiscount: number,
 *             discountInAmountOnPriceWithVat: number }}
 */
function computeLaborPriceFields(laborDuration, laborRate, appDiscountPercentage, dmsDiscountPercentage, vatPercentage) {
  const duration = laborDuration ?? 0;
  const rate = laborRate ?? 0;
  const vat = vatPercentage ?? 0;
  const discount = (appDiscountPercentage ?? 0) + (dmsDiscountPercentage ?? 0);

  const laborRateAmount = roundMoney(rate);
  const originalPriceExclVat = roundMoney(duration * laborRateAmount);
  const originalPriceWithVat = roundMoney(originalPriceExclVat * (1 + vat / 100));
  const priceExclVatAfterDiscount = roundMoney(originalPriceExclVat * (1 - discount / 100));
  const priceWithVatAfterDiscount = roundMoney(priceExclVatAfterDiscount * (1 + vat / 100));
  const discountInAmountOnPriceWithVat = roundMoney(originalPriceWithVat - priceWithVatAfterDiscount);

  return {
    laborRateAmount,
    originalPriceExclVat,
    originalPriceWithVat,
    priceExclVatAfterDiscount,
    priceWithVatAfterDiscount,
    discountInAmountOnPriceWithVat,
  };
}

/**
 * Arrotonda un importo monetario a due decimali, evitando artefatti binari
 * come 110.91752000000001 nei risultati JSON.
 * @param {number} value - importo da arrotondare
 * @returns {number}
 */
function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return amount;
  return Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100) / 100;
}

/**
 * Arrotonda i campi monetari già presenti su un part o una manodopera.
 * @param {object} item - elemento partInfo[] o laborInfo[]
 */
function roundItemPriceFields(item) {
  for (const field of [
    'unitaryPriceExclVat',
    'laborRateAmount',
    'originalPriceExclVat',
    'originalPriceWithVat',
    'priceExclVatAfterDiscount',
    'priceWithVatAfterDiscount',
    'discountInAmountOnPriceWithVat',
  ]) {
    if (item[field] !== undefined && item[field] !== null) {
      item[field] = roundMoney(item[field]);
    }
  }
}

function samePercentage(left, right) {
  return Number(left ?? 0) === Number(right ?? 0);
}

/**
 * Somma un campo numerico su un array di elementi (partInfo[]/laborInfo[]/
 * jobs[]), trattando valori assenti/non numerici come 0 (Number(x)||0).
 * @param {Array<object>} items - elementi da sommare
 * @param {string} field - nome del campo da sommare su ciascun elemento
 * @returns {number}
 */
function sumField(items, field) {
  return (items ?? []).reduce((acc, item) => acc + (Number(item?.[field]) || 0), 0);
}

/**
 * Tolleranza (in valuta) usata da isPriceChanged per ignorare differenze di
 * arrotondamento tra il prezzo originale (jobCardDetail/DGT) e quello
 * ricalcolato con i dati DML.
 */
const PRICE_CHANGE_EPSILON = 0.005;

/**
 * Determina se il prezzo (originalPriceExclVat) di un part/labor e'
 * effettivamente cambiato rispetto al valore precedente (quello presente nel
 * jobCardDetail prima dell'arricchimento DML), a meno di errori di
 * arrotondamento (v. PRICE_CHANGE_EPSILON). Usata da applyDataFromDml per
 * decidere se il match DML costituisce un vero e proprio override di
 * prezzo (v. job.dmsOverride).
 * @param {number} newPrice      - originalPriceExclVat ricalcolato con i dati DML
 * @param {number} previousPrice - originalPriceExclVat presente prima dell'arricchimento
 * @returns {boolean} true se non c'era un valore precedente, o se i due valori differiscono
 */
function isPriceChanged(newPrice, previousPrice) {
  if (previousPrice === undefined || previousPrice === null) return true;
  return Math.abs((Number(newPrice) || 0) - (Number(previousPrice) || 0)) > PRICE_CHANGE_EPSILON;
}

/**
 * Restituisce lo sconto di workline del job (job.discountInPercentage), normalizzato
 * nell'intervallo [0, 100]; 0 se assente o non numerico.
 * @param {object} job - elemento di jobCardDetail.jobs[]
 * @returns {number}
 */
function getWorklineDiscountPercentage(job) {
  const discount = Number(job?.discountInPercentage) || 0;
  return Math.min(100, Math.max(0, discount));
}

/**
 * true se il job e' un pacchetto a prezzo fisso (FP/LFP): il prezzo sta solo a
 * livello di workline e NON e' la somma dei figli (regola confermata dall'analista).
 * Usa job.packageType (v. enrichJobsWithPackageInfo) o, se assente, lo ricalcola
 * da jobType con computePackageInfo.
 * @param {object} job - elemento di jobCardDetail.jobs[]
 * @returns {boolean}
 */
function isFixedPriceJob(job) {
  const packageType = job?.packageType ?? computePackageInfo(job ?? {}).packageType;
  return packageType === 'FP' || packageType === 'LFP';
}

/**
 * Ricalcola, in place, i totali a livello di job (jobs[]) sommando i valori
 * correnti di partInfo[]/laborInfo[] (gia' eventualmente sovrascritti con i
 * dati DML da applyDataFromDml): originalPriceExclVat/originalPriceWithVat
 * sono la somma dei rispettivi campi di TUTTI i partInfo[]+laborInfo[] del job
 * (matchati o meno nel DML, usando il valore correntemente presente su ciascuno);
 * priceExclVatAfterDiscount/priceWithVatAfterDiscount sono la somma dei prezzi
 * scontati dei figli oppure, con sconto di workline (job.discountInPercentage),
 * l'originale x (1 - sconto workline);
 * discountInAmountOnPriceWithVat = originalPriceWithVat -
 * priceWithVatAfterDiscount (coerente con computePartPriceFields/
 * computeLaborPriceFields). totalPartsAmountRequested/
 * totalLaborAmountRequested sono la somma di originalPriceExclVat
 * (l'importo "richiesto", cioe' prima dello sconto) rispettivamente di
 * partInfo[]/laborInfo[]; totalLaborDurationRequested e' la somma di
 * laborInfo[].laborDuration. Invocata da applyDataFromDml SOLO per i job con
 * un vero override DML (job.dmsOverride === true, v. isPriceChanged) e NON a
 * prezzo fisso (FP/LFP, v. isFixedPriceJob): se
 * nessun part/labor del job ha un prezzo diverso o uno sconto DMS applicato,
 * i totali restano quelli originali (in genere quelli restituiti da DGT).
 * @param {object} job - elemento di jobCardDetail.jobs[], modificato in place
 */
function recalculateJobTotals(job) {
  const parts = job?.partInfo ?? [];
  const labors = job?.laborInfo ?? [];

  const originalPriceExclVat = sumField(parts, 'originalPriceExclVat') + sumField(labors, 'originalPriceExclVat');
  const originalPriceWithVat = sumField(parts, 'originalPriceWithVat') + sumField(labors, 'originalPriceWithVat');
  // Sconto di workline (job.discountInPercentage, regola confermata dall'analista,
  // stessa del FE job-card-autosave.service.ts): i figli sono riportati a prezzo
  // pieno (appDiscountPercentage = -dmsDiscountPercentage, v. reconcileDiscountPercentages),
  // quindi il prezzo scontato del job e' la somma dei prezzi ORIGINALI dei figli
  // x (1 - sconto workline). Senza sconto di workline: somma dei prezzi scontati
  // dei figli (che includono gli eventuali sconti DMS/applicativi di riga).
  const worklineDiscount = getWorklineDiscountPercentage(job);
  const worklineFactor = 1 - worklineDiscount / 100;
  const priceExclVatAfterDiscount = worklineDiscount > 0
    ? originalPriceExclVat * worklineFactor
    : sumField(parts, 'priceExclVatAfterDiscount') + sumField(labors, 'priceExclVatAfterDiscount');
  const priceWithVatAfterDiscount = worklineDiscount > 0
    ? originalPriceWithVat * worklineFactor
    : sumField(parts, 'priceWithVatAfterDiscount') + sumField(labors, 'priceWithVatAfterDiscount');

  job.originalPriceExclVat = roundMoney(originalPriceExclVat);
  job.originalPriceWithVat = roundMoney(originalPriceWithVat);
  job.priceExclVatAfterDiscount = roundMoney(priceExclVatAfterDiscount);
  job.priceWithVatAfterDiscount = roundMoney(priceWithVatAfterDiscount);
  job.discountInAmountOnPriceWithVat = roundMoney(originalPriceWithVat - priceWithVatAfterDiscount);

  job.totalPartsAmountRequested = roundMoney(sumField(parts, 'originalPriceExclVat'));
  job.totalLaborAmountRequested = roundMoney(sumField(labors, 'originalPriceExclVat'));
  job.totalLaborDurationRequested = sumField(labors, 'laborDuration');
}

/**
 * Risolve la modalita' di pagamento di un job: job.paymentType, o
 * job.packageCharge quando paymentType non e' valorizzato (stessa
 * risoluzione di enrichJobsWithPackageInfo).
 * @param {object} job - elemento di jobCardDetail.jobs[]
 * @returns {string|undefined}
 */
function resolveJobPaymentType(job) {
  return job?.paymentType || job?.packageCharge;
}

/**
 * Somma job.priceWithVatAfterDiscount dei jobs[] la cui modalita' di
 * pagamento (v. resolveJobPaymentType) corrisponde a `paymentType`.
 * @param {Array<object>} jobs - jobCardDetail.jobs[]
 * @param {'CUSTOMER'|'INSURANCE'|'MANUFACTURER'|'INTERNAL'} paymentType
 * @returns {number}
 */
function sumPriceWithVatByPaymentType(jobs, paymentType) {
  return jobs
    .filter(job => resolveJobPaymentType(job) === paymentType)
    .reduce((acc, job) => acc + (Number(job?.priceWithVatAfterDiscount) || 0), 0);
}

/**
 * Restituisce lo sconto generale del carrello (roInfo.discounts.discountInPercentage),
 * normalizzato nell'intervallo [0, 100]; 0 se assente o non numerico.
 * @param {object} roInfo - jobCardDetail.roInfo
 * @returns {number}
 */
function getGlobalDiscountPercentage(roInfo) {
  const discount = Number(roInfo?.discounts?.discountInPercentage) || 0;
  return Math.min(100, Math.max(0, discount));
}

/**
 * Ricalcola, in place, roInfo.totalPrice (e roInfo.discounts.discountInAmountOnPriceWithVat)
 * a partire dai totali dei jobs[] (gia' ricalcolati da recalculateJobTotals dove applicabile).
 * Invocata da applyDataFromDml SOLO se almeno un job ha dmsOverride === true.
 *
 * Regole concordate con l'analista (stesse del FE, job-card-autosave.service.ts):
 *  1. Nella somma dei prezzi contano SOLO i job CUSTOMER (v. resolveJobPaymentType):
 *     i job MANUFACTURER/INTERNAL/INSURANCE non entrano nei totali complessivi.
 *  2. Lo sconto generale (roInfo.discounts.discountInPercentage) NON e' mai dentro
 *     i singoli job: si applica SOLO alla fine, sul totale netto dei job CUSTOMER
 *     (gia' comprensivo degli sconti di workline/figli).
 *
 * Campi calcolati (g = sconto generale in %, v. getGlobalDiscountPercentage):
 *  - originalPriceExclVat/originalPriceWithVat: somma dei prezzi originali (prima di
 *    qualunque sconto) dei job CUSTOMER; se un job non ha il prezzo originale si usa
 *    quello scontato (nessuno sconto noto sul job);
 *  - priceExclVatAfterDiscount/priceWithVatAfterDiscount: somma dei prezzi scontati
 *    dei job CUSTOMER × (1 - g/100);
 *  - totalCustomerWithVat: = priceWithVatAfterDiscount (cio' che paga il cliente);
 *  - totalInsuranceWithVat/totalManufacturerWithVat/totalInternalWithVat: somma dei
 *    job del rispettivo pagatore, SENZA sconto generale (solo informativi);
 *  - roInfo.discounts.discountInAmountOnPriceWithVat (solo se roInfo.discounts e'
 *    gia' presente: non viene creato, es. sorgente WIADVISOR che non gestisce sconti):
 *    (originale CUSTOMER - netto CUSTOMER), cioe' gli sconti di workline/figli,
 *    + netto CUSTOMER × g/100, cioe' l'importo dello sconto generale.
 *    roInfo.discounts.discountInPercentage resta invariato.
 * No-op se jobCardDetail.roInfo non e' un oggetto.
 * @param {object} jobCardDetail - modificato in place
 */
function recalculateRoInfoTotals(jobCardDetail) {
  const roInfo = jobCardDetail?.roInfo;
  if (!roInfo || typeof roInfo !== 'object') return;

  const jobs = jobCardDetail.jobs ?? [];
  const customerJobs = jobs.filter(job => resolveJobPaymentType(job) === 'CUSTOMER');
  const globalFactor = 1 - getGlobalDiscountPercentage(roInfo) / 100;

  // Totali dei soli job CUSTOMER, con sconti di workline/figli ma senza sconto generale.
  const originalPriceExclVat = customerJobs.reduce(
    (acc, job) => acc + (Number(job?.originalPriceExclVat ?? job?.priceExclVatAfterDiscount) || 0), 0);
  const originalPriceWithVat = customerJobs.reduce(
    (acc, job) => acc + (Number(job?.originalPriceWithVat ?? job?.priceWithVatAfterDiscount) || 0), 0);
  const netPriceExclVat = sumField(customerJobs, 'priceExclVatAfterDiscount');
  const netPriceWithVat = sumField(customerJobs, 'priceWithVatAfterDiscount');

  // Sconto generale applicato una sola volta, sul totale finale.
  const priceWithVatAfterDiscount = roundMoney(netPriceWithVat * globalFactor);

  roInfo.totalPrice = {
    ...roInfo.totalPrice,
    originalPriceExclVat: roundMoney(originalPriceExclVat),
    originalPriceWithVat: roundMoney(originalPriceWithVat),
    priceExclVatAfterDiscount: roundMoney(netPriceExclVat * globalFactor),
    priceWithVatAfterDiscount,
    totalCustomerWithVat: priceWithVatAfterDiscount,
    totalInsuranceWithVat: roundMoney(sumPriceWithVatByPaymentType(jobs, 'INSURANCE')),
    totalManufacturerWithVat: roundMoney(sumPriceWithVatByPaymentType(jobs, 'MANUFACTURER')),
    totalInternalWithVat: roundMoney(sumPriceWithVatByPaymentType(jobs, 'INTERNAL')),
  };

  if (roInfo.discounts && typeof roInfo.discounts === 'object') {
    // Sconti di workline/figli (originale - netto) + importo dello sconto generale
    // calcolato a parte sul netto (equivale a originale - totale finale).
    roInfo.discounts = {
      ...roInfo.discounts,
      discountInAmountOnPriceWithVat: roundMoney(
        (originalPriceWithVat - netPriceWithVat) + netPriceWithVat * (1 - globalFactor),
      ),
    };
  }
}

function applyDataFromDml(jobCardDetail, dmlResponse) {
  const jobs = jobCardDetail?.jobs;
  if (!Array.isArray(jobs)) return jobCardDetail;

  // Indicizzo per PartNumber/LaborOperationID tutti i PartsItem/LaborItems di
  // tutte le WorkLines della risposta (nel nostro caso e una sola WorkLine,
  // ma il match resta valido anche con piu righe).
  const partsItemsByPartNumber = new Map();
  const laborItemsByOperationId = new Map();
  for (const workLine of dmlResponse?.WorkLines ?? []) {
    for (const partsItem of workLine?.PartsItem ?? []) {
      if (partsItem?.PartNumber) partsItemsByPartNumber.set(partsItem.PartNumber, partsItem);
    }
    for (const laborItem of workLine?.LaborItems ?? []) {
      if (laborItem?.LaborOperationID) laborItemsByOperationId.set(laborItem.LaborOperationID, laborItem);
    }
  }

  // true se almeno un job ha dmsOverride===true (v. sotto): guida
  // recalculateRoInfoTotals a fine funzione.
  let anyJobOverride = false;

  for (const job of jobs) {
    // Sconto a livello di workline: guida reconcileDiscountPercentages per
    // ciascun part/labor di questo job (v. hasWorkLineDiscount).
    const wlDiscount = hasWorkLineDiscount(job);
    // true se almeno un part/labor del job ha subito un vero override (prezzo
    // effettivamente diverso da quello precedente, v. isPriceChanged, oppure
    // sconto DMS applicato, dmsDiscountPercentage!=0), guida job.dmsOverride
    // assegnato a fine ciclo del job. Un semplice match PartNumber/
    // LaborOperationID senza dati di prezzo/sconto (es. solo disponibilita/
    // BinLocation) NON basta a far scattare l'override.
    let jobHasDmsOverride = false;

    for (const part of job?.partInfo ?? []) {
      const partsItem = partsItemsByPartNumber.get(part?.partNumber);
      if (!partsItem) {
        part.dmsunknown = 1;
        continue;
      }
      part.dmsunknown = 0;

      const { source } = resolveDmlPartSource(partsItem);
      part.QuantityAvailable = source.QuantityAvailable ?? source.BinLocation?.[0]?.QuantityAvailable;
      part.availability = computeAvailability(part.itemQuantity, part.QuantityAvailable);

      const previousOriginalPriceExclVat = part.originalPriceExclVat;
      const previousDmsDiscount = part.dmsDiscountPercentage ?? 0;
      const dmsDiscountChanged = !samePercentage(previousDmsDiscount, source.DiscountPercentage);
      if (source.OriginalPriceExclVAT !== undefined && source.OriginalPriceExclVAT !== null) {
        part.unitaryPriceExclVat = roundMoney(source.OriginalPriceExclVAT);
      }

      if (dmsDiscountChanged) {
        reconcileDiscountPercentages(part, wlDiscount, source.DiscountPercentage);
      } else if (part.dmsDiscountPercentage === undefined || part.dmsDiscountPercentage === null) {
        part.dmsDiscountPercentage = Number(source.DiscountPercentage ?? 0);
      }

      let priceChanged = false;
      if (part.itemQuantity && part.unitaryPriceExclVat) {
        const computedFields = computePartPriceFields(
          part.itemQuantity,
          part.unitaryPriceExclVat,
          part.appDiscountPercentage,
          part.dmsDiscountPercentage,
          part.vatPercentage,
        );
        priceChanged = isPriceChanged(computedFields.originalPriceExclVat, previousOriginalPriceExclVat);
        if (dmsDiscountChanged || priceChanged) {
          Object.assign(part, computedFields);
        }
      }
      roundItemPriceFields(part);

      if (priceChanged || dmsDiscountChanged) jobHasDmsOverride = true;
    }

    for (const labor of job?.laborInfo ?? []) {
      const laborItem = laborItemsByOperationId.get(labor?.laborOperationCode);
      if (!laborItem) continue;

      const previousOriginalPriceExclVat = labor.originalPriceExclVat;
      const previousDmsDiscount = labor.dmsDiscountPercentage ?? 0;
      const dmsDiscountChanged = !samePercentage(previousDmsDiscount, laborItem.DiscountPercentage);
      const previousLaborDuration = labor.laborDuration;
      labor.laborDuration = laborItem.TimeUnit ?? previousLaborDuration;

      if (dmsDiscountChanged) {
        reconcileDiscountPercentages(labor, wlDiscount, laborItem.DiscountPercentage);
      } else if (labor.dmsDiscountPercentage === undefined || labor.dmsDiscountPercentage === null) {
        labor.dmsDiscountPercentage = Number(laborItem.DiscountPercentage ?? 0);
      }

      let priceChanged = false;
      if (labor.laborDuration && laborItem.UnitaryTimeAmount) {
        const computedFields = computeLaborPriceFields(
          labor.laborDuration,
          laborItem.UnitaryTimeAmount,
          labor.appDiscountPercentage,
          labor.dmsDiscountPercentage,
          labor.vatPercentage,
        );
        priceChanged = isPriceChanged(computedFields.originalPriceExclVat, previousOriginalPriceExclVat);
        if (dmsDiscountChanged || priceChanged) {
          Object.assign(labor, computedFields);
        }
      }
      roundItemPriceFields(labor);

      if (priceChanged || dmsDiscountChanged) jobHasDmsOverride = true;
    }

    job.dmsOverride = jobHasDmsOverride;
    // FP/LFP (prezzo fisso a livello di workline): i figli vengono comunque
    // aggiornati con i dati DML, ma il prezzo del job NON va ricalcolato dai figli.
    if (jobHasDmsOverride && !isFixedPriceJob(job)) {
      recalculateJobTotals(job);
    }
    if (jobHasDmsOverride) {
      anyJobOverride = true;
    }
  }

  if (anyJobOverride) {
    recalculateRoInfoTotals(jobCardDetail);
  }

  return jobCardDetail;
}

/**
 * Interroga il gateway DML (getCartPriceAndAvailability) per prezzo/
 * disponibilita di ricambi e manodopera e applica il risultato (in place)
 * al jobCardDetail tramite applyDataFromDml.
 *
 * Se il gateway DML risponde con un errore applicativo (es. HTTP 400
 * DML_AFTERSALES_ERR_002_400 "No data found in dispatching table", quando il
 * DMS non ha ancora dati di dispatching per questo RO) l'errore viene
 * loggato ma NON propagato: jobCardDetails/dml devono comunque restituire i
 * dati della Job Card, semplicemente senza l'arricchimento prezzo/
 * disponibilita DML, invece di bloccare l'intera risposta con un HTTP 502
 * che espone il messaggio grezzo del DMS al chiamante. L'esito (successo o
 * fallimento) viene riportato al chiamante tramite `dmsAvailable`, cosi' da poter
 * essere esposto in cima al messaggio restituito da getJobCardDetails/
 * getDataFromDMLFromTmp senza dover fare parsing di un eventuale errore.
 * @param {object} jobCardDetail - jobCardDetail (stesso formato di
 *                                 sanitized.jobCardDetail in getJobCardDetails)
 * @param {object} [sessionContext] - dati di sessione gia' disponibili al
 *                                 chiamante, propagati a getCartPriceAndAvailability
 *                                 per il Sender dinamico — v. buildDmsSender()
 * @returns {Promise<{jobCardDetail: object, dmsAvailable: boolean}>} il jobCardDetail
 *          (arricchito con i dati DML se `dmsAvailable` e' true, invariato altrimenti)
 *          e l'esito della sincronizzazione con il gateway DML
 */
async function getDataFromDML(jobCardDetail, sessionContext) {
  try {
    const dataFromDml = await getCartPriceAndAvailability(jobCardDetail, sessionContext);
    return { jobCardDetail: applyDataFromDml(jobCardDetail, dataFromDml), dmsAvailable: true };
  } catch (err) {
    console.warn(`[jobCard] getDataFromDML (gateway DML) fallita, restituisco jobCardDetail senza arricchimento prezzo/disponibilita: ${err.message}`);
    return { jobCardDetail, dmsAvailable: false };
  }
}

/**
 * Legge la cache DynamoDB (chiave jobcard:jobcarddetails:<jobCardId>,
 * scritta da getJobCardDetails tramite saveJobCardDetailsToTmp durante una
 * precedente GET /jobCardDetails, con TTL — v. dynamoCache.js) e applica
 * getDataFromDML al relativo jobCardDetail, così da poter richiamare
 * l'arricchimento DML senza rifare la chiamata a DGT. L'item può contenere
 * sia la risposta completa ({ jobCardDetail: {...} }) sia già il jobCardDetail.
 *
 * L'item può mancare o essere scaduto (TTL, scrittura fallita, o mai
 * scritto — v. saveJobCardDetailsToTmp): in quel caso, invece di fallire,
 * viene richiamato getJobCardDetails (che rigenera l'item tramite
 * saveJobCardDetailsToTmp, arricchendolo già con getDataFromDML) e si
 * ritenta la lettura appena dopo; in tal caso getDataFromDML NON viene
 * richiamato una seconda volta qui sotto (evita una doppia chiamata al
 * gateway DML). Se anche la rilettura fallisce (es. DYNAMO_CACHE_TABLE_NAME
 * non configurato, come in locale/CLI, o scrittura DynamoDB fallita/in
 * ritardo), si usa direttamente il risultato appena calcolato da
 * getJobCardDetails invece di sollevare un'eccezione.
 * @param {string|number} jobCardId  - usato per risolvere la cache key
 * @param {string} [bearerToken]     - ****** da PingFederate, usato solo per
 *                                     rigenerare l'item via getJobCardDetails
 *                                     quando mancante. Se omesso e serve
 *                                     rigenerare, ne viene richiesto uno nuovo
 *                                     ad authService.getBearerToken().
 * @param {object} [sessionContext] - dati di sessione gia' disponibili al
 *                                 chiamante (username/mainSincom/market/
 *                                 language/dealerCountryCode), propagati fino a
 *                                 getCartPriceAndAvailability per il Sender
 *                                 dinamico — v. buildDmsSender()
 * @returns {Promise<object>} il body letto dalla cache con jobCardDetail
 *          arricchito e `dmsAvailable` in cima, che riporta l'esito dell'ultima
 *          sincronizzazione con il gateway DML (v. getDataFromDML)
 */
async function getDataFromDMLFromTmp(jobCardId, bearerToken, sessionContext) {
  if (jobCardId === undefined || jobCardId === null || jobCardId === '') {
    throw new Error('[jobCard] jobCardId is required');
  }

  const cacheKey = cacheKeyForJobCard(jobCardId);

  let body = await getCacheItem(cacheKey);
  let alreadyEnriched = false;
  if (!body) {
    console.warn(`[jobCard] ${cacheKey} non trovato in cache: rigenero tramite getJobCardDetails`);

    // getJobCardDetails arricchisce già con getDataFromDML (v. sopra), scrive
    // il risultato (già comprensivo di `dmsAvailable`) in cache e lo restituisce:
    // evitiamo quindi di richiamare getDataFromDML una seconda volta qui sotto.
    const token = bearerToken ?? await getBearerToken();
    const regenerated = await getJobCardDetails(token, jobCardId, sessionContext);
    alreadyEnriched = true;

    body = await getCacheItem(cacheKey);
    if (!body) {
      console.warn(`[jobCard] ${cacheKey} non rileggibile dalla cache dopo rigenerazione: uso il risultato appena calcolato`);
      body = regenerated;
    }
  }

  const jobCardDetail = body?.jobCardDetail ?? body;

  if (!alreadyEnriched) {
    // Item già presente in cache: viene comunque richiamato il gateway DML
    // per un dato aggiornato (prezzo/disponibilita possono cambiare), quindi
    // `dmsAvailable` va ricalcolato qui e riportato in cima al body restituito
    // (v. getDataFromDML — non blocca la risposta in caso di errore DML).
    const { dmsAvailable } = await getDataFromDML(jobCardDetail, sessionContext);
    body = { dmsAvailable, ...body };
  }

  return body;
}

/**
 * Calls jobCardDetails endpoint.
 * @param {string} bearerToken      - ****** from PingFederate
 * @param {string|number} jobCardId - JobCard identifier (input parameter)
 * @param {object} [sessionContext] - dati di sessione gia' disponibili al
 *                                 chiamante (username/mainSincom/market/
 *                                 language/dealerCountryCode), propagati a
 *                                 getDataFromDML/getCartPriceAndAvailability
 *                                 per il Sender dinamico — v. buildDmsSender()
 * @returns {Promise<object>} parsed response body, con `dmsAvailable` (esito della
 *          sincronizzazione con il gateway DML) in cima, seguito dal resto
 *          della risposta arricchita con i dati DML quando `dmsAvailable` e' true
 */
async function getJobCardDetails(bearerToken, jobCardId, sessionContext) {
  if (jobCardId === undefined || jobCardId === null || jobCardId === '') {
    throw new Error('[jobCard] jobCardId is required');
  }


  const options = await buildDgtOptions('/jobCardDetails', 'GET', { jobCardId: String(jobCardId) }, bearerToken);

  console.log(`[jobCard] GET jobCardDetails - jobCardId: ${jobCardId}`);
  const response = await httpsRequest(options);

  if (response.statusCode !== 200) {
    throw new Error(
      `[jobCard] jobCardDetails failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  const sanitized = sanitizeJobCardDetails(response.body);

  const jobCardDetail = sanitized?.jobCardDetail ?? sanitized;
  const { dmsAvailable } = await getDataFromDML(jobCardDetail, sessionContext);

  // `dmsAvailable` in cima al messaggio: indica se l'arricchimento con i dati del
  // gateway DML (prezzo/disponibilita) e' andato a buon fine, cosi' il
  // chiamante puo' distinguerlo senza fare parsing di un eventuale errore.
  const bodyWithSyncStatus = { dmsAvailable, ...sanitized };

  return await saveJobCardDetailsToTmp(jobCardId, bodyWithSyncStatus);
}

/**
 * Returns a copy of a partInfo entry without the dmsunknown/QuantityAvailable/
 * availability fields added by applyDataFromDml (arricchimento DML) alle
 * risposte GET di jobCardDetails. Sono derivati solo per la UI: se il FE
 * ri-sottomette a saveJobCard un partInfo proveniente da una precedente GET
 * arricchita, DGT li rifiuta in POST /jobCard con "is not allowed".
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
 * added by enrichJobsWithPackageInfo and the dmsOverride field added by
 * applyDataFromDml to jobCardDetails GET responses. Those are derived only
 * for UI display: if a caller round-trips a previously fetched
 * jobCardDetail.jobs entry back into saveJobCard, the DGT API rejects them
 * with "is not allowed" validation errors. partInfo entries are also
 * sanitized (v. stripDmlPartEnrichment).
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
    throw new Error('[jobCard] payload is required');
  }

  return Array.isArray(payload.jobs)
    ? { ...payload, jobs: payload.jobs.map(stripPackageEnrichment) }
    : payload;
}

/**
 * Calls the jobCard (POST) endpoint to persist a Digital Job Card payload —
 * i.e. the same "declination" (djc) payload built by djc/DjcManager.js
 * Save* methods (json_mod). Uses the same PingFederate/DGT client
 * (config.js/authService.js/httpClient.js) as getJobCardList/getJobCardDetails,
 * only the HTTP method and path differ (POST /jobCard vs GET /jobCardList|
 * /jobCardDetails).
 *
 * Difensivo: se payload.jobs porta ancora packageType/packageCharge/dmsOverride
 * o partInfo[].dmsunknown/QuantityAvailable/availability (es. round-trip di
 * una jobCardDetails GET arricchita — v. enrichJobsWithPackageInfo/
 * applyDataFromDml sopra), vengono rimossi prima di inoltrare a DGT, che li
 * rifiuta in POST /jobCard con "is not allowed".
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

  console.log('[jobCard] POST jobCard');
  const response = await httpsRequest(options, body);

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    throw new Error(
      `[jobCard] jobCard failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * Raggruppa un array di righe per il valore della chiave indicata.
 * @param {Array<object>} rows
 * @param {string} key
 * @returns {object} mappa { [valore chiave]: [righe corrispondenti] }
 */
function groupByKey(rows, key) {
  return (rows ?? []).reduce((acc, row) => {
    const groupKey = row?.[key];
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(row);
    return acc;
  }, {});
}

/**
 * Configurazione dealer (controlli veicolo + pacchetti) per un mercato/oic,
 * usata lato front-end per popolare la Vehicle Inspection e i pacchetti
 * disponibili in fase di jobcard.
 *
 * Chiama in dbManager (via serviceClient, v. istruzioni di repo):
 * - getVehicleInspection(market) (solo mercato, nessun filtro su "type", v.
 *   dbManager/HqRepository.js::getVehicleInspection con "type" opzionale):
 *   il risultato viene raggruppato per "type".
 * - checkIsPkMarketEnabled(market): se ritorna 0 i pacchetti vengono letti
 *   con getPackageListHQ(market) (pacchetti a livello mercato), se ritorna 1
 *   con getPackageListSM(market, oic) (pacchetti del singolo oic). Il
 *   risultato viene esposto sotto la chiave "package", a sua volta
 *   raggruppato per "domainDescr".
 *
 * market mancante -> Error "[jobCard] market is required" (mappato a 400 dal
 * chiamante, v. index.js).
 *
 * @param {string} market
 * @param {string} oic
 * @returns {Promise<object>} { [type]: [...righe vehicle inspection], package: { [domainDescr]: [...righe pacchetto] } }
 */
async function getDealerConfiguration(market, oic) {
  if (!market) {
    throw new Error('[jobCard] market is required');
  }
  const vehicleInspection = await callService('dbmanager', 'getVehicleInspection', { args: [market] });
  const isPkMarketEnabled = await callService('dbmanager', 'checkIsPkMarketEnabled', { args: [market] });

  const packages = isPkMarketEnabled === 1
    ? await callService('dbmanager', 'getPackageListSM', { args: [market, oic] })
    : await callService('dbmanager', 'getPackageListHQ', { args: [market] });

  return {
    ...groupByKey(vehicleInspection, 'type'),
    package: groupByKey(packages, 'domainDescr'),
  };
}

module.exports = { getJobCardList, getJobCardListCurrent, getJobCardDetails, saveJobCard, sanitizeJobCardPayload, getCartPriceAndAvailability, applyDataFromDml, getDataFromDML, getDataFromDMLFromTmp, buildDmsSender, getDealerConfiguration };
