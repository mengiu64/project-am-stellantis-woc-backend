'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js settings <country> <brand> <dealer>
 *   node index.js company-types <country> <language>
 *   node index.js customer-titles <country> <language>
 *   node index.js inquiry <type> <documentId> <customerId> <vehicleId>
 *   node index.js inquiry --file <path/to/body.json>
 *
 * Parameters (settings):
 *   country  - Country code (e.g. fr)
 *   brand    - Brand code   (e.g. FT)
 *   dealer   - Dealer ID    (e.g. 0062230)
 *
 * Parameters (company-types / customer-titles):
 *   country  - Country code  (e.g. FR)
 *   language - Language code (e.g. fr)
 *
 * Parameters (inquiry — positional):
 *   type       - MessageType: LFP | WL | MP
 *   documentId - Unique Repair Order number (e.g. 84564621)
 *   customerId - Customer ID in DMS (e.g. 854265)
 *   vehicleId  - VIN (e.g. 3C4NJCBH7KT831816)
 *
 * Parameters (inquiry — file):
 *   --file <path> - Path to a JSON file with the full InquiryRequest body
 *
 * Examples:
 *   node index.js settings fr FT 0062230
 *   node index.js company-types FR fr
 *   node index.js customer-titles fr fr
 *   node index.js inquiry LFP 84564621 854265 3C4NJCBH7KT831816
 *   node index.js inquiry --file ./LFP_1_Request.json
 */

const fs            = require('fs');
const { getBearerToken } = require('./authService');
const { getDmsSettings, getCompanyTypes, getCustomerTitles, postDmsInquiry, buildTypeSection, resolveDynamicSenderFields } = require('./dmsService');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['settings', 'company-types', 'customer-titles', 'inquiry'];

/**
 * Estrae lo username autenticato per il Sender dinamico dell'azione "inquiry"
 * (v. resolveInquirySender sotto): se l'evento ha un requestContext.authorizer,
 * SOLO authorizer.sub è attendibile (stessa convenzione di
 * session/pkFavorite/jobcard — mai un valore fornito dal body). Altrimenti
 * (nessun authorizer nell'evento: invocazione diretta/CLI di test) si accetta
 * body.username.
 */
function resolveUsername(event, body) {
  const authz = (event && event.requestContext && event.requestContext.authorizer) || null;
  if (authz) {
    return authz.sub || null;
  }
  return (body && body.username) || null;
}

/**
 * Risolve SEMPRE il Sender dinamico dell'azione "inquiry", direttamente qui
 * nell'handler — nessun chiamante (jobcard/pkManager/pkFavorite, o
 * un'invocazione diretta/API Gateway della lambda dms) deve più risolverlo e
 * passarlo esplicitamente: stesso identico meccanismo/criteri già
 * centralizzati in dmsService.js::resolveDynamicSenderFields e usati da
 * jobcard/pkManager/pkFavorite:
 *  - username SEMPRE da event.requestContext.authorizer.sub quando presente
 *    (resolveUsername sopra), usato sia come chiave di risoluzione sessione
 *    sia come ApplicationArea.Sender.ServiceID;
 *  - vin dal body (VehicleID flat o PartsInquiryHeader.VehicleID);
 *  - mainSincom/market/language/dealerCountryCode <- sessione (username),
 *    tramite session/src/sessionContextCache.js::getCachedSessionContext;
 *  - brand <- VIN, tramite v360/v360Service.js::getCachedBrand.
 * Eventuali campi già presenti in body.sender (override espliciti, es. per
 * test/replay da file) hanno sempre priorità sui valori auto-risolti.
 * Interamente best-effort (v. resolveDynamicSenderFields): un fallimento di
 * risoluzione non blocca mai la inquiry, il Sender ricade sui default statici
 * di config.sender per i soli campi non risolvibili.
 */
async function resolveInquirySender(event, body) {
  const explicit = (body && body.sender) || {};
  const username = resolveUsername(event, body);
  const vin = (body && (body.VehicleID || (body.PartsInquiryHeader && body.PartsInquiryHeader.VehicleID))) || null;

  const { mainSincom, market, brand, language, dealerCountryCode } = await resolveDynamicSenderFields(
    { username, vin },
    {
      mainSincom: explicit.dealerNumberId,
      market: explicit.market,
      brand: explicit.brand,
      language: explicit.languageCode,
      dealerCountryCode: explicit.dealerCountryCode,
    },
  );

  // Anche se resolveDynamicSenderFields già dà priorità agli overrides
  // espliciti passati come secondo argomento, li riapplichiamo qui a valle
  // per difesa in profondità: un valore già presente in body.sender (esplicito
  // dal chiamante) non deve MAI essere sovrascritto dal valore auto-risolto.
  const sender = { ...explicit };
  if (mainSincom && !sender.dealerNumberId) sender.dealerNumberId = mainSincom;
  if (!sender.serviceId && username) sender.serviceId = username;
  if (language && !sender.languageCode) sender.languageCode = language;
  if (dealerCountryCode && !sender.dealerCountryCode) sender.dealerCountryCode = dealerCountryCode;
  if (market && !sender.market) sender.market = market;
  if (brand && !sender.brand) sender.brand = brand;
  return sender;
}

// MessageType values accepted by the DML inquiry endpoint (per swagger-woc.yaml
// path parameter `/api/repairorder/inquiry/{type}`). Kept in sync with
// dmsService.js's own VALID_INQUIRY_TYPES.
const VALID_INQUIRY_TYPES = ['LFP', 'WL', 'MP'];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload: { "action": "settings", "body": {...} }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event. The
 *     real routes configured in swagger-woc.yaml are:
 *       - GET  /api/settings/dml/current                    -> action "settings"
 *       - GET  /api/configurations/dml/company-types        -> action "company-types"
 *       - GET  /api/configurations/dml/customer-titles      -> action "customer-titles"
 *       - POST /api/repairorder/inquiry/{type}    -> action "inquiry", where
 *         {type} (LFP | WL | MP) is the *last* path segment and is used as a
 *         MessageType shortcut merged into the body (unless the body already
 *         declares MessageType, either flat or nested in PartsInquiryHeader).
 *     Falls back to treating the last path segment itself as the action (e.g.
 *     .../dms/settings -> "settings", .../dms/inquiry -> "inquiry") for direct
 *     invocations that don't go through the routes above.
 *     The body is built by merging query string parameters with a JSON body,
 *     if any.
 */
function resolveActionAndBody(event) {
  if (event && event.action) {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body)
      : (event.body || {});
    return { action: event.action, body };
  }

  const rawPath  = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  const segments = String(rawPath).split('/').filter(Boolean).map(decodeURIComponent);

  let parsedBody = {};
  if (event.body) {
    try {
      parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (_) {
      parsedBody = {};
    }
  }

  const body = { ...(event.queryStringParameters || {}), ...parsedBody };

  // /api/repairorder/inquiry/{type} -> action "inquiry", {type} feeds MessageType.
  const inquiryIdx = segments.indexOf('inquiry');
  if (inquiryIdx !== -1) {
    const type = segments[inquiryIdx + 1];
    const hasMessageType = body.MessageType || (body.PartsInquiryHeader && body.PartsInquiryHeader.MessageType);
    if (type && VALID_INQUIRY_TYPES.includes(type) && !hasMessageType) {
      body.MessageType = type;
    }
    return { action: 'inquiry', body };
  }

  // /api/configurations/dml/company-types -> action "company-types".
  if (segments.includes('company-types')) {
    return { action: 'company-types', body };
  }

  // /api/configurations/dml/customer-titles -> action "customer-titles".
  if (segments.includes('customer-titles')) {
    return { action: 'customer-titles', body };
  }

  // /api/settings/dml/current -> action "settings".
  if (segments.includes('settings')) {
    return { action: 'settings', body };
  }

  // Fallback: last path segment as action (direct invocations, e.g. .../dms/settings).
  const action = segments.length ? segments[segments.length - 1] : undefined;
  return { action, body };
}

// Dispatch table: ciascuna azione GET/POST mappata alla propria funzione di
// dmsService.js. "inquiry" resta l'unica POST, tutte le altre sono GET con
// stesse credenziali/bearer token (vedi dmsService.js::getDmlConfiguration).
const ACTION_HANDLERS = {
  settings: getDmsSettings,
  'company-types': getCompanyTypes,
  'customer-titles': getCustomerTitles,
  inquiry: postDmsInquiry,
};

exports.handler = async (event) => {
  const { action, body } = resolveActionAndBody(event);

  if (!action || !VALID_ACTIONS.includes(action)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: `Unknown action: "${action}". Valid actions: ${VALID_ACTIONS.join(', ')}`,
      }),
    };
  }

  try {
    if (action === 'inquiry') {
      // Sender dinamico SEMPRE risolto qui, senza bisogno che il chiamante lo
      // passi esplicitamente (v. resolveInquirySender sopra).
      body.sender = await resolveInquirySender(event, body);
    }

    const token = await getBearerToken();
    const result = await ACTION_HANDLERS[action](token, body);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const statusCode = err.message.includes('is required') ? 400 : 502;
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

async function runSettings(country, brand, dealer) {
  console.log('\n=== DMS Settings ===');
  const token = await getBearerToken();
  const result = await getDmsSettings(token, { country, brand, dealer });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runCompanyTypes(country, language) {
  console.log('\n=== DMS Company Types ===');
  const token = await getBearerToken();
  const result = await getCompanyTypes(token, { country, language });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runCustomerTitles(country, language) {
  console.log('\n=== DMS Customer Titles ===');
  const token = await getBearerToken();
  const result = await getCustomerTitles(token, { country, language });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Builds the type-specific section of the InquiryRequest body.
 *   LFP → UpSelling.Packages  (empty array — populate before production use)
 *   WL  → WorkLines            (empty array — populate before production use)
 *   MP  → SpareParts.PartsItem (empty array — populate before production use)
 */async function runInquiry(args) {
  const fileIdx = args.indexOf('--file');

  let body;

  if (fileIdx !== -1) {
    // ── mode: full JSON file ──────────────────────────────────────────────
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      console.error('[ERROR] --file richiede un percorso file');
      process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
      console.error(`[ERROR] File non trovato: ${filePath}`);
      process.exit(1);
    }
    body = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  } else {
    // ── mode: positional args ─────────────────────────────────────────────
    const [type, documentId, customerId, vehicleId] = args;
    if (!type || !documentId || !customerId || !vehicleId) {
      console.error('[ERROR] Uso: node index.js inquiry <type> <documentId> <customerId> <vehicleId>');
      console.error('  type: LFP | WL | MP');
      console.error('  Oppure: node index.js inquiry --file <path/to/body.json>');
      process.exit(1);
    }

    // ApplicationArea (Sender/BODID/CreationDateTime) non viene più costruito
    // qui: lo genera internamente postDmsInquiry() quando manca dal body.
    body = {
      PartsInquiryHeader: {
        DocumentID:    documentId,
        CustomerIdDms: customerId,
        MessageType:   type,
        VehicleID:     vehicleId,
      },
      ...buildTypeSection(type),
    };
  }

  // Stessa risoluzione dinamica del Sender usata dall'handler Lambda (v.
  // resolveInquirySender sopra): anche da CLI il Sender non è mai statico,
  // salvo replay esplicito di un ApplicationArea già completo da --file.
  if (!body.ApplicationArea) {
    body.sender = await resolveInquirySender(null, body);
  }

  const type = body?.PartsInquiryHeader?.MessageType;
  console.log(`\n=== DMS Inquiry (${type}) ===`);
  const token = await getBearerToken();
  const result = await postDmsInquiry(token, body);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, ...args] = process.argv;

  try {
    if (command === 'settings') {
      const [country = 'fr', brand = 'FT', dealer = '0062230'] = args;
      await runSettings(country, brand, dealer);
    } else if (command === 'company-types') {
      const [country = 'FR', language = 'fr'] = args;
      await runCompanyTypes(country, language);
    } else if (command === 'customer-titles') {
      const [country = 'fr', language = 'fr'] = args;
      await runCustomerTitles(country, language);
    } else if (command === 'inquiry') {
      await runInquiry(args);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js settings <country> <brand> <dealer>');
      console.error('  node index.js company-types <country> <language>');
      console.error('  node index.js customer-titles <country> <language>');
      console.error('  node index.js inquiry <type> <documentId> <customerId> <vehicleId>');
      console.error('  node index.js inquiry --file <path/to/body.json>');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}