'use strict';

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');
const { getCacheItem, setCacheItem } = require('./dynamoCache');

// Cache del Bearer token OAuth2 su DynamoDB (TmpCacheTable, v. dynamoCache.js): sostituisce
// la precedente cache su file /tmp (".dms.token.cache.json"), non condivisa tra le
// istanze/funzioni Lambda e potenzialmente sopravvissuta troppo a lungo in un container
// "warm", servendo token con scope/client_id ormai obsoleti. La chiave è namespaced per
// modulo per evitare collisioni nella tabella condivisa (dms/ viene anche imbarcata
// in-process in JobCardFunction/DjcFunction/PkFavoriteFunction, v. Makefile).
const TOKEN_CACHE_KEY = 'dms:authtoken';
// Rigenera il token 30 secondi prima della scadenza effettiva
const EXPIRY_BUFFER_SECONDS = 30;

async function readCachedToken(expectedScope, expectedClientId) {
  const cached = await getCacheItem(TOKEN_CACHE_KEY);
  if (!cached || !cached.access_token) return null;

  // Un token in cache è valido solo se scope e client_id corrispondono a
  // quelli attualmente configurati: evita di riutilizzare un token con
  // scope errato/obsoleto rimasto in cache da una configurazione precedente.
  if (cached.scope !== expectedScope || cached.client_id !== expectedClientId) {
    console.log('[auth] Token in cache non corrisponde a scope/client_id correnti — richiedo un nuovo token');
    return null;
  }

  console.log('[auth] Token in cache valido');
  return cached.access_token;
}

async function writeCachedToken(access_token, expires_in, scope, clientId) {
  const ttlSeconds = Math.max(expires_in - EXPIRY_BUFFER_SECONDS, 0);
  await setCacheItem(TOKEN_CACHE_KEY, { access_token, scope, client_id: clientId }, ttlSeconds);
}

/**
 * Restituisce un Bearer token PingFederate valido.
 * Controlla prima la cache su DynamoDB; chiama PingFederate solo se il token
 * è assente, scaduto o con scope/client_id non più validi.
 * @returns {Promise<string>} the access_token string
 */
async function getBearerToken() {
  const config = await getConfig();

  const cached = await readCachedToken(config.auth.scope, config.auth.clientId);
  if (cached) return cached;

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

  const expiresIn = response.body.expires_in ?? 3600;
  console.log(`[auth] Nuovo token ottenuto (expires_in: ${expiresIn}s) — salvato in cache`);

  await writeCachedToken(token, expiresIn, config.auth.scope, config.auth.clientId);

  return token;
}

module.exports = { getBearerToken };
