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

module.exports = { getDmsSettings };
