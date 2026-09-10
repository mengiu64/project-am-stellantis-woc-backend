'use strict';

const path = require('path');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

// Retry con backoff per getDmlConfiguration (getCompanyTypes/getCustomerTitles):
// codici HTTP considerati transitori/riprovabili (errori del gateway API, non del
// client), numero massimo di tentativi (1 iniziale + 2 retry) e delay base tra un
// tentativo e il successivo (moltiplicato per il numero del tentativo, per un
// backoff lineare 300ms/600ms).
const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const DML_CONFIG_MAX_ATTEMPTS = 3;
const DML_CONFIG_RETRY_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls GET /dms/settings endpoint.
 *
 * @param {string} bearerToken  - Bearer token from PingFederate
 * @param {object} params
 * @param {string}   params.country  - (Mandatory) Country code (e.g. "fr")
 * @param {string}   params.brand    - (Mandatory) Brand code (e.g. "FT")
 * @param {string}   params.dealer   - (Mandatory) Dealer identifier (e.g. "0062230")
 * @returns {Promise<object>} parsed response body
 */
async function getDmsSettings(bearerToken, params = {}) {
  const { country, brand, dealer } = params;

  if (!country) throw new Error('[dms] country is required');
  if (!brand)   throw new Error('[dms] brand is required');
  if (!dealer)  throw new Error('[dms] dealer is required');

  const base = new URL(config.dml.baseUrl);
  const qs = new URLSearchParams({ country, brand, dealer }).toString();
  const fullPath = `${config.dml.settingsPath}?${qs}`;

  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: fullPath,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'X-IBM-Client-Id': config.dml.ibmClientId,
      'X-IBM-Client-Secret': config.dml.ibmClientSecret,
      'X-Target-Env': config.dml.xTargetEnv,
    },
  };

  console.log(`[dms] GET https://${base.hostname}${fullPath}`);
  const response = await httpsRequest(options);

  // AGGIUNTO il blocco:
  if (response.statusCode === 404) {
    console.log(`[dms] settings not available (404) for ${qs} — isdml will be false`);
    return { success: false, data: [] };
  }

  if (response.statusCode !== 200) {
    throw new Error(
      `[dms] settings failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * Helper interno condiviso da getCompanyTypes/getCustomerTitles: entrambe le API
 * "configurations" del gateway DML condividono lo stesso contratto (query string
 * country+language, stessi header di autenticazione/credenziali di getDmsSettings)
 * e differiscono solo per il path.
 *
 * Come getDmsSettings, un 404 ("nessun dato per questi parametri", es.
 * `{"success":false,"message":"No company types found for the given parameters"}`)
 * NON viene trattato come errore bloccante: si restituisce `{ success: false, data: [] }`
 * cosi' il chiamante (es. session/MyPeopleDmsSessionRepository) riceve sempre un array,
 * anche vuoto, invece di un'eccezione che romperebbe l'intera risposta.
 *
 * @param {string} bearerToken  - ****** from PingFederate
 * @param {object} params
 * @param {string}   params.country  - (Mandatory) Country code (e.g. "FR")
 * @param {string}   params.language - (Mandatory) Language code (e.g. "fr")
 * @param {string} path  - config.dml.companyTypesPath / config.dml.customerTitlesPath
 * @param {string} label - usato solo nel messaggio di errore (es. "company-types")
 * @returns {Promise<object>} parsed response body
 */
async function getDmlConfiguration(bearerToken, params = {}, path, label) {
  const { country, language } = params;

  if (!country)  throw new Error('[dms] country is required');
  if (!language) throw new Error('[dms] language is required');

  const base = new URL(config.dml.baseUrl);
  const qs = new URLSearchParams({ country, language }).toString();
  const fullPath = `${path}?${qs}`;

  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: fullPath,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'X-IBM-Client-Id': config.dml.ibmClientId,
      'X-IBM-Client-Secret': config.dml.ibmClientSecret,
      'X-Target-Env': config.dml.xTargetEnv,
    },
  };

  console.log(`[dms] GET https://${base.hostname}${fullPath}`);

  // Retry con backoff sui soli errori transitori (502/503/504): il gateway DML
  // Stellantis a monte ha occasionalmente restituito 502 "Internal server error"
  // (osservato durante la sync giornaliera schedulata delle 03:00 UTC), risoltosi
  // da solo pochi minuti/ore dopo. Un breve retry evita di dover aspettare il
  // giorno successivo (o un retrigger manuale) per un errore puramente transitorio
  // lato Stellantis, senza mascherare errori reali (4xx, 500 non transitorio, ecc.).
  let response;
  for (let attempt = 1; attempt <= DML_CONFIG_MAX_ATTEMPTS; attempt += 1) {
    response = await httpsRequest(options);

    if (!TRANSIENT_STATUS_CODES.has(response.statusCode) || attempt === DML_CONFIG_MAX_ATTEMPTS) {
      break;
    }

    console.warn(
      `[dms] ${label} tentativo ${attempt}/${DML_CONFIG_MAX_ATTEMPTS} fallito con HTTP ${response.statusCode}, retry tra ${DML_CONFIG_RETRY_DELAY_MS * attempt}ms...`
    );
    await sleep(DML_CONFIG_RETRY_DELAY_MS * attempt);
  }

  // Come getDmsSettings: un 404 significa "nessun dato per questi parametri"
  // (non un errore bloccante) — si restituisce un array vuoto invece di lanciare.
  if (response.statusCode === 404) {
    console.log(`[dms] ${label} not available (404) for ${qs} — restituito data: []`);
    return { success: false, data: [] };
  }

  if (response.statusCode !== 200) {
    throw new Error(
      `[dms] ${label} failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * Calls GET /configurations/company-types endpoint.
 *
 * @param {string} bearerToken  - ****** from PingFederate
 * @param {object} params
 * @param {string}   params.country  - (Mandatory) Country code (e.g. "FR")
 * @param {string}   params.language - (Mandatory) Language code (e.g. "fr")
 * @returns {Promise<object>} parsed response body
 */
async function getCompanyTypes(bearerToken, params = {}) {
  return getDmlConfiguration(bearerToken, params, config.dml.companyTypesPath, 'company-types');
}

/**
 * Calls GET /configurations/customer-titles endpoint.
 *
 * @param {string} bearerToken  - ****** from PingFederate
 * @param {object} params
 * @param {string}   params.country  - (Mandatory) Country code (e.g. "fr")
 * @param {string}   params.language - (Mandatory) Language code (e.g. "fr")
 * @returns {Promise<object>} parsed response body
 */
async function getCustomerTitles(bearerToken, params = {}) {
  return getDmlConfiguration(bearerToken, params, config.dml.customerTitlesPath, 'customer-titles');
}

const VALID_INQUIRY_TYPES = ['LFP', 'WL', 'MP'];

// Sezione tipo-specifica attesa nel body per ciascun MessageType — usata per
// validare che il chiamante non stia mescolando strutture di tipi diversi
// (es. MessageType 'WL' con SpareParts invece di WorkLines).
const TYPE_SECTION_KEYS = { LFP: 'UpSelling', WL: 'WorkLines', MP: 'SpareParts' };
const ALL_SECTION_KEYS = Object.values(TYPE_SECTION_KEYS);

/**
 * Valida che il body contenga la sezione tipo-specifica corretta per il
 * MessageType dichiarato (e nessun'altra): come per ApplicationArea, anche
 * questa parte del contratto è di responsabilità della lambda dms e non va
 * lasciata all'iniziativa di chi la invoca.
 *
 * @param {object} body
 * @param {'LFP'|'WL'|'MP'} messageType
 */
function validateTypeSection(body, messageType) {
  const expectedKey = TYPE_SECTION_KEYS[messageType];

  if (!(expectedKey in body)) {
    throw new Error(`[dms] MessageType ${messageType} requires body.${expectedKey}`);
  }

  const unexpectedKeys = ALL_SECTION_KEYS.filter((key) => key !== expectedKey && key in body);
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `[dms] MessageType ${messageType} must not include: ${unexpectedKeys.join(', ')}`
    );
  }
}

/**
 * Builds the ApplicationArea envelope (Sender + CreationDateTime + BODID).
 *
 * This used to be built by every caller of postDmsInquiry (CLI positional mode,
 * PkManager.getPriceAndAvailability, ...), each duplicating the Sender mapping
 * and generating its own BODID/CreationDateTime. It is now centralised here so
 * the DMS lambda owns the request envelope instead of delegating it to whoever
 * invokes the lambda: callers only need to provide the business payload
 * (PartsInquiryHeader + type-specific section).
 *
 * Il Sender NON è più statico: `config.sender` (variabili d'ambiente) resta il
 * fallback per i campi non forniti (uso da CLI/replay file), ma il chiamante
 * (jobcard/jobCardService.js, PkManager.getPriceAndAvailability,
 * pkFavorite/index.js, ...) può sovrascrivere per-request uno o più campi
 * passando `senderOverrides` — così il Sender riflette il dealer effettivo
 * che ha originato la inquiry invece di un unico dealer fisso configurato via
 * env.
 *
 * physicalSiteId/dealerNumberIdSource dinamici: centralizzati QUI (non più
 * duplicati in ogni chiamante) tramite lookup su woc.ang_snowflakes
 * (dbManager/AnagSnowflakesRepository.js::getPhysicalSiteAndSincom). Stesso
 * meccanismo e stessi criteri per QUALSIASI chiamante di postDmsInquiry:
 * quando senderOverrides fornisce dealerNumberId (mainSincom) + market
 * (usato solo come chiave di lookup, non è un campo Sender e non viene
 * inviato al DML) + brand, si risolvono physicalSiteId/dealerNumberIdSource
 * da DB, sovrascrivendo eventuali valori già presenti in senderOverrides o in
 * config.sender. Il lookup è best-effort: se manca uno dei tre dati, o la
 * query fallisce per qualunque motivo, si ricade sui valori già disponibili
 * (senderOverrides espliciti, poi config.sender) — un problema di
 * arricchimento del Sender non deve mai bloccare la chiamata al gateway DML.
 *
 * @param {object} [senderOverrides] - Sottoinsieme di config.sender da
 *                     sovrascrivere per questa richiesta (stessi nomi campo:
 *                     componentId, dealerNumberId, dealerNumberIdSource,
 *                     dealerCountryCode, languageCode, physicalSiteId,
 *                     serviceId, currencyId, brand), più `market` (solo chiave
 *                     di lookup woc.ang_snowflakes, mai inviato al DML).
 *                     Valori undefined/null vengono ignorati (resta il
 *                     default di config.sender).
 * @returns {Promise<object>} ApplicationArea
 */
async function buildApplicationArea(senderOverrides = {}) {
  const s = { ...config.sender };
  for (const [key, value] of Object.entries(senderOverrides || {})) {
    if (value !== undefined && value !== null) s[key] = value;
  }

  // Il lookup scatta solo quando il CHIAMANTE fornisce esplicitamente
  // dealerNumberId/market/brand (non quando restano i default statici di
  // config.sender, che non rappresentano il dealer reale della richiesta) —
  // stesso criterio già applicato dalle implementazioni precedenti in
  // jobcard/pkManager (dove il controllo era sui dati locali, non su un
  // eventuale default env-based).
  const { dealerNumberId, market, brand } = senderOverrides || {};
  if (dealerNumberId && market && brand) {
    try {
      const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
      const { getPhysicalSiteAndSincom } = require(path.resolve(__dirname, '../dbManager/AnagSnowflakesRepository'));
      const pool = await getPool();
      const { physicalSiteId, dealerNumberIdSource } = await getPhysicalSiteAndSincom(pool, {
        mainSincom: dealerNumberId,
        market,
        brand,
      });
      if (physicalSiteId) s.physicalSiteId = physicalSiteId;
      if (dealerNumberIdSource) s.dealerNumberIdSource = dealerNumberIdSource;
    } catch (err) {
      console.warn(`[dms] impossibile risolvere physicalSiteId/dealerNumberIdSource (woc.ang_snowflakes) per mainSincom="${dealerNumberId}" market="${market}" brand="${brand}": ${err.message}`);
    }
  }

  return {
    Sender: {
      ComponentID: s.componentId,
      DealerNumberID: s.dealerNumberId,
      DealerNumberIDSource: s.dealerNumberIdSource,
      DealerCountryCode: s.dealerCountryCode,
      LanguageCode: s.languageCode,
      PhysicalSiteID: s.physicalSiteId,
      ServiceID: s.serviceId,
      CurrencyID: s.currencyId,
      Brand: s.brand,
    },
    CreationDateTime: new Date().toISOString(),
    BODID: randomUUID(),
  };
}

/**
 * Builds the UpSelling.Packages section (MessageType LFP) from a plain array
 * of package identifiers (code or name — la ricerca lato DML avviene per
 * entrambi). Il chiamante non deve conoscere lo schema DML (Packages
 * come array di oggetti { Code }): passa solo gli identificativi di dominio
 * e la lambda costruisce la struttura, esattamente come già avviene per
 * ApplicationArea.
 *
 * @param {string[]} packages - e.g. ['ABC', 'DEF'] (codice o nome pacchetto)
 * @returns {{ Packages: Array<{ Code: string }> }}
 */
function buildUpSellingPackages(packages = []) {
  return { Packages: packages.map((pkg) => ({ Code: pkg })) };
}

/**
 * Builds the WorkLines section (MessageType WL) from a simplified array of
 * work lines. Il chiamante non deve costruire a mano gli oggetti nidificati
 * PartsItem/LaborItem (con PartType/PartStatus/LaborType, dettagli dello
 * schema DML): passa solo, per ciascuna riga, il riferimento e gli elenchi di
 * codici (partNumbers/laborOperationIds), e la lambda costruisce la
 * struttura completa — stessa logica già usata da PkManager, ora centralizzata
 * qui.
 *
 * @param {Array<{
 *   workLineReference: string,
 *   partNumbers?: string[],
 *   laborOperationIds?: string[],
 *   transactionType?: number,
 *   customerAccountDmsId?: string|null,
 * }>} workLines
 * @param {string|null} [customerAccountDmsId] - Valore di default applicato a
 *                        ogni riga che non lo sovrascrive esplicitamente
 *                        (tipicamente è un unico valore ripetuto su tutte le
 *                        WorkLines della richiesta).
 * @returns {Array<object>} WorkLines nel formato atteso dal DML
 */
function buildWorkLines(workLines = [], customerAccountDmsId = null) {
  return workLines.map((wl, idx) => {
    if (!wl || !wl.workLineReference) {
      throw new Error(`[dms] workLines[${idx}].workLineReference is required`);
    }

    return {
      CustomerAccountDMSID: wl.customerAccountDmsId ?? customerAccountDmsId,
      WorkLineReference: wl.workLineReference,
      TransactionType: wl.transactionType ?? 1,
      PartsItem: (wl.partNumbers || []).map((partNumber) => ({
        PartNumber: partNumber,
        PartType: 'L',
        PartStatus: 'O',
      })),
      LaborItem: (wl.laborOperationIds || []).map((laborOperationId) => ({
        LaborOperationID: laborOperationId,
        LaborType: 'L',
      })),
    };
  });
}

/**
 * Calls POST /inquiry/DML/1.0/inquiry endpoint.
 *
 * @param {string} bearerToken - Bearer token from PingFederate
 * @param {object} body        - InquiryRequest payload (per DML_inquiry_V_4.2.yml)
 * @param {object}   [body.ApplicationArea] - Optional; built internally via
 *                     buildApplicationArea() when omitted, using config.sender
 *                     (eventualmente sovrascritto da body.sender, vedi sotto)
 *                     and a freshly generated BODID/CreationDateTime. Provide it
 *                     only when replaying a pre-built request (e.g. from file).
 * @param {object}   [body.sender] - Shortcut: sottoinsieme di config.sender da
 *                     sovrascrivere per-request (stessi nomi campo: dealerNumberId,
 *                     dealerNumberIdSource, dealerCountryCode, languageCode,
 *                     physicalSiteId, serviceId, currencyId, brand, componentId),
 *                     più `market` (solo chiave di lookup, non un campo Sender).
 *                     Usato per costruire un ApplicationArea.Sender dinamico (dealer/
 *                     brand/mercato reale della richiesta, es. da jobcard/jobCardService.js,
 *                     PkManager.wsConfig, pkFavorite/index.js) invece dei soli default
 *                     statici da env — quando dealerNumberId+market+brand sono presenti,
 *                     physicalSiteId/dealerNumberIdSource vengono risolti dinamicamente
 *                     da woc.ang_snowflakes (vedi buildApplicationArea()), stesso
 *                     meccanismo e stessi criteri per qualunque chiamante. Ignorato
 *                     quando body.ApplicationArea è già fornito. Not sent as-is.
 * @param {object}   [body.PartsInquiryHeader] - Optional; built internally from the
 *                     flat root-level fields below (DocumentID/CustomerIdDms/
 *                     MessageType/VehicleID) when omitted. If provided, it always
 *                     takes precedence over the flat fields.
 * @param {string|null} [body.PartsInquiryHeader.DocumentID] - Non obbligatorio come
 *                     contenuto (può essere sconosciuto, es. LFP prima che l'ordine di
 *                     riparazione esista): se omesso/null/undefined viene comunque
 *                     inviato al DML come stringa vuota `''` (la chiave deve sempre
 *                     essere presente nel payload).
 * @param {string|null} [body.PartsInquiryHeader.CustomerIdDms] - Non obbligatorio come
 *                     contenuto (può essere sconosciuto): se omesso/null/undefined viene
 *                     comunque inviato al DML come `null` (la chiave deve sempre essere
 *                     presente nel payload).
 * @param {'LFP'|'WL'|'MP'} body.PartsInquiryHeader.MessageType
 * @param {string}     body.PartsInquiryHeader.VehicleID
 * @param {string|null} [body.DocumentID]    - Shortcut: same as PartsInquiryHeader.DocumentID
 *                     (non obbligatorio, default '' se assente), used when
 *                     PartsInquiryHeader is not already provided.
 * @param {string|null} [body.CustomerIdDms] - Shortcut: same as PartsInquiryHeader.CustomerIdDms
 *                     (non obbligatorio, default null se assente).
 * @param {'LFP'|'WL'|'MP'} [body.MessageType] - Shortcut: same as PartsInquiryHeader.MessageType.
 * @param {string}   [body.VehicleID]     - Shortcut: same as PartsInquiryHeader.VehicleID.
 * @param {object}   [body.UpSelling]     - Required (and exclusive) when MessageType is LFP.
 *                     Built internally from body.package when omitted.
 * @param {string|string[]} [body.package] - Shortcut for LFP: package identifier(s) —
 *                     codice o nome (la ricerca lato DML avviene per entrambi) — come
 *                     singola stringa (es. 'ABC') o array (es. ['ABC', 'DEF']), usato
 *                     per costruire UpSelling.Packages quando body.UpSelling non è già
 *                     fornito. Not sent as-is.
 * @param {object}   [body.SpareParts]  - Required (and exclusive) when MessageType is MP
 * @param {Array}    [body.WorkLines]   - Required (and exclusive) when MessageType is WL.
 *                     Built internally from body.workLines when omitted.
 * @param {Array}    [body.workLines]   - Shortcut for WL: array of simplified work
 *                     lines ({ workLineReference, partNumbers, laborOperationIds }),
 *                     used to build WorkLines when body.WorkLines is not already
 *                     provided. Not sent as-is.
 * @param {string|null} [body.customerAccountDmsId] - Shortcut for WL: single
 *                     CustomerAccountDMSID value applied to every generated
 *                     WorkLines entry. Not sent as-is.
 * @returns {Promise<object>} parsed response body
 */
async function postDmsInquiry(bearerToken, body = {}) {
  // Il payload non è più interamente delegato a chi chiama la lambda: se manca
  // ApplicationArea (Sender/BODID/CreationDateTime), lo costruiamo qui — usando
  // body.sender (dealer/brand/mercato reale della richiesta, se fornito dal
  // chiamante) come override dei default statici di config.sender, cosi' il
  // Sender non è più fisso/uguale per ogni dealer ma riflette chi ha originato
  // davvero la inquiry.
  const requestBody = {
    ...body,
    ApplicationArea: body.ApplicationArea || (await buildApplicationArea(body.sender)),
  };
  delete requestBody.sender;

  // Scorciatoia "flat": se il chiamante non fornisce già PartsInquiryHeader
  // annidato, lo costruiamo qui dai campi root-level (DocumentID/CustomerIdDms/
  // MessageType/VehicleID), così non serve conoscere lo schema DML per i casi semplici.
  if (!requestBody.PartsInquiryHeader) {
    const { DocumentID, CustomerIdDms, MessageType, VehicleID } = requestBody;
    if (DocumentID || CustomerIdDms || MessageType || VehicleID) {
      requestBody.PartsInquiryHeader = { DocumentID, CustomerIdDms, MessageType, VehicleID };
    }
  }
  delete requestBody.DocumentID;
  delete requestBody.CustomerIdDms;
  delete requestBody.MessageType;
  delete requestBody.VehicleID;

  const header = requestBody.PartsInquiryHeader || {};

  if (!header.MessageType) throw new Error('[dms] PartsInquiryHeader.MessageType is required');
  if (!VALID_INQUIRY_TYPES.includes(header.MessageType)) {
    throw new Error(`[dms] MessageType must be one of: ${VALID_INQUIRY_TYPES.join(', ')}`);
  }
  if (!header.VehicleID)  throw new Error('[dms] PartsInquiryHeader.VehicleID is required');

  // DocumentID e CustomerIdDms non sono obbligatori nel contenuto (possono essere
  // sconosciuti, es. LFP prima che l'ordine di riparazione esista), ma il DML si
  // aspetta comunque le chiavi presenti nel payload: se non forniti (assenti,
  // null o undefined), vengono inviati come stringa vuota/null anziché omessi.
  if (header.DocumentID === undefined || header.DocumentID === null) header.DocumentID = '';
  if (header.CustomerIdDms === undefined) header.CustomerIdDms = null;

  // LFP: se il chiamante non fornisce già UpSelling.Packages ma passa
  // package (identificativo di dominio: codice o nome, non lo schema DML),
  // lo costruiamo qui. Accetta sia una singola stringa (es. 'ABC') sia un
  // array (es. ['ABC', 'DEF']).
  if (header.MessageType === 'LFP' && !requestBody.UpSelling && requestBody.package != null) {
    const packages = Array.isArray(requestBody.package)
      ? requestBody.package
      : [requestBody.package];
    requestBody.UpSelling = buildUpSellingPackages(packages);
  }
  delete requestBody.package;

  // WL: se il chiamante non fornisce già WorkLines ma passa workLines
  // semplificate (workLineReference + partNumbers/laborOperationIds), le
  // costruiamo qui, incluso il CustomerAccountDMSID unico ripetuto su ogni riga.
  if (header.MessageType === 'WL' && !requestBody.WorkLines && Array.isArray(requestBody.workLines)) {
    requestBody.WorkLines = buildWorkLines(requestBody.workLines, requestBody.customerAccountDmsId);
  }
  delete requestBody.workLines;
  delete requestBody.customerAccountDmsId;

  validateTypeSection(requestBody, header.MessageType);

  const base = new URL(config.dml.baseUrl);
  const fullPath = config.dml.inquiryPath;
  const payload = JSON.stringify(requestBody);

  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: fullPath,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-IBM-Client-Id': config.dml.ibmClientId,
      'X-IBM-Client-Secret': config.dml.ibmClientSecret,
      'X-Target-Env': config.dml.xTargetEnv,
    },
  };

  console.log(`[dms] POST https://${base.hostname}${fullPath} (MessageType=${header.MessageType})`);
  // Log esplicito dell'intero payload inviato al DML (nessun dato sensibile qui:
  // il bearer token è solo nell'header Authorization, mascherato sopra), utile per
  // diagnosticare errori lato DML come "No data found in dispatching table" che
  // dipendono dai valori di ApplicationArea.Sender/PartsInquiryHeader inviati.
  console.log('[dms] inquiry payload:', payload);
  const response = await httpsRequest(options, payload);

  if (response.statusCode !== 200) {
    // Il DML restituisce spesso { success, errorCode, message } anche sugli errori
    // HTTP: quando presente, lo esponiamo esplicitamente nel messaggio dell'errore
    // (oltre al body grezzo) così chi intercetta l'eccezione sa subito perché il
    // DML non ha restituito dati, senza dover riparsare JSON.stringify(response.body).
    const dmlBody   = response.body || {};
    const reason    = dmlBody.message
      ? ` — Il DML non ha restituito dati${dmlBody.errorCode ? ` (${dmlBody.errorCode})` : ''}: ${dmlBody.message}`
      : '';
    throw new Error(
      `[dms] inquiry failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}${reason}`
    );
  }

  return response.body;
}

module.exports = {
  getDmsSettings,
  getCompanyTypes,
  getCustomerTitles,
  postDmsInquiry,
  buildTypeSection,
  buildApplicationArea,
  validateTypeSection,
  buildUpSellingPackages,
  buildWorkLines,
};

/**
 * Returns the type-specific section of an InquiryRequest body based on MessageType.
 *   LFP → { UpSelling:  { Packages:  [] } }
 *   WL  → { WorkLines:  [] }
 *   MP  → { SpareParts: { PartsItem: [] } }
 *
 * @param {'LFP'|'WL'|'MP'} type
 * @returns {object}
 */
function buildTypeSection(type) {
  switch (type) {
    case 'LFP': return { UpSelling:  { Packages:  [] } };
    case 'WL':  return { WorkLines:  [] };
    case 'MP':  return { SpareParts: { PartsItem: [] } };
    default:    return {};
  }
}
