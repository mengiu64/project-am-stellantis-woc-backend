'use strict';

/**
 * sessionContextCache.js — risoluzione AUTOMATICA (nessun parametro dal FE) di
 * mainSincom/market/language/dealerCountryCode a partire dal solo `username`
 * autenticato (event.requestContext.authorizer.sub), per costruire il Sender
 * dinamico dell'inquiry DMS (v. dms/dmsService.js::resolveDynamicSenderFields
 * / buildApplicationArea) senza che il chiamante (jobcard, pkFavorite,
 * pkManager) debba ricevere questi dati dal frontend: il FE NON passa (e non
 * deve passare) mainSincom/market/lingua/country — sono tutti dati già noti
 * lato backend tramite la stessa risoluzione myPeople usata dalla lambda
 * `session` (v. MyPeopleDmsSessionRepository).
 *
 * Il `brand` del Sender NON viene risolto qui: è il brand del VEICOLO (non
 * del dealer/sessione — un dealer multi-brand può servire un veicolo di un
 * brand diverso dal proprio), risolto invece da v360/v360Service.js
 * ::getCachedBrand(vin) — v. dms/dmsService.js::resolveDynamicSenderFields,
 * che combina i risultati di questo modulo e di v360Service.
 *
 * getCachedSessionContext(username):
 *  1. controlla la cache condivisa DynamoDB (TmpCacheTable, chiave
 *     session:context:<username>, v. dynamoCache.js; TTL configurabile via
 *     env SESSION_CONTEXT_CACHE_TTL_MS, default 5 min): evita di richiamare
 *     myPeople ad ogni singola richiesta quando la stessa istanza Lambda
 *     (warm) — o una chiamata REST interna a session — gestisce più richieste dello stesso
 *     utente in rapida successione (es. una chiamata DML per ciascun
 *     pacchetto preferito in pkFavorite, o più azioni "dml" sulla stessa
 *     jobcard);
 *  2. in caso di cache-miss/scaduta, richiama in-process
 *     MyPeopleDmsSessionRepository::getSessionData(username) (stesso codice
 *     usato dalla lambda `session`) e salva il risultato in DynamoDB per le
 *     richieste successive;
 *  3. estrae SOLO i campi utili al Sender DML: mainSincom<-sincom,
 *     market<-codmarket, dealerCountryCode<-marketIso, language<-language.
 *
 * Interamente best-effort: se `username` è assente, se myPeople non risponde,
 * se l'utente non è noto, o se la cache DynamoDB non è raggiungibile (es.
 * problemi di rete/permessi IAM), non viene MAI sollevata un'eccezione — si
 * ritorna un oggetto vuoto (o parziale) e si logga solo un warning. Il
 * chiamante (dms/dmsService.js::resolveDynamicSenderFields, usato da
 * jobcard/jobCardService.js::buildDmsSender, pkFavorite/index.js
 * ::buildDmsSender e pkManager/PkManager.js::_buildDmsSender) continua quindi
 * con i soli campi risolti (se nessuno, il Sender ricade sui default statici
 * di dms/config.js).
 *
 * La factory caricata sotto e' locale a session. La repository usa REST per
 * myPeople/dbmanager/dmlconfigsync; i consumer esterni accedono alla cache
 * tramite le operazioni interne getData/getContext, non importando questa Lambda.
 *
 * getOrCreateSessionData(username, buildSessionData) e' lo stesso cache-aside
 * senza la resa best-effort, usato dal GET /session pubblico (v. index.js) per
 * gli utenti dealer: legge la chiave session:context:<username> e, se assente o
 * scaduta, costruisce i dati con il builder del chiamante, li salva e li
 * ritorna. Gli errori del builder si propagano e non vengono salvati in cache.
 */

const path = require('path');
const { getCacheItem, setCacheItem } = require('./dynamoCache');

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minuti

function resolveTtlMs(overrideTtlMs) {
  if (typeof overrideTtlMs === 'number') return overrideTtlMs;
  const envTtl = Number(process.env.SESSION_CONTEXT_CACHE_TTL_MS);
  return envTtl > 0 ? envTtl : DEFAULT_TTL_MS;
}

/** Chiave di cache DynamoDB per-username. */
function cacheKeyForUsername(username) {
  return `session:context:${username}`;
}

async function readCachedSessionData(username) {
  return getCacheItem(cacheKeyForUsername(username));
}

async function writeCachedSessionData(username, sessionData, ttlMs) {
  await setCacheItem(cacheKeyForUsername(username), sessionData, Math.ceil(ttlMs / 1000));
}

function loadGetSessionData() {
  const { buildMyPeopleDmsRepository } = require(path.resolve(__dirname, './repositoryFactory'));
  return (username) => buildMyPeopleDmsRepository().getSessionData(username);
}

/** Estrae solo i campi utili al Sender DML dalla risposta completa di sessione (brand escluso: v. v360Service::getCachedBrand). */
function toSenderContext(sessionData) {
  if (!sessionData) return {};
  const ctx = {};
  if (sessionData.sincom) ctx.mainSincom = sessionData.sincom;
  if (sessionData.codmarket) ctx.market = sessionData.codmarket;
  if (sessionData.marketIso) ctx.dealerCountryCode = sessionData.marketIso;
  if (sessionData.language) ctx.language = sessionData.language;
  return ctx;
}

/**
 * Cache-aside sui dati di sessione completi: ritorna il valore in cache
 * (chiave `session:context:<username>`) se presente e non scaduto, altrimenti
 * li costruisce con `buildSessionData(username)`, li salva in cache (TTL v.
 * resolveTtlMs) e li ritorna.
 *
 * NON best-effort sulla costruzione: un errore di `buildSessionData` viene
 * propagato al chiamante e nulla viene salvato in cache. Lettura e scrittura
 * DynamoDB restano invece best-effort (v. dynamoCache.js): se la cache non e'
 * raggiungibile i dati vengono comunque costruiti e ritornati.
 *
 * @param {string} username
 * @param {(username: string) => Promise<object>} buildSessionData - costruisce i dati in caso di cache-miss
 * @param {{ ttlMs?: number }} [overrides] - injection per i test
 * @returns {Promise<object>} i dati di sessione, dalla cache o appena costruiti
 */
async function getOrCreateSessionData(username, buildSessionData, overrides = {}) {
  const cached = await readCachedSessionData(username);
  if (cached) return cached;

  const sessionData = await buildSessionData(username);
  await writeCachedSessionData(username, sessionData, resolveTtlMs(overrides.ttlMs));
  return sessionData;
}

/**
 * Come getCachedSessionContext, ma ritorna l'intero oggetto sessionData
 * (myPeople + dms/settings, v. MyPeopleDmsSessionRepository::getSessionData)
 * cosi' come cachato in DynamoDB, invece del solo sottoinsieme utile al
 * Sender DML: usato dai chiamanti che necessitano di altri campi di sessione
 * (es. jobcard/index.js::buildUpdateNagaPayload -> pdvId/locale/
 * brandvehic_reftech/brandvehic_fca/username per il payload updatenaga di
 * agendaSoaNaga). Stessa cache condivisa (chiave `session:context:<username>`)
 * di getCachedSessionContext: una singola richiesta myPeople per utente serve
 * quindi entrambi i chiamanti.
 *
 * Interamente best-effort: se `username` è assente o la risoluzione fallisce
 * per qualunque motivo, ritorna `null` invece di sollevare un'eccezione.
 *
 * @param {string} username
 * @param {{ getSessionDataFn?: (username: string) => Promise<object>, ttlMs?: number }} [overrides] - injection per i test
 * @returns {Promise<object|null>} l'intero sessionData, o null se non risolvibile
 */
async function getCachedSessionData(username, overrides = {}) {
  if (!username) return null;

  try {
    const buildSessionData = (user) => (overrides.getSessionDataFn || loadGetSessionData())(user);
    return await getOrCreateSessionData(username, buildSessionData, overrides);
  } catch (err) {
    console.warn(`[sessionContextCache] impossibile risolvere i dati di sessione per "${username}": ${err.message}`);
    return null;
  }
}

/**
 * @param {string} username
 * @param {{ getSessionDataFn?: (username: string) => Promise<object>, ttlMs?: number }} [overrides] - injection per i test
 * @returns {Promise<{ mainSincom?: string, market?: string, language?: string, dealerCountryCode?: string }>}
 */
async function getCachedSessionContext(username, overrides = {}) {
  const sessionData = await getCachedSessionData(username, overrides);
  return toSenderContext(sessionData);
}

module.exports = { getCachedSessionContext, getCachedSessionData, getOrCreateSessionData };
