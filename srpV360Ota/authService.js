'use strict';

// Servizio di autenticazione PingFederate per la Lambda srpV360Ota.
// Gestisce l'ottenimento e la cache su DynamoDB del token OAuth2 (client_credentials).
// Segue lo stesso pattern di djc/authService.js con messaggi e commenti in italiano.

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');
const { getCacheItem, setCacheItem } = require('./dynamoCache');

// Cache del token OAuth2 su DynamoDB (TmpCacheTable, v. dynamoCache.js): sostituisce
// la precedente cache su file /tmp, non condivisa tra le istanze/funzioni Lambda e
// potenzialmente sopravvissuta troppo a lungo in un container "warm", servendo token
// con scope/client_id ormai obsoleti. La chiave è namespaced per modulo per evitare
// collisioni nella tabella condivisa.
const TOKEN_CACHE_KEY = 'srpv360ota:authtoken';
// Rigenera il token 30 secondi prima della scadenza effettiva
const EXPIRY_BUFFER_SECONDS = 30;

/**
 * Legge il token dalla cache su DynamoDB.
 * Se il token è presente e ancora valido (con margine di 30s) e con scope/client_id
 * corrispondenti a quelli attualmente configurati, lo restituisce.
 * Altrimenti restituisce null per forzare una nuova richiesta a PingFederate.
 * @returns {Promise<string|null>} Token dalla cache, oppure null se assente/scaduto/non valido
 */
async function readCachedToken(expectedScope, expectedClientId) {
  // Legge l'item di cache da DynamoDB (TmpCacheTable)
  const cached = await getCacheItem(TOKEN_CACHE_KEY);
  if (!cached || !cached.access_token) return null;

  // Un token in cache è valido solo se scope e client_id corrispondono a
  // quelli attualmente configurati: evita di riutilizzare un token con
  // scope errato/obsoleto rimasto in cache da una configurazione precedente.
  if (cached.scope !== expectedScope || cached.client_id !== expectedClientId) {
    console.log('[auth] Token in cache non corrisponde a scope/client_id correnti — richiedo un nuovo token');
    return null;
  }

  // Log in italiano: token in cache ancora valido
  console.log('[auth] Token in cache valido');
  return cached.access_token;
}

/**
 * Scrive il token ottenuto nella cache DynamoDB con la scadenza calcolata.
 * @param {string} access_token - Token Bearer da PingFederate
 * @param {number} expires_in - Durata di validità in secondi
 * @param {string} scope - Scope con cui il token è stato ottenuto
 * @param {string} clientId - client_id con cui il token è stato ottenuto
 */
async function writeCachedToken(access_token, expires_in, scope, clientId) {
  // Applica il margine di sicurezza al TTL: il token viene rigenerato 30s prima
  // della scadenza effettiva
  const ttlSeconds = Math.max(expires_in - EXPIRY_BUFFER_SECONDS, 0);
  // Salva il token, lo scope e il client_id nella cache DynamoDB
  await setCacheItem(TOKEN_CACHE_KEY, { access_token, scope, client_id: clientId }, ttlSeconds);
}

/**
 * Restituisce un Bearer token PingFederate valido.
 * Controlla prima la cache su DynamoDB; chiama PingFederate solo se il token
 * è assente, scaduto o con scope/client_id non più validi.
 * @returns {Promise<string>} Token di accesso Bearer
 * @throws {Error} Se PingFederate risponde con status diverso da 200
 * @throws {Error} Se la risposta non contiene il campo access_token
 */
async function getBearerToken() {
  // Carica la configurazione (asincrona — credenziali da SSM/Secrets Manager)
  const config = await getConfig();

  // Tenta di leggere il token dalla cache DynamoDB
  const cached = await readCachedToken(config.auth.scope, config.auth.clientId);
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

  // Scrive il nuovo token nella cache DynamoDB
  await writeCachedToken(token, expiresIn, config.auth.scope, config.auth.clientId);

  // Restituisce il token appena ottenuto
  return token;
}

// Esporta la funzione per l'utilizzo negli altri moduli della Lambda
module.exports = { getBearerToken };
