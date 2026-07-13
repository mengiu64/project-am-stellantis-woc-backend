'use strict';

require('dotenv').config();
const axios  = require('axios');
const xml2js = require('xml2js');
const https  = require('https');

// ─── Configurazione (da .env) ──────────────────────────────────────────────────
const MENUPRICING_WSDL    = process.env.MENUPRICING_WSDL;   // base URL senza /Menus o /SecuredMenus
const MENUPRICING_USR     = process.env.MENUPRICING_USR;    // credenziali WS-Security (applicazione)
const MENUPRICING_PWS     = process.env.MENUPRICING_PWS;
const MENUPRICING_USR_REQ = process.env.MENUPRICING_USR_REQ; // credenziali nel body della richiesta
const MENUPRICING_PWS_REQ = process.env.MENUPRICING_PWS_REQ;

// getJobs   → /Menus          (servizio pubblico)
// getJobDetails → /SecuredMenus  (servizio autenticato)
const URL_MENUS   = `${MENUPRICING_WSDL}/Menus`;
const URL_SECURED = `${MENUPRICING_WSDL}/SecuredMenus`;

const NS_MENUS   = 'http://www.cliffordthames.com/ebusiness/menus/';
const NS_WSSE    = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
const NS_SOAP    = 'http://schemas.xmlsoap.org/soap/envelope/';
const TIMEOUT_MS = 30_000;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ═══════════════════════════════════════════════════════════════════════════════
// Builders XML
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converte un oggetto JS nell'XML interno del body, replicando array2xml PHP:
 *   - stringhe primitive → attributi XML
 *   - vinMatch           → elemento figlio
 *   - pocFilter          → elemento figlio con attributo value
 *   - oggetti/array      → elementi figli ricorsivi
 */
function array2xml(obj, tagName) {
  let attrs  = '';
  let children = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'object') {
      children += array2xml(value, key);
    } else if (key === 'vinMatch') {
      children += `<vinMatch>${escapeXml(String(value))}</vinMatch>`;
    } else if (key === 'pocFilter') {
      children += `<pocFilter value="${escapeXml(String(value))}"/>`;
    } else {
      attrs += ` ${key}="${escapeXml(String(value))}"`;
    }
  }

  if (children) {
    return `<${tagName}${attrs}>${children}</${tagName}>`;
  }
  return `<${tagName}${attrs}/>`;
}

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Costruisce l'header WS-Security (replica soapClientWSSecurityHeader PHP)
 */
function buildWsSecurityHeader(user, password) {
  return (
    `<soap:Header>` +
      `<wsse:Security xmlns:wsse="${NS_WSSE}">` +
        `<wsse:UsernameToken>` +
          `<wsse:Username>${escapeXml(user)}</wsse:Username>` +
          `<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</wsse:Password>` +
        `</wsse:UsernameToken>` +
      `</wsse:Security>` +
    `</soap:Header>`
  );
}

/**
 * Assembla l'intera SOAP envelope (replica buildRequest PHP)
 */
function buildRequest(params, method) {
  // Primo livello = nome metodo (es: 'getJobs' o 'getJobDetails')
  const innerKey   = Object.keys(params[method])[0]; // 'jobsRequest' o 'jobDetailsRequest'
  const innerValue = params[method][innerKey];

  // Costruisce il body XML con il namespace del servizio
  const bodyContent = (
    `<${method} xmlns="${NS_MENUS}">` +
      array2xml(innerValue, innerKey) +
    `</${method}>`
  );

  const header = buildWsSecurityHeader(MENUPRICING_USR, MENUPRICING_PWS);

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="${NS_SOAP}"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"` +
    ` xmlns:wsse="${NS_WSSE}">` +
      header +
      `<soap:Body>` +
        bodyContent +
      `</soap:Body>` +
    `</soap:Envelope>`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parsing risposta
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Replica il comportamento PHP:
 *   preg_replace("/(<\/?)(\w+):([^>]*>)/", '$1$2$3', $res)
 * Trasforma i tag con prefisso ns (es: soap:Body → soapBody)
 * poi estrae il contenuto di soapBody.
 *
 * mergeAttrs:true → attributi XML accessibili direttamente come chiavi
 *                   (come fa PHP SimpleXML), senza passare per obj.$
 */
async function parseResponse(xmlStr) {
  const stripped = xmlStr.replace(/(<\/?)([\w]+):([\s\S]*?>)/g, '$1$2$3');

  const parsed = await xml2js.parseStringPromise(stripped, {
    explicitArray: false,
    explicitRoot:  false,
    mergeAttrs:    true,   // attributi come proprietà dirette, non sotto '$'
  });

  const soapBody = parsed?.soapBody ?? parsed?.Body;
  return soapBody ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chiamata HTTP
// ═══════════════════════════════════════════════════════════════════════════════

async function callMethodJob(params, method, endpointUrl) {
  const soapEnvelope = buildRequest(params, method);

  if (process.env.DEBUG_SOAP) {
    console.log('\n[DEBUG] Request XML:\n', soapEnvelope);
  }

  let rawData;
  try {
    const response = await axios.post(endpointUrl, soapEnvelope, {
      httpsAgent,
      timeout: TIMEOUT_MS,
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction':   `"${method}"`,
      },
      // Accetta anche status >= 400 per poter leggere il body del SOAP fault
      validateStatus: () => true,
    });
    rawData = response.data;
  } catch (err) {
    // Errori di rete (ETIMEDOUT, ECONNREFUSED, ecc.)
    throw new Error(`Errore di rete MenuPricing (${method}): ${err.message}`);
  }

  if (process.env.DEBUG_SOAP) {
    console.log('\n[DEBUG] Raw Response:\n', rawData);
  }

  if (!rawData || typeof rawData !== 'string') {
    throw new Error(`Risposta non valida da MenuPricing (${method}): body vuoto o non-XML`);
  }

  const body = await parseResponse(rawData);
  return body;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Classe MenuPricingSoapClient
// ═══════════════════════════════════════════════════════════════════════════════

class MenuPricingSoapClient {

  // ── getJobs ─────────────────────────────────────────────────────────────────
  // Endpoint: /Menus  — lista piatta codice/descrizione dei job disponibili per il VIN
  // Il chiamante deve passare vin, dealerIdentificationCode, countryCode; languageCode
  // e manufacturer sono opzionali e, se assenti, vengono risolti da MP_LANGUAGE_CODE/
  // MP_MANUFACTURER (env).
  async getJobs({ vin, dealerIdentificationCode, countryCode, languageCode, manufacturer }) {
    languageCode = languageCode ?? process.env.MP_LANGUAGE_CODE;
    manufacturer = manufacturer ?? process.env.MP_MANUFACTURER;
    console.log('[MenuPricingSoapClient.getJobs] parametri chiamata:', { vin, dealerIdentificationCode, countryCode, languageCode, manufacturer });
    const params = {
      getJobs: {
        jobsRequest: {
          dealerDetails: {
            vehicleFileID:            '0',
            user:                     MENUPRICING_USR_REQ,
            password:                 MENUPRICING_PWS_REQ,
            manufacturer,
            languageCode,
            dealerIdentificationCode,
            countryCode,
          },
          vehicleMatch: { vinMatch: vin },
          pocFilter:    true,
        },
      },
    };

    const body = await callMethodJob(params, 'getJobs', URL_MENUS);
    return elaborateGetJobs(body);
  }

  // ── getJobDetails ────────────────────────────────────────────────────────────
  // Endpoint: /SecuredMenus  — dettaglio operazioni e ricambi di un job
  // Il chiamante deve passare vin, dealerIdentificationCode, countryCode, id;
  // languageCode e manufacturer sono opzionali e, se assenti, vengono risolti da
  // MP_LANGUAGE_CODE/MP_MANUFACTURER (env).
  async getJobDetails({ vin, dealerIdentificationCode, countryCode, id, languageCode, manufacturer }) {
    languageCode = languageCode ?? process.env.MP_LANGUAGE_CODE;
    manufacturer = manufacturer ?? process.env.MP_MANUFACTURER;
    console.log('[MenuPricingSoapClient.getJobDetails] parametri chiamata:', { vin, dealerIdentificationCode, countryCode, id, languageCode, manufacturer });
    const params = {
      getJobDetails: {
        jobDetailsRequest: {
          dealerDetails: {
            vehicleFileID:            '0',
            user:                     MENUPRICING_USR_REQ,
            password:                 MENUPRICING_PWS_REQ,
            manufacturer,
            languageCode,
            dealerIdentificationCode,
            countryCode,
          },
          job: {
            core:          'true',
            description:   '',
            id,
            jobDifficulty: '1',
            jobSource:     'NSC',
            service:       'true',
          },
          vehicleMatch: { vinMatch: vin },
        },
      },
    };

    const body = await callMethodJob(params, 'getJobDetails', URL_SECURED);
    return elaborateGetJobDetails(body);
  }

  // ── getCompletePkMpList ──────────────────────────────────────────────────────
  // Recupera la lista completa dei pacchetti MenuPricing per un VIN,
  // indicizzata per codice: { [codice]: { codice, descrizione } }.
  // Corrisponde a JOBCXPAjaxController::getCompletePkMpList (PHP).
  // Restituisce { success, data: { [codice]: row } | null, message }
  async getCompletePkMpList({ vin, languageCode, countryCode, dealerIdentificationCode, manufacturer }) {
    const res = await this.getJobs({ vin, languageCode, countryCode, dealerIdentificationCode, manufacturer });

    if (!res.success) {
      return { success: false, data: null, message: res.message };
    }

    return { success: true, data: res.data ?? null, message: '' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Elaborazione risposta
// ═══════════════════════════════════════════════════════════════════════════════

function elaborateGetJobs(body) {
  const resp = body?.getJobsResponse?.jobsResponse ?? body?.getJobsResponse;
  if (!resp) return { success: false, data: null, message: 'No getJobsResponse found' };

  // Con mergeAttrs:true, description è una proprietà diretta di status
  const descr = resp?.status?.description;
  if (descr !== 'OK') {
    return { success: false, data: null, message: descr ?? 'Unknown error' };
  }

  const opArr = toArray(resp?.jobHierarchy?.operation);
  const flat  = recursiveParsing(opArr);

  // Indicizza per codice (come PHP: $pklistComplete[$row['codice']] = $row)
  const indexed = {};
  for (const row of flat) {
    if (row.codice && row.descrizione !== undefined) {
      indexed[row.codice] = row;
    }
  }

  return { success: true, data: indexed, message: '' };
}

function elaborateGetJobDetails(body) {
  const resp = body?.getJobDetailsResponse?.jobDetailsResponse ?? body?.getJobDetailsResponse;
  if (!resp) return { success: false, data: null, message: 'No getJobDetailsResponse found' };

  // Con mergeAttrs:true, description/state sono proprietà dirette di status
  const descr = resp?.status?.description;
  if (descr !== 'OK') {
    const state   = resp?.status?.state ?? '';
    const version = resp?.status?.vehicleFileVersion ?? '';
    return {
      success: false,
      data:    null,
      message: `Errore getting Menupricing.getJobDetails ${descr} ${state} ${version}`.trim(),
    };
  }

  const job = resp?.job;
  if (!job) return { success: false, data: null, message: 'No job in response' };

  const jobArr = toArray(job);
  const parsed = parseJobDetailResult(jobArr);
  return { success: true, data: parsed, message: '' };
}

// ─── toArray: normalizza a array singolo/multiplo ─────────────────────────────
function toArray(val) {
  if (val === null || val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

// ─── recursiveParsing ─────────────────────────────────────────────────────────
// Naviga la gerarchia operation/job e restituisce array piatto { codice, descrizione }
// Con mergeAttrs:true, description e id sono proprietà dirette dell'oggetto
function recursiveParsing(opArr, res = []) {
  for (const op of toArray(opArr)) {
    if (op.job !== undefined) {
      // foglia: l'operation contiene uno o più job
      for (const job of toArray(op.job)) {
        res.push({
          codice:     job.id,
          descrizione: op.description ?? job.description ?? '',
        });
      }
    } else if (op.operation !== undefined) {
      // nodo intermedio: ricorsione
      recursiveParsing(op.operation, res);
    }
    // operation senza job e senza operation figli → ignorata (nessun pacchetto)
  }
  return res;
}

// ─── parseJobDetailResult ─────────────────────────────────────────────────────
function parseJobDetailResult(jobArr) {
  // Con mergeAttrs:true tutti gli attributi XML (jobSource, id, ecc.) sono proprietà dirette

  // Prende il job con jobSource == 'MAN' se presente
  let filtered = jobArr.filter(r => r?.jobSource === 'MAN');
  if (!filtered.length) filtered = jobArr;

  const returnArray = {};

  for (const row of filtered) {
    returnArray.codice      = row.id;
    returnArray.descrizione = row.description;

    // Prezzo fisso (promozione Lex)
    let pkPrice = 0;
    let isFixedPrice = '0';
    if (row.promotion) {
      for (const p of toArray(row.promotion)) {
        if (p.description === 'Lex') {
          pkPrice      = p.priceExcl;
          isFixedPrice = '1';
        }
      }
    }
    returnArray.pkPrice      = pkPrice;
    returnArray.isFixedPrice = isFixedPrice;

    // Operazioni (labours)
    const labours = toArray(row?.labours?.labour);
    returnArray.listaOperazioni = labours.map(l => ({
      TYPE:        'OP',
      POSIZIONE:   '!' + Math.floor(Math.random() * 1e9),
      COD:         l.id,
      DESCR:       l.description,
      TIME:        l.asDTUs,
      QTY:         '',
      AV_LOCAL:    0,
      AV_DISTRIGO: 0,
      AV_CENTRAL:  0,
      SCONTO:      0,
      PRICE:       '',
      SELECTED:    true,
    }));

    // Ricambi (partsList)
    const parts = toArray(row?.partsList?.part);
    returnArray.listaRicambi = parts.map(p => {
      const pos = (!p.altPartNumber || p.altPartNumber === '000000')
        ? '!' + Math.floor(Math.random() * 1e9)
        : p.altPartNumber;
      return {
        TYPE:        'SP',
        POSIZIONE:   pos,
        COD:         p.partNumber,
        DESCR:       p.partDescription,
        TIME:        '',
        QTY:         p.quantity,
        AV_LOCAL:    0,
        AV_DISTRIGO: 0,
        AV_CENTRAL:  0,
        SCONTO:      0,
        PRICE:       p.priceExcl,
        SELECTED:    true,
      };
    });
  }

  return returnArray;
}

module.exports = { MenuPricingSoapClient };
