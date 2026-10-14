'use strict';

/**
 * stockPrixService.js — Wrapper del servizio SOAP esterno "StockPrixService" (Panier SOA PSA).
 *
 * Azione esposta:
 *  - getStockPrix : operazione SOAP getStockPrixKBRW (stock e prezzi di uno o più ricambi per dealer)
 *
 * A differenza delle altre azioni wyz la chiamata richiede mutual TLS (certificato client + chiave,
 * gli stessi secret apic-cert/apic-key di agendaSoa) oltre a Basic Auth e client_id (secret wyz).
 * Gli errori sono WyzError con status già mappato (mai 401/403, v. Integration Guide).
 */

// Parsing dell'URL dell'endpoint (host, porta, path).
const { URL } = require('url');
// Parser XML per la busta SOAP di risposta.
const xml2js = require('xml2js');
// Client HTTPS della lambda (log request/response con header sensibili mascherati).
const { httpsRequest } = require('./httpClient');
// Configurazione (URL per ambiente + credenziali dal secret wyz).
const { getConfig } = require('./config');
// Agent mTLS con certificato client.
const { getHttpsAgent, invalidateAgent } = require('./certService');
// Errore applicativo con status HTTP mappato, condiviso con le altre azioni wyz.
const { WyzError } = require('./wyzService');

// Namespace SOAP 1.1 della busta.
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
// Namespace del servizio StockPrix.
const STOCKPRIX_NS = 'http://xml.inetpsa.com/pnr/stockprixservice/';
const STOCKPRIX_PREPROD_PATH = '/api/cert-aai/applications/panier-soa/ws/StockPrixService/v1';
const STOCKPRIX_PROD_PATH = '/applications/panier-soa/ws/StockPrixService/v1';
// Numero massimo di righe ricambio per chiamata (limite del servizio: 1..100).
const MAX_PART_LINES = 100;
// Pattern di customerDMSHeader imposto dall'XSD del servizio.
const CUSTOMER_DMS_HEADER_PATTERN = /^[0-9A-Za-z-]{2,40}$/;
// Codice paese ISO 3166-1 alpha-2.
const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;
// Codice brand a 2 caratteri (es. AC, AP, DS, OV).
const BRAND_PATTERN = /^[A-Za-z0-9]{2}$/;
// Pattern dealerIDType imposto dall'XSD di StockPrixService.
const DEALER_ID_PATTERN = /^[0-9A-Za-z]{7,10}$/;
// VIN di 17 caratteri alfanumerici (opzionale).
const VIN_PATTERN = /^[A-Za-z0-9]{17}$/;
// Lunghezza massima dei campi stringa liberi.
const MAX_STRING_LENGTH = 40;
// Quantità massima accettata per riga.
const MAX_QUANTITY = 99999;

function getStockPrixServicePath(hostname) {
  return hostname === 'api-cert-preprod.groupe-psa.com' ? STOCKPRIX_PREPROD_PATH : STOCKPRIX_PROD_PATH;
}

// Opzioni del parser: niente array per elementi singoli, attributi ignorati, prefissi namespace rimossi.
const XML_PARSER_OPTIONS = {
  // Elemento singolo -> oggetto, elementi ripetuti -> array.
  explicitArray: false,
  // Gli attributi (xmlns) non servono.
  ignoreAttrs: true,
  // "S:Envelope" -> "Envelope", "ns2:getStockPrixKBRWResponse" -> "getStockPrixKBRWResponse".
  tagNameProcessors: [xml2js.processors.stripPrefix],
  // Spazi ai bordi dei testi rimossi.
  trim: true,
};

/** true se il valore è una stringa non vuota. */
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
/** Normalizza un valore singolo/array/assente in array. */
const asArray = (v) => {
  // Valore assente o stringa vuota (elemento XML vuoto) -> array vuoto.
  if (v === undefined || v === null || v === '') return [];
  // Array già pronto oppure valore singolo incapsulato.
  return Array.isArray(v) ? v : [v];
};

/**
 * Escape dei caratteri speciali XML: impedisce l'iniezione di markup nella busta SOAP.
 * @param {*} value
 * @returns {string}
 */
function escapeXml(value) {
  // Valori assenti -> elemento vuoto (il servizio richiede comunque la presenza del tag).
  if (value === undefined || value === null) return '';
  // Sostituzione dei 5 caratteri riservati XML.
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converte una stringa numerica SOAP (es. "13.7340") in numero; null se assente/non numerica.
 * @param {*} value
 * @returns {number|null}
 */
function toNumber(value) {
  // Elemento assente o vuoto.
  if (value === undefined || value === null || value === '') return null;
  // Conversione numerica.
  const n = Number(value);
  // Solo numeri finiti.
  return Number.isFinite(n) ? n : null;
}

/**
 * Legge il dealerId obbligatorio dal payload del client.
 * @param {object} input - payload del front-end
 * @returns {string}
 */
function resolveDealerId(input) {
  return isNonEmptyString(input.dealerId) ? input.dealerId.trim() : '';
}

/**
 * Valida una stringa opzionale di lunghezza limitata.
 * @returns {string} valore trim-mato o stringa vuota
 */
function optionalString(value, field, errors) {
  // Campo non valorizzato: elemento vuoto nella busta.
  if (value === undefined || value === null || value === '') return '';
  // Tipo o lunghezza non validi.
  if (typeof value !== 'string' || value.trim().length > MAX_STRING_LENGTH) {
    // Errore accumulato.
    errors.push(`${field} (stringa max ${MAX_STRING_LENGTH} caratteri)`);
    // Valore neutro.
    return '';
  }
  // Valore normalizzato.
  return value.trim();
}

/**
 * Valida e normalizza il payload del front-end.
 * @param {object} input
 * @param {string} dealerId
 * @returns {object} richiesta normalizzata
 * @throws {WyzError} 400 con l'elenco dei campi non validi
 */
function validateInput(input, dealerId) {
  // Elenco degli errori di validazione.
  const errors = [];

  // customerDMSHeader obbligatorio con il pattern dell'XSD.
  const customerDMSHeader = typeof input.customerDMSHeader === 'number' ? String(input.customerDMSHeader) : input.customerDMSHeader;
  // Verifica del pattern.
  if (typeof customerDMSHeader !== 'string' || !CUSTOMER_DMS_HEADER_PATTERN.test(customerDMSHeader.trim())) {
    // Errore accumulato.
    errors.push('customerDMSHeader (2-40 caratteri alfanumerici o "-")');
  }
  // dealerId obbligatorio con il pattern dell'XSD StockPrixService.
  if (!isNonEmptyString(dealerId) || !DEALER_ID_PATTERN.test(dealerId.trim())) {
    // Errore accumulato.
    errors.push('dealerId (stringa obbligatoria, 7-10 caratteri alfanumerici)');
  }
  // country obbligatorio (ISO alpha-2).
  if (typeof input.country !== 'string' || !COUNTRY_PATTERN.test(input.country.trim())) {
    // Errore accumulato.
    errors.push('country (codice ISO a 2 lettere)');
  }
  // brand obbligatorio (2 caratteri).
  if (typeof input.brand !== 'string' || !BRAND_PATTERN.test(input.brand.trim())) {
    // Errore accumulato.
    errors.push('brand (codice a 2 caratteri, es. AC, AP, DS, OV)');
  }
  // vin opzionale ma, se presente, di 17 caratteri.
  const vin = input.vin === undefined || input.vin === null ? '' : input.vin;
  // Verifica del formato.
  if (vin !== '' && (typeof vin !== 'string' || !VIN_PATTERN.test(vin.trim()))) {
    // Errore accumulato.
    errors.push('vin (17 caratteri alfanumerici, opzionale)');
  }

  // partLines obbligatorio: array di 1..100 righe.
  const rawLines = input.partLines;
  // Verifica della cardinalità.
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > MAX_PART_LINES) {
    // Errore accumulato.
    errors.push(`partLines (array di 1..${MAX_PART_LINES} elementi)`);
  }
  // Validazione delle singole righe.
  const partLines = (Array.isArray(rawLines) ? rawLines.slice(0, MAX_PART_LINES) : []).map((line, i) => {
    // Riga non oggetto: trattata come vuota.
    const l = line && typeof line === 'object' ? line : {};
    // Riferimento ricambio obbligatorio.
    if (!isNonEmptyString(l.partReference) || l.partReference.trim().length > MAX_STRING_LENGTH) {
      // Errore con indice della riga.
      errors.push(`partLines[${i}].partReference (stringa obbligatoria, max ${MAX_STRING_LENGTH} caratteri)`);
    }
    // Quantità intera positiva.
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QUANTITY) {
      // Errore con indice della riga.
      errors.push(`partLines[${i}].quantity (intero 1..${MAX_QUANTITY})`);
    }
    // Riga normalizzata (i tag opzionali sono comunque inviati, anche vuoti: lo richiede l'XSD).
    return {
      // Riferimento ricambio.
      partReference: isNonEmptyString(l.partReference) ? l.partReference.trim() : '',
      // Quantità richiesta.
      quantity: l.quantity,
      // Riferimento del costruttore (opzionale).
      partReferenceManfacture: optionalString(l.partReferenceManfacture, `partLines[${i}].partReferenceManfacture`, errors),
      // Trigramma del costruttore (opzionale).
      triGramManfacture: optionalString(l.triGramManfacture, `partLines[${i}].triGramManfacture`, errors),
      // Id costruttore (opzionale).
      idManufacturer: optionalString(l.idManufacturer, `partLines[${i}].idManufacturer`, errors),
    };
  });

  // Errori presenti: 400 con l'elenco completo.
  if (errors.length > 0) {
    // Log dei soli nomi dei campi.
    console.error(`[getStockPrix] Input non valido: ${errors.join(', ')}`);
    // Errore applicativo.
    throw new WyzError(`Missing or invalid required field(s): ${errors.join(', ')}`, 400);
  }

  // Richiesta normalizzata.
  return {
    // Header DMS del cliente.
    customerDMSHeader: customerDMSHeader.trim(),
    // Dealer (da authorizer o payload).
    dealerId,
    // Paese in maiuscolo.
    country: input.country.trim().toUpperCase(),
    // Brand in maiuscolo.
    brand: input.brand.trim().toUpperCase(),
    // VIN in maiuscolo (o vuoto).
    vin: vin === '' ? '' : vin.trim().toUpperCase(),
    // Righe ricambio.
    partLines,
  };
}

/**
 * Costruisce la busta SOAP getStockPrixKBRW. L'ordine dei tag è vincolato dall'XSD del servizio.
 * @param {object} req - richiesta normalizzata
 * @param {string} clientApplicationName
 * @returns {string}
 */
function buildSoapEnvelope(req, clientApplicationName) {
  // Righe ricambio serializzate (tutti i tag sono obbligatori, anche se vuoti).
  const lines = req.partLines
    .map((l) => [
      '<stoc:partLineKBRW>',
      `<partReference>${escapeXml(l.partReference)}</partReference>`,
      `<quantity>${escapeXml(l.quantity)}</quantity>`,
      `<partReferenceManfacture>${escapeXml(l.partReferenceManfacture)}</partReferenceManfacture>`,
      `<triGramManfacture>${escapeXml(l.triGramManfacture)}</triGramManfacture>`,
      `<idManufacturer>${escapeXml(l.idManufacturer)}</idManufacturer>`,
      '</stoc:partLineKBRW>',
    ].join(''))
    .join('');

  // Busta completa.
  return [
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:stoc="${STOCKPRIX_NS}">`,
    '<soapenv:Header/>',
    '<soapenv:Body>',
    '<stoc:getStockPrixKBRW>',
    '<dealersInfoKBRW>',
    `<clientApplicationName>${escapeXml(clientApplicationName)}</clientApplicationName>`,
    `<customerDMSHeader>${escapeXml(req.customerDMSHeader)}</customerDMSHeader>`,
    `<dealerId>${escapeXml(req.dealerId)}</dealerId>`,
    `<country>${escapeXml(req.country)}</country>`,
    `<brand>${escapeXml(req.brand)}</brand>`,
    `<vin>${escapeXml(req.vin)}</vin>`,
    '</dealersInfoKBRW>',
    lines,
    '</stoc:getStockPrixKBRW>',
    '</soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('');
}

/**
 * Mappa un SOAP Fault in WyzError.
 *  - gateway IBM (SOAPFaultInfo, es. 401 credenziali/certificato) -> 502 (mai 401/403 al front-end)
 *  - dealer sconosciuto -> 404
 *  - faultcode Client (richiesta rifiutata dall'XSD) -> 422
 *  - altri fault -> 502
 * @param {object} fault - Body.Fault parsato
 * @param {number} upstreamStatus
 * @returns {WyzError}
 */
function mapFault(fault, upstreamStatus) {
  // Codice del fault (es. "S:Client", "soapenv:Server").
  const faultCode = String(fault.faultcode || '');
  // Descrizione del fault.
  const faultString = String(fault.faultstring || '');
  // Dettaglio (oggetto o stringa vuota).
  const detail = fault.detail && typeof fault.detail === 'object' ? fault.detail : {};

  // Fault generato dal gateway IBM API Connect (sicurezza, routing, rate limit).
  if (detail.SOAPFaultInfo) {
    // Status HTTP indicato dal gateway.
    const gatewayCode = detail.SOAPFaultInfo.httpCode;
    // Log dell'errore del gateway.
    console.error(`[getStockPrix] Fault del gateway IBM: httpCode=${gatewayCode}, faultstring=${faultString}`);
    // 502: problema di integrazione (credenziali, certificato, client_id), non dell'utente.
    return new WyzError('Il gateway StockPrixService ha rifiutato la richiesta', 502, {
      errorCode: 'GATEWAY_FAULT',
      upstreamStatus: Number(gatewayCode) || upstreamStatus,
    });
  }

  // Dealer non censito sul servizio.
  if (detail.UnknowDealerException !== undefined || /dealer id unknown/i.test(faultString)) {
    // Log dell'esito.
    console.error(`[getStockPrix] Dealer sconosciuto: ${faultString}`);
    // 404: risorsa (dealer) non trovata.
    return new WyzError('Dealer sconosciuto per StockPrixService', 404, { errorCode: 'UNKNOWN_DEALER', upstreamStatus });
  }

  // Richiesta rifiutata dal servizio per errore del client (validazione XSD).
  if (faultCode === 'Client' || faultCode.endsWith(':Client')) {
    // Log del dettaglio.
    console.error(`[getStockPrix] Fault Client: ${faultString}`);
    // 422: richiesta sintatticamente corretta ma non accettata dal servizio.
    return new WyzError('Richiesta rifiutata da StockPrixService', 422, {
      errorCode: 'INVALID_REQUEST',
      upstreamStatus,
      details: { faultString },
    });
  }

  // Altri fault lato server.
  console.error(`[getStockPrix] Fault Server: faultcode=${faultCode}, faultstring=${faultString}`);
  // 502: errore del servizio upstream.
  return new WyzError('Errore del servizio StockPrixService', 502, { errorCode: 'UPSTREAM_FAULT', upstreamStatus });
}

/**
 * Normalizza un elemento StockPrixKBRWDetails per il front-end (numeri tipizzati, nomi leggibili).
 * @param {object} d
 * @returns {object}
 */
function normalizeItem(d) {
  // Elemento non oggetto: valori nulli.
  const item = d && typeof d === 'object' ? d : {};
  // Forma esposta al front-end.
  return {
    // Riferimento ricambio.
    partReference: item.partReference || null,
    // Quantità a stock (inStockqt).
    inStockQuantity: toNumber(item.inStockqt),
    // Prezzo senza IVA (priceHT).
    priceHT: toNumber(item.priceHT),
    // Prezzo con IVA (priceTTC).
    priceTTC: toNumber(item.priceTTC),
    // Sconto percentuale (remise).
    discountPercent: toNumber(item.remise),
    // Stato di disponibilità DMS (statusOfAvailibilityDMS, es. DISPO/NON_DISPO).
    availabilityStatus: item.statusOfAvailibilityDMS || null,
    // Codice sconto panier.
    discountCodePanier: item.discountCodePanier || null,
  };
}

/**
 * Chiama StockPrixService e interpreta la risposta SOAP.
 * @param {string} xml - busta SOAP
 * @param {object} sp - config.stockPrix
 * @param {string} [correlationId]
 * @returns {Promise<object[]>} elementi StockPrixKBRWDetails grezzi
 * @throws {WyzError}
 */
async function callStockPrix(xml, sp, correlationId) {
  // Parsing della base URL configurata.
  let endpoint;
  try {
    // Base URL dell'ambiente corrente.
    endpoint = new URL(sp.baseUrl);
  } catch (err) {
    // Configurazione errata.
    console.error(`[getStockPrix] Base URL StockPrixService non valida: "${sp.baseUrl}"`);
    // 500: errore interno di configurazione.
    throw new WyzError('Configurazione StockPrixService non valida', 500);
  }

  // Agent mTLS (cert + key).
  let agent;
  try {
    // Agent dalla cache o costruito da Secrets Manager.
    agent = await getHttpsAgent({ extensionPort: sp.extensionPort });
  } catch (err) {
    // Log del motivo (nessun dato sensibile nei messaggi del certService).
    console.error(`[getStockPrix] Certificato client non disponibile: ${err.message}`);
    // 500: errore interno di configurazione.
    throw new WyzError('Certificato client per StockPrixService non disponibile', 500);
  }

  // Query string con il client_id IBM API Connect.
  const qs = new URLSearchParams({ client_id: sp.clientId }).toString();
  // Path completo della richiesta.
  const path = `${getStockPrixServicePath(endpoint.hostname)}?${qs}`;
  // Credenziali Basic Auth codificate.
  const basic = Buffer.from(`${sp.username}:${sp.password}`).toString('base64');

  // Opzioni della richiesta HTTPS.
  const options = {
    // Host del gateway.
    hostname: endpoint.hostname,
    // Porta (443 di default).
    port: endpoint.port || 443,
    // Path con query string.
    path,
    // Le operazioni SOAP sono sempre POST.
    method: 'POST',
    // Timeout socket.
    timeout: sp.timeoutMs,
    // Agent con certificato client per l'mTLS.
    agent,
    // Header HTTP (Authorization viene mascherato nei log da httpClient).
    headers: {
      // Corpo SOAP 1.1.
      'Content-Type': 'text/xml; charset=utf-8',
      // Risposta attesa in XML.
      Accept: 'text/xml',
      // Basic Auth richiesta dal servizio.
      Authorization: `Basic ${basic}`,
      // Lunghezza del corpo in byte.
      'Content-Length': Buffer.byteLength(xml),
      // Correlazione con i log della lambda.
      'X-Correlation-Id': correlationId,
    },
  };

  // Log della chiamata (senza client_id e credenziali).
  console.log(`[getStockPrix] POST ${endpoint.protocol}//${endpoint.hostname}${endpoint.pathname} (correlationId=${correlationId})`);

  // Risposta HTTP.
  let response;
  try {
    // Invio della busta SOAP.
    response = await httpsRequest(options, xml);
  } catch (err) {
    // Timeout della chiamata.
    if (/timeout/i.test(err.message)) {
      // Log del timeout.
      console.error(`[getStockPrix] Timeout dopo ${sp.timeoutMs}ms`);
      // 504: gateway timeout.
      throw new WyzError('Timeout nella chiamata a StockPrixService', 504);
    }
    // Errori di handshake TLS (es. SSLV3_ALERT_CERTIFICATE_UNKNOWN): certificato rifiutato o scaduto.
    if (/ssl|tls|certificate|alert/i.test(`${err.code || ''} ${err.message}`)) {
      // Log specifico per agevolare la diagnosi.
      console.error(`[getStockPrix] Handshake mTLS fallito (certificato client rifiutato?): ${err.code || ''} ${err.message}`);
      // Cache azzerata: alla prossima chiamata cert/key vengono riletti (es. dopo una rotazione).
      invalidateAgent();
      // 502: errore di integrazione.
      throw new WyzError('Handshake TLS con StockPrixService fallito', 502, { errorCode: 'TLS_HANDSHAKE_FAILED' });
    }
    // Altri errori di rete (DNS, connessione).
    console.error(`[getStockPrix] Errore di rete: ${err.code || ''} ${err.message}`);
    // 502: servizio non raggiungibile.
    throw new WyzError('Servizio StockPrixService non raggiungibile', 502);
  }

  // Corpo testuale (httpClient restituisce la stringa grezza se non è JSON).
  const raw = typeof response.body === 'string' ? response.body : '';
  // Busta parsata.
  let envelope;
  try {
    // Parsing XML (rifiuta corpi vuoti o non XML).
    const parsed = raw ? await xml2js.parseStringPromise(raw, XML_PARSER_OPTIONS) : null;
    // Elemento radice Envelope.
    envelope = parsed && parsed.Envelope;
  } catch (err) {
    // Corpo non XML.
    console.error(`[getStockPrix] Risposta non XML (HTTP ${response.statusCode}): ${err.message}`);
  }

  // Corpo SOAP.
  const body = envelope && envelope.Body && typeof envelope.Body === 'object' ? envelope.Body : null;
  // Risposta non SOAP (es. errore HTML/JSON del gateway).
  if (!body) {
    // Log dello status.
    console.error(`[getStockPrix] Risposta non SOAP da StockPrixService: HTTP ${response.statusCode}`);
    // 502: risposta upstream non valida.
    throw new WyzError(`Risposta non valida da StockPrixService (HTTP ${response.statusCode})`, 502, {
      upstreamStatus: response.statusCode,
    });
  }

  // SOAP Fault (tipicamente con HTTP 500).
  if (body.Fault) {
    // Conversione in errore applicativo.
    throw mapFault(body.Fault, response.statusCode);
  }

  // Status non 2xx senza Fault.
  if (response.statusCode < 200 || response.statusCode >= 300) {
    // Log dello status.
    console.error(`[getStockPrix] HTTP ${response.statusCode} senza SOAP Fault`);
    // 502: errore upstream.
    throw new WyzError(`StockPrixService ha risposto con HTTP ${response.statusCode}`, 502, { upstreamStatus: response.statusCode });
  }

  // Elemento di risposta dell'operazione.
  const opResponse = body.getStockPrixKBRWResponse;
  // Risposta priva dell'elemento atteso.
  if (opResponse === undefined) {
    // Log dell'anomalia.
    console.error('[getStockPrix] Risposta priva di getStockPrixKBRWResponse');
    // 502: risposta upstream non valida.
    throw new WyzError('Risposta non valida da StockPrixService', 502);
  }

  // Dettagli per riga (singolo oggetto, array o assenti).
  return asArray(opResponse && opResponse.StockPrixKBRWDetails);
}

/**
 * Azione getStockPrix — stock e prezzi dei ricambi indicati per il dealer.
 * @param {object} params - payload del front-end
 *   { customerDMSHeader, country, brand, dealerId, vin?,
 *     partLines: [{ partReference, quantity, partReferenceManfacture?, triGramManfacture?, idManufacturer? }] }
 * @param {{correlationId?: string}} [ctx]
 * @returns {Promise<{items: object[]}>}
 * @throws {WyzError}
 */
async function getStockPrix(params, ctx = {}) {
  // Payload normalizzato a oggetto.
  const input = params && typeof params === 'object' ? params : {};
  // Dealer richiesto dal payload del client.
  const dealerId = resolveDealerId(input);
  // Validazione e normalizzazione dell'input.
  const req = validateInput(input, dealerId);
  // Log di avvio (nessun dato sensibile).
  console.log(`[getStockPrix] Avvio: dealerId=${req.dealerId}, brand=${req.brand}, country=${req.country}, righe=${req.partLines.length}`);

  // Configurazione (URL per ambiente e credenziali dal secret wyz).
  const config = await getConfig();
  // Sezione StockPrixService.
  const sp = config.stockPrix;
  // Chiavi obbligatorie del secret per questa azione.
  const missing = [
    ['STOCKPRIX_USERNAME', sp.username],
    ['STOCKPRIX_PASSWORD', sp.password],
    ['STOCKPRIX_CLIENT_ID', sp.clientId],
    ['WYZ_STOCKPRIX_BASE_URL', sp.baseUrl],
  ].filter(([, v]) => !isNonEmptyString(v)).map(([k]) => k);
  // Secret incompleto: errore interno di configurazione.
  if (missing.length > 0) {
    // Log dei soli nomi delle chiavi mancanti.
    console.error(`[getStockPrix] Chiavi mancanti nel secret wyz: ${missing.join(', ')}`);
    // 500: configurazione incompleta.
    throw new WyzError('Configurazione StockPrixService incompleta', 500);
  }

  // Busta SOAP della richiesta.
  const xml = buildSoapEnvelope(req, sp.clientApplicationName);
  // Chiamata al servizio.
  const details = await callStockPrix(xml, sp, ctx.correlationId);
  // Normalizzazione per il front-end.
  const items = details.map(normalizeItem);
  // Log dell'esito.
  console.log(`[getStockPrix] Completato: ${items.length} righe restituite`);
  // Contenuto di "data" nella risposta della lambda.
  return { items };
}

// API pubblica (funzioni interne esportate per i test unitari).
module.exports = { getStockPrix, buildSoapEnvelope, escapeXml, mapFault, normalizeItem, validateInput, resolveDealerId };
