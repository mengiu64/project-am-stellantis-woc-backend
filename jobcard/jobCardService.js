'use strict';

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
  return body;
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

  return sanitizeJobCardDetails(response.body);
}

module.exports = { getJobCardList, getJobCardDetails };
