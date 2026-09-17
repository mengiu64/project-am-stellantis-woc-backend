'use strict';

// Servizio di autenticazione PingFederate per la Lambda srpV360Ota.
// Gestisce l'ottenimento e la cache su file del token OAuth2 (client_credentials).
// Segue lo stesso pattern di djc/authService.js con messaggi e commenti in italiano.

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');

// In AWS Lambda il filesystem del pacchetto (__dirname, /var/task) è read-only:
// solo /tmp è scrivibile. In locale (CLI) continuiamo a usare __dirname.
const CACHE_DIR = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/tmp' : __dirname;
// Percorso del file di cache del token
const TOKEN_CACHE_FILE = path.join(CACHE_DIR, '.token.cache.json');
// Rigenera il token 30 secondi prima della scadenza effettiva
const EXPIRY_BUFFER_SECONDS = 30;

/**
 * Legge il token dalla cache su file.
 * Se il token è presente e ancora valido (con margine di 30s), lo restituisce.
 * Altrimenti restituisce null per forzare una nuova richiesta a PingFederate.
 * @returns {string|null} Token dalla cache, oppure null se assente/scaduto
 */
function readCachedToken(expectedScope, expectedClientId) {
  try {
    // Legge il file di cache dal filesystem
    const raw = fs.readFileSync(TOKEN_CACHE_FILE, 'utf8');
    // Estrae access_token, expires_at, scope e client_id dal JSON salvato
    const { access_token, expires_at, scope, client_id } = JSON.parse(raw);
    // Ottiene il timestamp corrente in millisecondi
    const nowMs = Date.now();
    // Verifica che il token sia presente e non scaduto (con buffer di 30s)
    if (access_token && expires_at && nowMs < expires_at - EXPIRY_BUFFER_SECONDS * 1000) {
      // Un token in cache è valido solo se scope e client_id corrispondono a
      // quelli attualmente configurati: evita di riutilizzare un token con
      // scope errato/obsoleto rimasto in cache da una configurazione precedente.
      if (scope !== expectedScope || client_id !== expectedClientId) {
        console.log('[auth] Token in cache non corrisponde a scope/client_id correnti — richiedo un nuovo token');
        return null;
      }
      // Calcola i secondi rimanenti alla scadenza per il log
      const remainingSec = Math.round((expires_at - nowMs) / 1000);
      // Log in italiano: token in cache ancora valido
      console.log(`[auth] Token in cache valido (scade tra ${remainingSec}s)`);
      return access_token;
    }
  } catch {
    // File non presente o corrotto — verrà rigenerato con una nuova richiesta
  }
  // Nessun token valido in cache
  return null;
}

/**
 * Scrive il token ottenuto nel file di cache con la scadenza calcolata.
 * @param {string} access_token - Token Bearer ottenuto da PingFederate
 * @param {number} expires_in - Durata di validità in secondi
 * @param {string} scope - Scope con cui il token è stato ottenuto
 * @param {string} clientId - client_id con cui il token è stato ottenuto
 */
function writeCachedToken(access_token, expires_in, scope, clientId) {
  // Calcola il timestamp di scadenza assoluto (millisecondi)
  const expires_at = Date.now() + expires_in * 1000;
  // Salva il token, la scadenza, lo scope e il client_id nel file di cache in formato JSON
  fs.writeFileSync(
    TOKEN_CACHE_FILE,
    JSON.stringify({ access_token, expires_at, scope, client_id: clientId }),
    'utf8'
  );
}

/**
 * Restituisce un Bearer token PingFederate valido.
 * Controlla prima la cache su file; chiama PingFederate solo se il token
 * è assente o scaduto (con margine di 30 secondi).
 * @returns {Promise<string>} Token di accesso Bearer valido
 * @throws {Error} Se PingFederate risponde con status diverso da 200
 * @throws {Error} Se la risposta non contiene il campo access_token
 */
async function getBearerToken() {
  // Carica la configurazione (asincrona — credenziali da SSM/Secrets Manager)
  const config = await getConfig();

  // Tenta di leggere il token dalla cache locale
  const cached = readCachedToken(config.auth.scope, config.auth.clientId);
  // Se il token in cache è ancora valido, lo restituisce direttamente
  if (cached) return cached;

  // Costruisce l'URL dell'endpoint PingFederate dalla configurazione
  const endpoint = new URL(config.auth.url);

  // Prepara i parametri del body per il flusso client_credentials
  const params = new URLSearchParams({
    grant_type: config.auth.grantType,
    scope: config.auth.scope,
    client_id: config.auth.clientId,
    client_secret: config.auth.clientSecret,
  });

  // Serializza i parametri in formato application/x-www-form-urlencoded
  const body = params.toString();

  // Configura le opzioni per la richiesta HTTPS verso PingFederate
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

  // Log in italiano: richiesta in corso verso PingFederate
  console.log(`[auth] POST ${config.auth.url}`);
  // Esegue la richiesta HTTPS verso PingFederate
  const response = await httpsRequest(options, body);

  // Se PingFederate risponde con status diverso da 200, lancia errore formattato
  if (response.statusCode !== 200) {
    throw new Error(
      `[auth] Richiesta token fallita: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  // Estrae l'access_token dalla risposta
  const token = response.body.access_token;
  // Se il campo access_token non è presente nella risposta, lancia errore
  if (!token) {
    throw new Error('[auth] Nessun access_token nella risposta');
  }

  // Ottiene la durata di validità del token (default 3600s se non specificato)
  const expiresIn = response.body.expires_in ?? 3600;
  // Log in italiano: nuovo token ottenuto e salvato in cache
  console.log(`[auth] Nuovo token ottenuto (expires_in: ${expiresIn}s) — salvato in cache`);

  // Scrive il nuovo token nel file di cache
  writeCachedToken(token, expiresIn, config.auth.scope, config.auth.clientId);

  // Restituisce il token appena ottenuto
  return token;
}

// Esporta la funzione per l'utilizzo negli altri moduli della Lambda
module.exports = { getBearerToken };
