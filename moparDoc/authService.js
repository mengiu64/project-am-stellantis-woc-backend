'use strict';

/**
 * authService.js — Client PingFederate dedicato a MoparDoc.
 *
 * Stesso host di jobcard/djc, ma con scope (prd:mdo) e client_id/secret
 * dedicati (config.auth.clientId/clientSecret, env MOPARDOC_PING_CLIENT_ID/
 * MOPARDOC_PING_CLIENT_SECRET): un client PingFederate diverso produce un
 * token diverso, quindi la cache è tenuta separata (.token.cache.json in
 * questa stessa cartella, non condivisa con jobcard/djc).
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');

// In AWS Lambda il filesystem del pacchetto (__dirname, /var/task) è read-only:
// solo /tmp è scrivibile. In locale (CLI) continuiamo a usare __dirname.
const CACHE_DIR = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/tmp' : __dirname;
const TOKEN_CACHE_FILE = path.join(CACHE_DIR, '.token.cache.json');
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
 * Restituisce un token PingFederate valido.
 * Controlla prima la cache su file; chiama PingFederate solo se il token
 * è assente o scaduto.
 * @returns {Promise<string>} the access_token string
 */
async function getBearerToken() {
  const cached = readCachedToken();
  if (cached) return cached;

  // Risolve la configurazione (credenziali da SSM/Secrets Manager o .env)
  const config = await getConfig();

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
