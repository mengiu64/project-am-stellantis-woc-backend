'use strict';

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

/**
 * Builds common HTTPS request options for DGT API calls.
 * @param {string} path - API path (e.g. '/jobCardList')
 * @param {object} extraHeaders - additional headers
 * @param {string} bearerToken - Bearer token
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
      ...extraHeaders,
    },
  };
}

/**
 * Calls jobCardList endpoint.
 * @param {string} bearerToken - Bearer token from PingFederate
 * @param {string} dealerId - Dealer identifier (input parameter)
 * @returns {Promise<object>} parsed response body
 */
async function getJobCardList(bearerToken, dealerId) {
  if (!dealerId) {
    throw new Error('[jobCard] dealerId is required');
  }

  const options = buildDgtOptions('/jobCardList', { dealerId }, bearerToken);

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
 * Calls jobCardDetails endpoint.
 * @param {string} bearerToken - Bearer token from PingFederate
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

  return response.body;
}

module.exports = { getJobCardList, getJobCardDetails };
