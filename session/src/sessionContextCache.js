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
 *     (warm) — o un'altra funzione che bundla questo modulo come sibling
 *     (jobcard/pkFavorite/pkManager) — gestisce più richieste dello stesso
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
 * Cross-lambda-folder require (path.resolve(__dirname, './repositoryFactory')):
 * questo modulo vive in session/src/ ma viene richiesto da dms/dmsService.js
 * come cartella sorella (require(path.resolve(__dirname, '../session/src/sessionContextCache'))),
 * stesso pattern già usato da pkManager per dms/dbManager — il build di
 * JobCardFunction/PkFavoriteFunction/PkManagerFunction (Metadata: BuildMethod:
 * makefile, v. Makefile) impacchetta quindi anche session/, myPeople/ e
 * dmlConfigSync/ come cartelle sorelle, oltre a dms/dbManager/v360 già
 * presenti/aggiunti.
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
 * @param {string} username
 * @param {{ getSessionDataFn?: (username: string) => Promise<object>, ttlMs?: number }} [overrides] - injection per i test
 * @returns {Promise<{ mainSincom?: string, market?: string, language?: string, dealerCountryCode?: string }>}
 */
async function getCachedSessionContext(username, overrides = {}) {
  if (!username) return {};

  const ttlMs = resolveTtlMs(overrides.ttlMs);

  const cached = await readCachedSessionData(username);
  if (cached) return toSenderContext(cached);

  try {
    const getSessionData = overrides.getSessionDataFn || loadGetSessionData();
    const sessionData = await getSessionData(username);
    await writeCachedSessionData(username, sessionData, ttlMs);
    return toSenderContext(sessionData);
  } catch (err) {
    console.warn(`[sessionContextCache] impossibile risolvere i dati di sessione per "${username}": ${err.message}`);
    return {};
  }
}

module.exports = { getCachedSessionContext };

