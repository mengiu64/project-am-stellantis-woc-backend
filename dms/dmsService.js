'use strict';

const { URL } = require('url');
const { randomUUID } = require('crypto');
const { httpsRequest } = require('./httpClient');
const config = require('./config');

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

  if (response.statusCode !== 200) {
    throw new Error(
      `[dms] settings failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
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
 * @returns {object} ApplicationArea
 */
function buildApplicationArea() {
  const s = config.sender;
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
 *                     and a freshly generated BODID/CreationDateTime. Provide it
 *                     only when replaying a pre-built request (e.g. from file).
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
  // ApplicationArea (Sender/BODID/CreationDateTime), lo costruiamo qui.
  const requestBody = {
    ...body,
    ApplicationArea: body.ApplicationArea || buildApplicationArea(),
  };

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
  const response = await httpsRequest(options, payload);

  if (response.statusCode !== 200) {
    throw new Error(
      `[dms] inquiry failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

module.exports = {
  getDmsSettings,
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
