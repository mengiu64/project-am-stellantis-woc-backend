'use strict';

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

/**
 * Fetches a Bearer token from PingFederate using client_credentials flow.
 * @returns {Promise<string>} the access_token string
 */
async function getBearerToken() {
  const endpoint = new URL(config.auth.url);

  const params = new URLSearchParams({
    grant_type: config.auth.grantType,
    scope: config.auth.scope,
    client_id: config.auth.clientId,
    client_secret: config.auth.clientSecret,
  });

  const body = params.toString();

  const options = {
    hostname: endpoint.hostname,
    port: endpoint.port || 443,
    path: endpoint.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  console.log(`[auth] POST ${config.auth.url}`);
  const response = await httpsRequest(options, body);

  if (response.statusCode !== 200) {
    throw new Error(
      `[auth] Token request failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  const token = response.body.access_token;
  if (!token) {
    throw new Error('[auth] No access_token in response');
  }

  const expiresIn = response.body.expires_in;
  console.log(`[auth] Token obtained (expires_in: ${expiresIn}s)`);

  return token;
}

module.exports = { getBearerToken };
