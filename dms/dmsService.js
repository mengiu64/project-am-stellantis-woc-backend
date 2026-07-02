'use strict';

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

/**
 * Calls GET /dms/settings endpoint.
 *
 * @param {string} bearerToken  - Bearer token from PingFederate
 * @param {object} params
 * @param {string}   params.country  - (Mandatory) Country code (e.g. "fr")
 * @param {string}   params.brand    - (Mandatory) Brand code (e.g. "FT")
 * @param {string}   params.dealer   - (Mandatory) Dealer identifier (e.g. "0062230")
 * @returns {Promise<object>} parsed response body
 */
async function getDmsSettings(bearerToken, params = {}) {
  const { country, brand, dealer } = params;

  if (!country) throw new Error('[dms] country is required');
  if (!brand)   throw new Error('[dms] brand is required');
  if (!dealer)  throw new Error('[dms] dealer is required');

  const base = new URL(config.dml.baseUrl);
  const qs = new URLSearchParams({ country, brand, dealer }).toString();
  const fullPath = `${config.dml.basePath}/settings?${qs}`;

  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: fullPath,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'X-IBM-Client-Id': config.dml.ibmClientId,
      'X-IBM-Client-Secret': config.dml.ibmClientSecret,
      'X-Target-Env': config.dml.xTargetEnv,
    },
  };

  console.log(`[dms] GET https://${base.hostname}${fullPath}`);
  const response = await httpsRequest(options);

  if (response.statusCode !== 200) {
    throw new Error(
      `[dms] settings failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

const VALID_INQUIRY_TYPES = ['LFP', 'WL', 'MP'];

/**
 * Calls POST /inquiry/DML/1.0/inquiry endpoint.
 *
 * @param {string} bearerToken - Bearer token from PingFederate
 * @param {object} body        - InquiryRequest payload (per DML_inquiry_V_4.2.yml)
 * @param {object}   body.ApplicationArea
 * @param {string}     body.ApplicationArea.CreationDateTime - ISO 8601 timestamp
 * @param {string}     body.ApplicationArea.BODID           - UUID
 * @param {object}   body.PartsInquiryHeader
 * @param {string}     body.PartsInquiryHeader.DocumentID
 * @param {string}     body.PartsInquiryHeader.CustomerIdDms
 * @param {'LFP'|'WL'|'MP'} body.PartsInquiryHeader.MessageType
 * @param {string}     body.PartsInquiryHeader.VehicleID
 * @param {object}   [body.UpSelling]   - Used for MessageType LFP
 * @param {object}   [body.SpareParts]  - Used for MessageType MP
 * @param {Array}    [body.WorkLines]   - Used for MessageType WL
 * @returns {Promise<object>} parsed response body
 */
async function postDmsInquiry(bearerToken, body = {}) {
  const header = body?.PartsInquiryHeader || {};

  if (!header.MessageType) throw new Error('[dms] PartsInquiryHeader.MessageType is required');
  if (!VALID_INQUIRY_TYPES.includes(header.MessageType)) {
    throw new Error(`[dms] MessageType must be one of: ${VALID_INQUIRY_TYPES.join(', ')}`);
  }
  if (!header.DocumentID)    throw new Error('[dms] PartsInquiryHeader.DocumentID is required');
  if (!header.CustomerIdDms) throw new Error('[dms] PartsInquiryHeader.CustomerIdDms is required');
  if (!header.VehicleID)     throw new Error('[dms] PartsInquiryHeader.VehicleID is required');

  const base = new URL(config.dml.baseUrl);
  const fullPath = `${config.dml.inquiryBasePath}/inquiry`;
  const payload = JSON.stringify(body);

  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: fullPath,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-IBM-Client-Id': config.dml.ibmClientId,
      'X-IBM-Client-Secret': config.dml.ibmClientSecret,
      'X-Target-Env': config.dml.xTargetEnv,
    },
  };

  console.log(`[dms] POST https://${base.hostname}${fullPath} (MessageType=${header.MessageType})`);
  const response = await httpsRequest(options, payload);

  if (response.statusCode !== 200) {
    throw new Error(
      `[dms] inquiry failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

module.exports = { getDmsSettings, postDmsInquiry, buildTypeSection };

/**
 * Returns the type-specific section of an InquiryRequest body based on MessageType.
 *   LFP → { UpSelling:  { Packages:  [] } }
 *   WL  → { WorkLines:  [] }
 *   MP  → { SpareParts: { PartsItem: [] } }
 *
 * @param {'LFP'|'WL'|'MP'} type
 * @returns {object}
 */
function buildTypeSection(type) {
  switch (type) {
    case 'LFP': return { UpSelling:  { Packages:  [] } };
    case 'WL':  return { WorkLines:  [] };
    case 'MP':  return { SpareParts: { PartsItem: [] } };
    default:    return {};
  }
}
