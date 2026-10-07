'use strict';

/**
 * authService.js — Client OAuth2 (client_credentials) verso l'IAM Keycloak di Wyz.
 * Il token è cachato su DynamoDB (TmpCacheTable, chiave dedicata "wyz:authtoken")
 * e rigenerato solo se assente, scaduto o emesso per un client_id diverso.
 */

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');
const { getCacheItem, setCacheItem } = require('./dynamoCache');

// Chiave namespaced per modulo (tabella di cache condivisa tra le lambda)
const TOKEN_CACHE_KEY = 'wyz:authtoken';
// Rigenera il token 30 secondi prima della scadenza effettiva
const EXPIRY_BUFFER_SECONDS = 30;

/**
 * Legge il token dalla cache; valido solo se il client_id coincide con quello configurato.
 * @param {string} expectedClientId
 * @returns {Promise<string|null>}
 */
async function readCachedToken(expectedClientId) {
  const cached = await getCacheItem(TOKEN_CACHE_KEY);
  if (!cached || !cached.access_token) return null;

  if (cached.client_id !== expectedClientId) {
    console.log('[auth] Token in cache emesso per un altro client_id — richiedo un nuovo token');
    return null;
  }

  console.log('[auth] Token in cache valido');
  return cached.access_token;
}

/**
 * Restituisce un access token Wyz valido.
 * @returns {Promise<string>}
 * @throws {Error} se l'IAM risponde con errore o senza access_token
 */
async function getBearerToken() {
  const config = await getConfig();

  const cached = await readCachedToken(config.auth.clientId);
  if (cached) return cached;

  const endpoint = new URL(config.auth.url);
  const body = new URLSearchParams({
    grant_type: config.auth.grantType,
    client_id: config.auth.clientId,
    client_secret: config.auth.clientSecret,
  }).toString();

  const options = {
    hostname: endpoint.hostname,
    port: endpoint.port || 443,
    path: endpoint.pathname,
    method: 'POST',
    timeout: config.timeoutMs,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  console.log(`[auth] POST ${config.auth.url}`);
  const response = await httpsRequest(options, body);

  if (response.statusCode !== 200) {
    throw new Error(`[auth] Richiesta token fallita: HTTP ${response.statusCode}`);
  }

  const token = response.body && response.body.access_token;
  if (!token) {
    throw new Error('[auth] Nessun access_token nella risposta');
  }

  const expiresIn = response.body.expires_in ?? 300;
  console.log(`[auth] Nuovo token ottenuto (expires_in: ${expiresIn}s) — salvato in cache`);

  const ttlSeconds = Math.max(expiresIn - EXPIRY_BUFFER_SECONDS, 0);
  await setCacheItem(TOKEN_CACHE_KEY, { access_token: token, client_id: config.auth.clientId }, ttlSeconds);

  return token;
}

/**
 * Elimina il token dalla cache (es. dopo un 401 dal servizio Wyz).
 * Scrive un item già scaduto: getCacheItem lo ignora.
 * @returns {Promise<void>}
 */
async function invalidateToken() {
  console.log('[auth] Invalidazione token in cache');
  await setCacheItem(TOKEN_CACHE_KEY, null, 0);
}

module.exports = { getBearerToken, invalidateToken };
