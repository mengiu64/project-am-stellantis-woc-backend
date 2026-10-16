'use strict';

/**
 * wyzService.js — Chiamate verso il servizio REST esterno "Wyz – Tyre search".
 *
 * Azioni esposte:
 *  - getSearchFilters : chiama vehicle-brands, vehicle-types, brands, seasons e restituisce
 *                       un unico oggetto normalizzato pronto per le dropdown del front-end
 *  - searchQuote      : POST /api/tyres/search/quote (ricerca pneumatici con prezzi/disponibilità)
 *
 * Gli errori sono sempre istanze di WyzError con uno statusCode HTTP applicativo già mappato
 * (mai 401/403: riservati all'autenticazione di piattaforma, v. Integration Guide).
 */

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getBearerToken, invalidateToken } = require('./authService');
const { getConfig } = require('./config');
const { callService } = require('../serviceClient');

/** Errore applicativo con statusCode HTTP da restituire al front-end. */
class WyzError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode - status HTTP da restituire al chiamante
   * @param {{errorCode?: string, contextCode?: string, upstreamStatus?: number, details?: *}} [extra]
   */
  constructor(message, statusCode, extra = {}) {
    super(message);
    this.name = 'WyzError';
    this.statusCode = statusCode;
    this.errorCode = extra.errorCode;
    this.contextCode = extra.contextCode;
    this.upstreamStatus = extra.upstreamStatus;
    this.details = extra.details;
  }
}

/**
 * Mappa lo status/errore upstream in uno status HTTP applicativo.
 * 401/403 upstream NON sono propagati (l'SPA li interpreterebbe come re-login) → 502.
 * @param {number} upstreamStatus
 * @param {string} [errorCode]
 * @returns {number}
 */
function mapStatus(upstreamStatus, errorCode) {
  if (errorCode === 'CUSTOMER_NOT_FOUND') return 404;
  if ([400, 404, 422].includes(upstreamStatus)) return upstreamStatus;
  return 502;
}

/**
 * Esegue una richiesta autenticata verso Wyz; su 401 invalida il token e ritenta una sola volta.
 * @param {'GET'|'POST'} method
 * @param {string} resourcePath - es. "/api/tyres/brands"
 * @param {{query?: object, body?: object, correlationId?: string}} params
 * @returns {Promise<*>} contenuto della proprietà "data" della risposta Wyz
 * @throws {WyzError}
 */
async function callWyz(method, resourcePath, { query = {}, body = null, correlationId } = {}) {
  const config = await getConfig();

  let endpoint;
  try {
    endpoint = new URL(config.api.baseUrl);
  } catch (err) {
    throw new WyzError(`baseUrl Wyz non valido: "${config.api.baseUrl}"`, 500);
  }

  // Il parametro partner è obbligatorio su tutti gli endpoint Wyz
  const qs = new URLSearchParams({ ...query, partner: config.partner }).toString();
  const path = `${endpoint.pathname.replace(/\/$/, '')}${resourcePath}?${qs}`;
  const bodyStr = body ? JSON.stringify(body) : null;

  let response;
  // Massimo 2 tentativi: il secondo solo dopo un 401 (token scaduto/revocato in cache)
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let token;
    try {
      token = await getBearerToken();
    } catch (err) {
      console.error(`[wyzService] Autenticazione verso Wyz fallita: ${err.message}`);
      throw new WyzError('Autenticazione verso il servizio Wyz fallita', 502);
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
    };
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const options = {
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path,
      method,
      timeout: config.timeoutMs,
      headers,
    };

    console.log(`[wyzService] ${method} ${endpoint.protocol}//${endpoint.hostname}${path} (tentativo ${attempt})`);
    try {
      response = await httpsRequest(options, bodyStr);
    } catch (err) {
      // Errore di trasporto (DNS, connessione, timeout)
      const isTimeout = /timeout/i.test(err.message);
      console.error(`[wyzService] ${resourcePath} errore di rete: ${err.message}`);
      throw new WyzError(
        isTimeout ? 'Timeout nella chiamata al servizio Wyz' : 'Servizio Wyz non raggiungibile',
        isTimeout ? 504 : 502
      );
    }

    if (response.statusCode === 401 && attempt === 1) {
      console.warn(`[wyzService] ${resourcePath} ha risposto 401: invalido il token e ritento`);
      await invalidateToken();
      continue;
    }
    break;
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    // Formato errore Wyz: { error: { context_code, error_code, status } }
    const wyzErr = (response.body && typeof response.body === 'object' && (response.body.error || response.body)) || {};
    const errorCode = wyzErr.error_code;
    const statusCode = mapStatus(response.statusCode, errorCode);
    console.error(
      `[wyzService] ${resourcePath} fallita: HTTP ${response.statusCode}, error_code=${errorCode}, context_code=${wyzErr.context_code}`
    );
    throw new WyzError(`Wyz ${resourcePath} ha risposto con HTTP ${response.statusCode}`, statusCode, {
      errorCode,
      contextCode: wyzErr.context_code,
      upstreamStatus: response.statusCode,
      details: statusCode === 422 ? wyzErr.details || wyzErr.errors : undefined,
    });
  }

  // Tutte le risposte Wyz hanno la radice { data: ... }
  const payload = response.body;
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    console.error(`[wyzService] ${resourcePath}: risposta priva della proprietà "data"`);
    throw new WyzError(`Risposta non valida da Wyz ${resourcePath}`, 502);
  }
  return payload.data;
}

// ── Normalizzatori: forma compatta e uniforme per le dropdown del front-end ──

const asArray = (v) => (Array.isArray(v) ? v : []);

/** vehicle-brands → [{id, name}] */
function normalizeVehicleBrands(data) {
  return asArray(data).map((b) => ({ id: b.publicKey, name: b.brand }));
}

/** vehicle-types → lista piatta + raggruppamento per universo (TO, CAM, 4X4...) */
function normalizeVehicleTypes(data) {
  const types = asArray(data).map((t) => ({
    id: t.publicKey,
    name: t.name,
    groupId: t.groupPublicKey,
    groupName: t.groupName,
  }));
  const groups = new Map();
  types.forEach((t) => {
    if (!groups.has(t.groupId)) {
      groups.set(t.groupId, { id: t.groupId, name: t.groupName, types: [] });
    }
    groups.get(t.groupId).types.push({ id: t.id, name: t.name });
  });
  return { types, groups: Array.from(groups.values()) };
}

/** brands → [{id, name, segment, rank}] ordinati per rank (quelli senza rank in coda) */
function normalizeTyreBrands(data) {
  return asArray(data)
    .map((b) => ({ id: b.publicKey, name: b.name, segment: b.segment, rank: b.rank }))
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

/** seasons → [{id, name, i18nKey}] */
function normalizeSeasons(data) {
  return asArray(data).map((s) => ({ id: s.publicKey, name: s.name, i18nKey: s.i18nKey }));
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Metodo 1 — recupera in una sola chiamata i riferimenti per i filtri di ricerca.
 * Le 4 chiamate Wyz sono indipendenti e vengono eseguite in parallelo; se anche una sola
 * fallisce, l'azione fallisce (WyzError con l'elenco delle chiamate fallite in `details`).
 * @param {{customerRrdiCode: string, hubCode: string}} params
 * @param {{correlationId?: string}} [ctx]
 * @returns {Promise<{filters: object}>}
 * @throws {WyzError}
 */
async function getSearchFilters(params, ctx = {}) {
  const required = ['customerRrdiCode', 'hubCode'];
  const missing = required.filter((k) => !params || !isNonEmptyString(params[k]));
  if (missing.length > 0) {
    throw new WyzError(`Missing required field(s): ${missing.join(', ')}`, 400);
  }

  const { correlationId } = ctx;
  console.log(`[getSearchFilters] Avvio 4 chiamate Wyz (customerRrdiCode=${params.customerRrdiCode}, hubCode=${params.hubCode})`);

  const calls = {
    vehicleBrands: () => callWyz('GET', '/api/tyres/vehicle-brands', { correlationId }),
    vehicleTypes: () =>
      callWyz('GET', '/api/tyres/vehicle-types', {
        query: { customerRrdiCode: params.customerRrdiCode, hubCode: params.hubCode },
        correlationId,
      }),
    tyreBrands: () =>
      callWyz('GET', '/api/tyres/brands', {
        query: { customerRrdiCode: params.customerRrdiCode, hubCode: params.hubCode },
        correlationId,
      }),
    seasons: () => callWyz('GET', '/api/tyres/seasons', { correlationId }),
  };

  const keys = Object.keys(calls);
  const settled = await Promise.allSettled(keys.map((k) => calls[k]()));

  // Se anche una sola chiamata fallisce, l'intera azione fallisce (nessuna risposta parziale)
  const failed = {};
  const raw = {};
  settled.forEach((res, i) => {
    const key = keys[i];
    if (res.status === 'fulfilled') {
      raw[key] = res.value;
    } else {
      const e = res.reason;
      console.error(`[getSearchFilters] Chiamata "${key}" fallita: ${e.message}`);
      failed[key] = e;
    }
  });

  const failedKeys = Object.keys(failed);
  if (failedKeys.length > 0) {
    // Lo status restituito è quello della prima chiamata fallita (nell'ordine delle chiamate)
    const first = failed[failedKeys[0]];
    throw new WyzError(`getSearchFilters fallita: errore nelle chiamate Wyz [${failedKeys.join(', ')}]`, first.statusCode || 502, {
      errorCode: first.errorCode,
      contextCode: first.contextCode,
      upstreamStatus: first.upstreamStatus,
      details: {
        failedCalls: failedKeys.map((k) => ({
          call: k,
          status: failed[k].statusCode || 502,
          message: failed[k].message,
          ...(failed[k].errorCode ? { errorCode: failed[k].errorCode } : {}),
        })),
      },
    });
  }

  const vehicleTypes = normalizeVehicleTypes(raw.vehicleTypes);
  const filters = {
    vehicleBrands: normalizeVehicleBrands(raw.vehicleBrands),
    vehicleTypes: vehicleTypes.types,
    vehicleTypeGroups: vehicleTypes.groups,
    tyreBrands: normalizeTyreBrands(raw.tyreBrands),
    seasons: normalizeSeasons(raw.seasons),
  };

  console.log('[getSearchFilters] Completato');
  return { filters };
}

// Campi del body accettati da /api/tyres/search/quote: tutto il resto viene scartato.
const QUOTE_ALLOWED_FIELDS = [
  'customerRrdiCode', 'hubCode', 'width', 'height', 'diameter', 'loadIndexes', 'speedIndexes',
  'seasons', 'brands', 'vehicleTypes', 'quantity', 'runFlat', 'vehicleBrands',
];

const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Metodo 2 — ricerca preventivi pneumatici (POST /api/tyres/search/quote).
 * @param {object} params - body di ricerca (v. QUOTE_ALLOWED_FIELDS)
 * @param {{correlationId?: string}} [ctx]
 * @returns {Promise<object>} contenuto di "data" ({ items: [...] })
 * @throws {WyzError}
 */
async function searchQuote(params, ctx = {}) {
  const input = params && typeof params === 'object' ? params : {};

  // Validazione campi obbligatori (documentazione Wyz §10.6.1)
  const errors = [];
  ['customerRrdiCode', 'hubCode'].forEach((k) => {
    if (!isNonEmptyString(input[k])) errors.push(`${k} (stringa obbligatoria)`);
  });
  ['width', 'height', 'diameter'].forEach((k) => {
    if (!isPositiveNumber(input[k])) errors.push(`${k} (numero > 0 obbligatorio)`);
  });
  if (!Number.isInteger(input.quantity) || input.quantity < 1) errors.push('quantity (intero >= 1 obbligatorio)');
  ['vehicleTypes', 'vehicleBrands'].forEach((k) => {
    if (!Array.isArray(input[k]) || input[k].length === 0) errors.push(`${k} (array non vuoto obbligatorio)`);
  });
  if (errors.length > 0) {
    throw new WyzError(`Missing or invalid required field(s): ${errors.join(', ')}`, 400);
  }

  // Inoltra solo i campi noti
  const body = {};
  QUOTE_ALLOWED_FIELDS.forEach((k) => {
    if (input[k] !== undefined && input[k] !== null) body[k] = input[k];
  });

  console.log(`[searchQuote] Ricerca ${body.width}/${body.height} R${body.diameter}, quantity=${body.quantity}`);
  const data = await callWyz('POST', '/api/tyres/search/quote', { body, correlationId: ctx.correlationId });

  // Scarta gli pneumatici senza stock
  if (data && Array.isArray(data.items)) {
    data.items = data.items.filter((item) => item?.tyre?.status !== 'EMPTY_STOCK');
  }
  console.log(`[searchQuote] Completata: ${Array.isArray(data && data.items) ? data.items.length : 0} risultati`);

  await enrichQuoteItems(data, input, ctx);
  return data;
}

const isBlank = (v) => v === undefined || v === null || v === '';

// Prezzo Wyz: stock 'Hub' prevale su 'Tyre producer'; sellingPrice vuoto -> bf
function resolveWyzPrice(stocks) {
  if (!Array.isArray(stocks)) return null;
  const byName = (n) => stocks.find((s) => String(s?.name ?? '').trim().toLowerCase() === n);
  const stock = byName('hub') || byName('tyre producer');
  if (!stock) return null;
  const raw = isBlank(stock.sellingPrice) ? stock.bf : stock.sellingPrice;
  const n = isBlank(raw) ? null : Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Costruisce partReferenceMap { [partReference]: {...} } dagli item di searchQuote
function buildPartReferenceMap(items) {
  const map = Object.create(null);
  items.forEach((item) => {
    const reference = item?.tyre?.reference;
    if (isBlank(reference)) return;
    const partReference = String(reference);
    map[partReference] = {
      partReference,
      wyzPrice: resolveWyzPrice(item.stocks),
      StockPrixBuyingPrice: null,
      maxAllowableDiscount: null,
      availability: null,
    };
  });
  return map;
}

// Dealer per getStockPrix: per passare a quello variabile basta impostare USE_FIXED_DEALER_ID = false
const USE_FIXED_DEALER_ID = true;
const FIXED_DEALER_ID = '345678A';
const resolveStockPrixDealerId = (sessionData) => (USE_FIXED_DEALER_ID ? FIXED_DEALER_ID : sessionData?.dealerId);

const MAX_STOCKPRIX_LINES = 10; // limite righe inviate a getStockPrix da searchQuote

// Arricchisce partReferenceMap con StockPrixKBRWDetails.priceTTC (getStockPrix)
async function applyStockPrix(partReferenceMap, sessionData, ctx) {
  const { getStockPrix } = require('./stockPrixService');
  const country = String(sessionData?.locale ?? '').split('_')[1];
  // a getStockPrix si inviano al massimo MAX_STOCKPRIX_LINES righe: le eccedenti restano senza prezzo
  const references = Object.values(partReferenceMap);
  if (references.length > MAX_STOCKPRIX_LINES) {
    console.warn(`[searchQuote] getStockPrix: ${references.length} righe, troncate a ${MAX_STOCKPRIX_LINES}`);
  }
  const result = await getStockPrix({
    clientApplicationName: 'WIADVISOR',
    customerDMSHeader: '95754',
    dealerId: resolveStockPrixDealerId(sessionData),
    country,
    brand: sessionData?.brandvehic_reftech,
    vin: 'VF3CABHW6GT204366', // temporaneo: valore fisso
    partLines: references.slice(0, MAX_STOCKPRIX_LINES).map((e) => ({ partReference: e.partReference, quantity: 1 })),
  }, ctx);

  (result?.items ?? []).forEach((d) => {
    const entry = partReferenceMap[d?.partReference];
    if (!entry || d.priceTTC === null || d.priceTTC === undefined) return;
    entry.StockPrixBuyingPrice = d.priceTTC;
    entry.maxAllowableDiscount = entry.wyzPrice === null ? null : Math.max(0, d.priceTTC - entry.wyzPrice);
  });
}

// Chiama dms/inquiry (stessa logica di pkManager.getPriceAndAvailability) con le parti di partReferenceMap
async function getPriceAndAvailability(documentId, customerId, vehicleId, market, username, partReferenceMap, ctx) {
  const resolved = await callService('dms', 'resolveSender', {
    context: { username, vin: vehicleId },
    overrides: {
      mainSincom: ctx?.mainSincom,
      market,
      brand: ctx?.brand,
      language: ctx?.language,
      dealerCountryCode: ctx?.dealerCountryCode,
    },
  });
  const dealerNumberId = resolved.mainSincom;
  const sender = {
    dealerNumberId,
    dealerNumberIdSource: dealerNumberId,
    dealerCountryCode: resolved.dealerCountryCode,
    languageCode: resolved.language,
    brand: resolved.brand,
    market: resolved.market,
    serviceId: username,
  };
  return callService('dms', 'inquiry', {
    PartsInquiryHeader: {
      DocumentID: documentId,
      CustomerIdDms: customerId,
      MessageType: 'WL',
      VehicleID: vehicleId,
    },
    customerAccountDmsId: null,
    workLines: [{
      workLineReference: '001',
      partNumbers: Object.values(partReferenceMap).map((e) => e.partReference),
      laborOperationIds: [],
    }],
    sender,
  });
}

// availability = QuantityAvailable del primo BinLocation di ciascun PartsItem
function applyInquiry(partReferenceMap, inquiry) {
  (inquiry?.WorkLines ?? []).forEach((line) => {
    (line?.PartsItem ?? []).forEach((part) => {
      const entry = partReferenceMap[part?.PartNumber];
      const qty = part?.BinLocation?.[0]?.QuantityAvailable;
      if (entry && !isBlank(qty)) entry.availability = qty;
    });
  });
}

// Arricchisce data.items[].tyre con i dati di partReferenceMap (null se non trovati)
async function enrichQuoteItems(data, input, ctx) {
  if (!data || !Array.isArray(data.items)) return;
  const partReferenceMap = buildPartReferenceMap(data.items);
  if (Object.keys(partReferenceMap).length === 0) return;

  // Identità solo dall'authorizer; il body è ammesso solo senza authorizer (invocazione diretta/CLI)
  const username = ctx.authorizer ? ctx.authorizer.sub : input.username;
  if (!isNonEmptyString(username)) {
    throw new WyzError('Utente non autenticato: authorizer.sub mancante nella richiesta', 400);
  }

  const sessionData = await callService('session', 'getData', { args: [username] });
  const sessionCtx = await callService('session', 'getContext', { args: [username] });

  // Un errore dei servizi di arricchimento non deve bloccare la ricerca: i campi restano null
  try {
    await applyStockPrix(partReferenceMap, sessionData, ctx);
  } catch (err) {
    console.error(`[searchQuote] getStockPrix fallita: ${err.message}`);
  }
  try {
    const inquiry = await getPriceAndAvailability(
      null, null, 'VF3CABHW6GT204366', sessionData?.codmarket, sessionData?.username,
      partReferenceMap, { ...sessionCtx, brand: sessionData?.brandvehic_reftech },
    );
    applyInquiry(partReferenceMap, inquiry);
  } catch (err) {
    console.error(`[searchQuote] inquiry fallita: ${err.message}`);
  }

  data.items.forEach((item) => {
    if (isBlank(item?.tyre?.reference)) return;
    const entry = partReferenceMap[String(item.tyre.reference)];
    item.tyre.StockPrixBuyingPrice = entry.StockPrixBuyingPrice;
    item.tyre.maxAllowableDiscount = entry.maxAllowableDiscount;
    item.tyre.wyzPrice = entry.wyzPrice;
    item.tyre.availability = entry.availability;
  });
}

module.exports = { getSearchFilters, searchQuote, WyzError, mapStatus };
