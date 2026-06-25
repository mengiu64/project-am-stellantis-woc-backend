'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

const TOKEN_CACHE_FILE = path.join(__dirname, '.token.cache.json');
// Rigenera il token 30 secondi prima della scadenza effettiva
const EXPIRY_BUFFER_SECONDS = 30;

function readCachedToken() {
  try {
    const raw = fs.readFileSync(TOKEN_CACHE_FILE, 'utf8');
    const { access_token, expires_at } = JSON.parse(raw);
    const nowMs = Date.now();
    if (access_token && expires_at && nowMs < expires_at - EXPIRY_BUFFER_SECONDS * 1000) {
      const remainingSec = Math.round((expires_at - nowMs) / 1000);
      console.log(`[auth] Token in cache valido (scade tra ${remainingSec}s)`);
      return access_token;
    }
  } catch {
    // File non presente o corrotto — verrà rigenerato
  }
  return null;
}

function writeCachedToken(access_token, expires_in) {
  const expires_at = Date.now() + expires_in * 1000;
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify({ access_token, expires_at }), 'utf8');
}

/**
 * Restituisce un Bearer token PingFederate valido.
 * Controlla prima la cache su file; chiama PingFederate solo se il token
 * è assente o scaduto.
 * @returns {Promise<string>} the access_token string
 */
async function getBearerToken() {
  const cached = readCachedToken();
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

  writeCachedToken(token, expiresIn);

  return token;
}

module.exports = { getBearerToken };
