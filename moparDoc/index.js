'use strict';

/**
 * index.js — Entry point (moparDoc)
 *
 * Espone 13 azioni verso i gateway MoparDoc (documenti Mopar/Jobcard):
 *  ── 4 metodi originali (job-docs PSA + MoparDocs FCA):
 *  - createJobCard     (POST /job-docs/connector/v1/CreateJobCard)
 *  - createAccessToken (POST /job-docs/connector/v1/CreateAccessToken)
 *  - getUploadDocURL   (POST /Mopardocs/MoparDocsApi/Browser/getUploadDocURL)
 *  - uploadedDoc       (POST /Mopardocs/MoparDocsApi/Browser/UploadedDoc)
 *
 *  ── 9 metodi nuovi (MoparDocs Services Stellantis):
 *  - getJobCardList               [NUOVO]
 *  - associateJobCard             [NUOVO]
 *  - getJobCardAndDocumentList    [NUOVO]
 *  - getDocumentsInfo             [NUOVO]
 *  - associateDocument            [NUOVO]
 *  - getDocuments                 [NUOVO]
 *  - DeleteDocuments              [NUOVO]
 *  - DeleteJobcard                [NUOVO]
 *  - getDocumentsDownloadUrl      [NUOVO]
 *
 * Usage:
 *   node index.js createJobCard     <payloadJsonFile>
 *   node index.js createAccessToken <payloadJsonFile>
 *   node index.js getUploadDocURL   <payloadJsonFile>
 *   node index.js uploadedDoc       <payloadJsonFile>
 *   node index.js getJobCardList               <payloadJsonFile> [NUOVO]
 *   node index.js associateJobCard             <payloadJsonFile> [NUOVO]
 *   node index.js getJobCardAndDocumentList    <payloadJsonFile> [NUOVO]
 *   node index.js getDocumentsInfo             <payloadJsonFile> [NUOVO]
 *   node index.js associateDocument            <payloadJsonFile> [NUOVO]
 *   node index.js getDocuments                 <payloadJsonFile> [NUOVO]
 *   node index.js DeleteDocuments              <payloadJsonFile> [NUOVO]
 *   node index.js DeleteJobcard                <payloadJsonFile> [NUOVO]
 *   node index.js getDocumentsDownloadUrl      <payloadJsonFile> [NUOVO]
 *
 * Esempio payload createJobCard:
 *   { "vin": "...", "market": "IT", "source": "WOC", "UserName": "...",
 *     "dealerCode": "0062230", "JobCard_Title": "...", "TAMAccessCode": "..." }
 *
 * Esempio payload createAccessToken:
 *   { "JobCardId": "...", "UserName": "...", "dealerCode": "0062230",
 *     "market": "IT", "APIAccessCode": "..." }
 */

const fs = require('fs');
const {
  createJobCard,
  createAccessToken,
  getUploadDocURL,
  uploadedDoc,
  getJobCardList,
  associateJobCard,
  getJobCardAndDocumentList,
  getDocumentsInfo,
  associateDocument,
  getDocuments,
  DeleteDocuments,
  DeleteJobcard,
  getDocumentsDownloadUrl,
} = require('./moparDocService');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = [
  'createJobCard',
  'createAccessToken',
  'getUploadDocURL',
  'uploadedDoc',
  'getJobCardList',
  'associateJobCard',
  'getJobCardAndDocumentList',
  'getDocumentsInfo',
  'associateDocument',
  'getDocuments',
  'DeleteDocuments',
  'DeleteJobcard',
  'getDocumentsDownloadUrl',
];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "createJobCard", "body": { ... } }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../moparDoc/createJobCard)
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

const ACTIONS = {
  createJobCard,
  createAccessToken,
  getUploadDocURL,
  uploadedDoc,
  getJobCardList,
  associateJobCard,
  getJobCardAndDocumentList,
  getDocumentsInfo,
  associateDocument,
  getDocuments,
  DeleteDocuments,
  DeleteJobcard,
  getDocumentsDownloadUrl,
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
    const result = await ACTIONS[action](body.payload ?? body);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const statusCode = err.message.includes('Missing required field') ? 400 : 502;
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

async function runAction(action, payloadJsonFile) {
  console.log(`\n=== MoparDoc: ${action} ===`);
  const payload = JSON.parse(fs.readFileSync(payloadJsonFile, 'utf8'));
  const result = await ACTIONS[action](payload);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, param] = process.argv;

  try {
    if (VALID_ACTIONS.includes(command)) {
      if (!param) {
        console.error('[ERROR] È richiesto il path del file JSON con il payload.');
        process.exit(1);
      }
      await runAction(command, param);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js createJobCard     <payloadJsonFile>');
      console.error('  node index.js createAccessToken <payloadJsonFile>');
      console.error('  node index.js getUploadDocURL   <payloadJsonFile>');
      console.error('  node index.js uploadedDoc       <payloadJsonFile>');
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
