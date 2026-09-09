'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js list        <dealerId> [options]
 *   node index.js listCurrent <dealerId> <currentDate>
 *   node index.js details     <jobCardId>
 *   node index.js saveJobcard <payloadJsonFile>
 *   node index.js dml         <jobCardId>
 *
 * Options for "list" (key=value):
 *   vin=<value>
 *   creationStartDate=<ISO8601>   creationEndDate=<ISO8601>
 *   deliveryStartDate=<ISO8601>   deliveryEndDate=<ISO8601>
 *   receptionStartDate=<ISO8601>  receptionEndDate=<ISO8601>
 *   licensePlate=<value>
 *   dmsRepairOrderId=<value>
 *   customerName=<value>
 *   page=<number>        (default: 1)
 *   pageSize=<number>    (default: 50)
 *   sortBy=<field>       (default: jobCardId)
 *   sortOrder=asc|desc   (default: asc)
 *
 * "listCurrent" (getJobCardListCurrent) richiede dealerId e currentDate
 * ("YYYY-MM-DD", es. "2026-05-20"): combina reception/delivery/creation di
 * oggi/ultimi 7 giorni in un unico jobCardList deduplicato (v.
 * jobCardService.getJobCardListCurrent).
 *
 * Examples:
 *   node index.js list 0062219
 *   node index.js list 0062219 page=2 pageSize=10 sortBy=creationDate sortOrder=desc
 *   node index.js list 0062219 vin=3C4NJCBH7KT831816 creationStartDate=2024-01-01T00:00:00Z
 *   node index.js listCurrent 0062219 2026-05-20
 *   node index.js details 79
 *   node index.js saveJobcard ./payload.json
 *   node index.js dml 79
 *
 * "dml" (getDataFromDMLFromTmp) legge /tmp/<jobCardId>.json, già salvato da
 * una precedente "details" (getJobCardDetails/saveJobCardDetailsToTmp), e
 * applica l'arricchimento prezzo/disponibilità DML (getDataFromDML) al
 * relativo jobCardDetail. Se il file manca (es. /tmp non condiviso tra
 * istanze Lambda diverse), richiama DGT (getJobCardDetails, con un
 * bearerToken PingFederate) per rigenerarlo e rilegge il file prodotto.
 *
 * "saveJobcard" (POST /jobCard) è la stessa azione esposta anche dalla lambda
 * djc (stessa "declinazione" della jobcard, stesso client PingFederate/DGT):
 * API Gateway instrada le richieste POST verso la lambda djc, ma il metodo è
 * disponibile anche qui (chiamata diretta/CLI, coerenza tra le due lambda).
 */

const { getBearerToken } = require('./authService');
const { getJobCardList, getJobCardListCurrent, getJobCardDetails, saveJobCard, getDataFromDMLFromTmp } = require('./jobCardService');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['list', 'listCurrent', 'details', 'saveJobcard', 'dml'];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "list", "body": { "dealerId": "..." } }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../repairorder/list -> "list")
 *     and the body is built by merging query string parameters with a JSON body, if any.
 *     Example: GET /api/repairorder/list?dealerId=0062219
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
    let result;
    if (action === 'dml') {
      // Legge /tmp/<jobCardId>.json salvato da una precedente "details" e
      // chiama il gateway DML (jobCardService.getDataFromDMLFromTmp gestisce
      // internamente il proprio token verso dms/authService). Se il file
      // manca, getDataFromDMLFromTmp richiama DGT (getJobCardDetails) per
      // rigenerarlo, recuperando un bearerToken PingFederate solo in quel caso.
      result = await getDataFromDMLFromTmp(body.jobCardId ?? body.id);
    } else {
      const token = await getBearerToken();
      if (action === 'list') {
        result = await getJobCardList(token, body);
      } else if (action === 'listCurrent') {
        result = await getJobCardListCurrent(token, body.dealerId, body.currentDate);
      } else if (action === 'details') {
        result = await getJobCardDetails(token, body.jobCardId ?? body.id);
      } else {
        result = await saveJobCard(token, body.payload ?? body);
      }
    }

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

/**
 * Parses extra CLI args in the form key=value into an object.
 * Numeric-looking values are cast to numbers.
 */
function parseKvArgs(args) {
  const result = {};
  for (const arg of args) {
    const idx = arg.indexOf('=');
    if (idx === -1) continue;
    const key = arg.slice(0, idx).trim();
    const raw = arg.slice(idx + 1).trim();
    result[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  return result;
}

async function runList(dealerId, extraArgs) {
  console.log('\n=== JobCard List ===');
  const params = { dealerId, ...parseKvArgs(extraArgs) };
  const token = await getBearerToken();
  const result = await getJobCardList(token, params);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runListCurrent(dealerId, currentDate) {
  console.log('\n=== JobCard List Current ===');
  const token = await getBearerToken();
  const result = await getJobCardListCurrent(token, dealerId, currentDate);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runDetails(jobCardId) {
  console.log('\n=== JobCard Details ===');
  const token = await getBearerToken();
  const result = await getJobCardDetails(token, jobCardId);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runSaveJobcard(payloadJsonFile) {
  console.log('\n=== Save JobCard ===');
  const fs = require('fs');
  const payload = JSON.parse(fs.readFileSync(payloadJsonFile, 'utf8'));
  const token = await getBearerToken();
  const result = await saveJobCard(token, payload);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runDml(jobCardId) {
  console.log('\n=== JobCard DML (da /tmp) ===');
  const result = await getDataFromDMLFromTmp(jobCardId);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, param, ...rest] = process.argv;

  try {
    if (command === 'list') {
      const dealerId = param || '0062219';
      await runList(dealerId, rest);
    } else if (command === 'listCurrent') {
      const dealerId    = param || '0062219';
      const currentDate = rest[0];
      if (!currentDate) {
        console.error('[ERROR] È richiesto currentDate ("YYYY-MM-DD").');
        process.exit(1);
      }
      await runListCurrent(dealerId, currentDate);
    } else if (command === 'details') {
      const jobCardId = param || '79';
      await runDetails(jobCardId);
    } else if (command === 'saveJobcard') {
      if (!param) {
        console.error('[ERROR] È richiesto il path del file JSON con il payload.');
        process.exit(1);
      }
      await runSaveJobcard(param);
    } else if (command === 'dml') {
      const jobCardId = param || '79';
      await runDml(jobCardId);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js list        <dealerId> [key=value ...]');
      console.error('  node index.js listCurrent <dealerId> <currentDate>');
      console.error('  node index.js details     <jobCardId>');
      console.error('  node index.js saveJobcard <payloadJsonFile>');
      console.error('  node index.js dml         <jobCardId>');
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