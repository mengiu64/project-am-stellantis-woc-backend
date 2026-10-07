'use strict';

const { URL, URLSearchParams } = require('url');
const { httpsRequest } = require('./httpClient');
const { getHttpsAgent } = require('./certService');
const config = require('./config');

/** Costruisce l'header Authorization Basic da MYPEOPLE_USERNAME/MYPEOPLE_PASSWORD. */
function basicAuth(settings) {
  return 'Basic ' + Buffer.from(`${settings.username}:${settings.password}`).toString('base64');
}

/**
 * Builds HTTPS request options for the myPeople readUserProfiles endpoint.
 * @param {object} queryParams - query string parameters (username, identifier)
 * @param {import('https').Agent} agent - mTLS agent (cert/key from Secrets Manager)
 */
function buildOptions(queryParams, agent, settings) {
  const base = new URL(settings.host);
  const search = new URLSearchParams(queryParams).toString();

  return {
    hostname: base.hostname,
    port: base.port || 443,
    path: `${settings.basePath}/readUserProfiles?${search}`,
    method: 'GET',
    agent,
    headers: {
      'X-IBM-Client-Id': settings.ibmClientId,
      Authorization: basicAuth(settings),
    },
  };
}

/**
 * Calls the myPeople readUserProfiles endpoint (mTLS + Basic Auth + IBM API Connect).
 *
 * @param {object} params
 * @param {string} params.username   - (Mandatory) IURSMA username (es. "0073741.d235")
 * @returns {Promise<object>} parsed response body
 */
async function readUserProfiles(params = {}) {
  const { username } = params;
  if (!username) {
    throw new Error('[myPeople] username is required');
  }

  const settings = await config.getMyPeopleConfig();
  const identifier = settings.identifier;
  const agent = await getHttpsAgent();
  const options = buildOptions({ username, identifier }, agent, settings);

  console.log(`[myPeople] GET readUserProfiles - username: ${username}`);
  const response = await httpsRequest(options);

  if (response.statusCode !== 200) {
    throw new Error(
      `[myPeople] readUserProfiles failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

module.exports = { readUserProfiles };
