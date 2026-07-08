'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js settings <country> <brand> <dealer>
 *   node index.js inquiry <type> <documentId> <customerId> <vehicleId>
 *   node index.js inquiry --file <path/to/body.json>
 *
 * Parameters (settings):
 *   country  - Country code (e.g. fr)
 *   brand    - Brand code   (e.g. FT)
 *   dealer   - Dealer ID    (e.g. 0062230)
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
 *   node index.js inquiry LFP 84564621 854265 3C4NJCBH7KT831816
 *   node index.js inquiry --file ./LFP_1_Request.json
 */

const fs            = require('fs');
const { randomUUID } = require('crypto');
const { getBearerToken } = require('./authService');
const { getDmsSettings, postDmsInquiry, buildTypeSection } = require('./dmsService');
const config        = require('./config');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['settings', 'inquiry'];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "settings", "body": {...} }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../dms/settings -> "settings")
 *     and the body is built by merging query string parameters with a JSON body, if any.
 */
function resolveActionAndBody(event) {
  if (event && event.action) {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body)
      : (event.body || {});
    return { action: event.action, body };
  }

  const rawPath  = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  const segments = String(rawPath).split('/').filter(Boolean);
  const action   = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;

  let parsedBody = {};
  if (event.body) {
    try {
      parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (_) {
      parsedBody = {};
    }
  }

  const body = { ...(event.queryStringParameters || {}), ...parsedBody };
  return { action, body };
}

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
    const token = await getBearerToken();
    const result = action === 'settings'
      ? await getDmsSettings(token, body)
      : await postDmsInquiry(token, body);

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

    const s = config.sender;
    body = {
      ApplicationArea: {
        Sender: {
          ComponentID:          s.componentId,
          DealerNumberID:       s.dealerNumberId,
          DealerNumberIDSource: s.dealerNumberIdSource,
          DealerCountryCode:    s.dealerCountryCode,
          LanguageCode:         s.languageCode,
          PhysicalSiteID:       s.physicalSiteId,
          ServiceID:            s.serviceId,
          CurrencyID:           s.currencyId,
          Brand:                s.brand,
        },
        CreationDateTime: new Date().toISOString(),
        BODID:            randomUUID(),
      },
      PartsInquiryHeader: {
        DocumentID:    documentId,
        CustomerIdDms: customerId,
        MessageType:   type,
        VehicleID:     vehicleId,
      },
      ...buildTypeSection(type),
    };
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
    } else if (command === 'inquiry') {
      await runInquiry(args);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js settings <country> <brand> <dealer>');
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