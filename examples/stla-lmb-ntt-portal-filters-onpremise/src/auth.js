const { httpsPost } = require('./http.js');
const { URLSearchParams } = require('url');
const { logger } = require('./logger');
const {
  NTTInternalServerError,
  NTTError,
  ERROR_CODE
} = require('./responseHelper');

const AUTH_TIMEOUT_MS = 3000;
const TOKEN_EXPIRY_BUFFER_MS = 120 * 1000; // refresh 2 min before expiry

let cachedToken = null; // { access_token, expiresAt }
let tokenPromise = null;

function isTokenExpired() {
  return !cachedToken || Date.now() >= cachedToken.expiresAt;
}

function invalidateToken() {
  cachedToken = null;
}

async function getAuthToken(authConfig) {
  const requiredKeys = ['url', 'client_id', 'client_secret', 'scope'];
  const missing = requiredKeys.filter((k) => !authConfig[k]);

  if (missing.length) {
    logger.error(`Missing required values in secret: ${missing.join(', ')}`);
    throw new NTTInternalServerError('Internal server error');
  }

  const { url, client_id, client_secret, scope } = authConfig;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope,
    client_id,
    client_secret
  }).toString();

  let result;
  try {
    logger.info('Requesting new OAuth token..');
    result = await httpsPost(
      url,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: AUTH_TIMEOUT_MS },
      body
    );
  } catch (e) {
    if (e.name === 'TimeoutError') {
      logger.error('OAuth request timed out');
      throw new NTTInternalServerError('OAuth request timed out');
    }
    logger.error('Unexpected error while calling OAuth service', e);
    throw new NTTInternalServerError('Internal server error');
  }

  const { status, data } = result;

  if (status < 200 || status >= 300) {
    logger.error('OAuth server error', { status, data });
    throw new NTTError(ERROR_CODE.CLIENT_ERROR, status, 'OAuth server error');
  }

  if (!data?.access_token) {
    logger.error('Invalid OAuth response: missing access_token');
    throw new NTTInternalServerError('Internal server error');
  }

  logger.info('OAuth token obtained successfully');
  return {
    access_token: data.access_token,
    expires_in: data.expires_in
  };
}

async function getValidToken(authConfig) {
  if (!isTokenExpired()) {
    logger.info('Reusing cached token');
    return cachedToken.access_token;
  }

  if (!tokenPromise) {
    tokenPromise = getAuthToken(authConfig)
      .then(({ access_token, expires_in }) => {
        cachedToken = {
          access_token,
          expiresAt: Date.now() + expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS
        };
        logger.info('OAuth token fetched and cached');
        return cachedToken.access_token;
      })
      .finally(() => {
        tokenPromise = null;
      });
  }

  return tokenPromise;
}

module.exports = { getValidToken, invalidateToken };