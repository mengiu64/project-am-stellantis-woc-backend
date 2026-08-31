'use strict';

/**
 * moparDocService.js — Chiamate downstream verso i tre gateway MoparDoc:
 *  - job-docs connector (api-oidc-preprod.groupe-psa.com): CreateJobCard, CreateAccessToken
 *  - MoparDocs Browser API (lab-examaftersales.fiat.com): getUploadDocURL, UploadedDoc
 *  - MoparDocs Services API (stellantis.com): getJobCardList, associateJobCard, getJobCardAndDocumentList, 
 *    getDocumentsInfo, associateDocument, getDocuments, DeleteDocuments, DeleteJobcard, getDocumentsDownloadUrl
 *
 * Tutte le chiamate condividono lo stesso PingFederate (authService.getBearerToken) 
 * e le stesse credenziali IBM API Connect (X-IBM-Client-Id / X-IBM-Client-Secret), 
 * ma usano host diversi a seconda del servizio.
 */

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getBearerToken } = require('./authService');
const config = require('./config');

/**
 * Costruisce le options per una richiesta POST JSON verso uno dei due gateway.
 * @param {{baseUrl: string, basePath: string, ibmClientId: string, ibmClientSecret: string}} target
 * @param {string} resourcePath - es. "/CreateJobCard"
 * @param {string} bearerToken
 * @param {string} bodyStr
 */
function buildOptions(target, resourcePath, bearerToken, bodyStr) {
  const endpoint = new URL(target.baseUrl);
  return {
    hostname: endpoint.hostname,
    port: endpoint.port || 443,
    path: `${target.basePath}${resourcePath}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      Authorization: `Bearer ${bearerToken}`,
      'X-IBM-Client-Id': target.ibmClientId,
      'X-IBM-Client-Secret': target.ibmClientSecret,
    },
  };
}

async function postJson(target, resourcePath, payload) {
  const bearerToken = await getBearerToken();
  const bodyStr = JSON.stringify(payload);
  const options = buildOptions(target, resourcePath, bearerToken, bodyStr);

  console.log(`[moparDocService] POST ${target.baseUrl}${options.path}`);
  const response = await httpsRequest(options, bodyStr);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `[moparDocService] ${resourcePath} failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * CreateJobCard — crea una job card sul connector job-docs (PSA).
 * @param {{vin: string, market: string, source: string, UserName: string, dealerCode: string, JobCard_Title: string, TAMAccessCode: string}} params
 */
async function createJobCard(params) {
  const required = ['vin', 'market', 'source', 'UserName', 'dealerCode', 'JobCard_Title', 'TAMAccessCode'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[createJobCard] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    vin: params.vin,
    market: params.market,
    source: params.source,
    UserName: params.UserName,
    dealerCode: params.dealerCode,
    JobCard_Title: params.JobCard_Title,
    TAMAccessCode: params.TAMAccessCode,
  };

  return postJson(config.jobDocs, '/CreateJobCard', payload);
}

/**
 * CreateAccessToken — ottiene un APIAccessCode/AccessToken per una job card
 * già creata (necessario per autenticare getUploadDocURL/uploadedDoc verso
 * MoparDocs Browser API). Stesso connector job-docs (PSA) di createJobCard.
 * @param {{JobCardId: string, UserName: string, dealerCode: string, market: string, APIAccessCode: string}} params
 */
async function createAccessToken(params) {
  const required = ['JobCardId', 'UserName', 'dealerCode', 'market', 'APIAccessCode'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[createAccessToken] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    JobCardId: params.JobCardId,
    UserName: params.UserName,
    dealerCode: params.dealerCode,
    market: params.market,
    APIAccessCode: params.APIAccessCode,
  };

  return postJson(config.jobDocs, '/CreateAccessToken', payload);
}

/**
 * getUploadDocURL — ottiene la URL pre-firmata per l'upload di un documento.
 * @param {{JobCardId: string, Filename: string, ContentType: string, AccessToken: string, Filetype: string}} params
 */
async function getUploadDocURL(params) {
  const required = ['JobCardId', 'Filename', 'ContentType', 'AccessToken', 'Filetype'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getUploadDocURL] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    JobCardId: params.JobCardId,
    Filename: params.Filename,
    ContentType: params.ContentType,
    AccessToken: params.AccessToken,
    Filetype: params.Filetype,
  };

  return postJson(config.moparDocsApi, '/getUploadDocURL', payload);
}

/**
 * UploadedDoc — notifica il completamento dell'upload di un documento.
 * @param {{JobCardId: string, DocumentId: string, Action: string, AccessToken: string}} params
 */
async function uploadedDoc(params) {
  const required = ['JobCardId', 'DocumentId', 'Action', 'AccessToken'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[uploadedDoc] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    JobCardId: params.JobCardId,
    DocumentId: params.DocumentId,
    Action: params.Action,
    AccessToken: params.AccessToken,
  };

  return postJson(config.moparDocsApi, '/UploadedDoc', payload);
}

/**
 * getJobCardList — recupera la lista di job card per un VIN specifico.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{VIN: string, dealerCode: string, market: string}} params
 */
async function getJobCardList(params) {
  // Convalida campi obbligatori
  const required = ['VIN', 'dealerCode', 'market'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getJobCardList] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload
  const payload = {
    VIN: params.VIN,
    dealerCode: params.dealerCode,
    market: params.market,
  };

  // Log di inizio esecuzione
  console.log(`[getJobCardList] Inizio recupero job card list per VIN: ${params.VIN}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/getJobCardList', payload);
}

/**
 * associateJobCard — associa una job card a un ticket esterno.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{JobCardId: string, TicketId: string}} params
 */
async function associateJobCard(params) {
  // Convalida campi obbligatori
  const required = ['JobCardId', 'TicketId'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[associateJobCard] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload
  const payload = {
    JobCardId: params.JobCardId,
    TicketId: params.TicketId,
  };

  // Log di inizio esecuzione
  console.log(`[associateJobCard] Inizio associazione JobCard ${params.JobCardId} a ticket ${params.TicketId}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/associateJobCard', payload);
}

/**
 * getJobCardAndDocumentList — recupera job card e relativa lista di documenti.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{JobCardId: string}} params
 */
async function getJobCardAndDocumentList(params) {
  // Convalida campi obbligatori
  const required = ['JobCardId'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getJobCardAndDocumentList] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload
  const payload = {
    JobCardId: params.JobCardId,
  };

  // Log di inizio esecuzione
  console.log(`[getJobCardAndDocumentList] Inizio recupero job card e documenti per JobCardId: ${params.JobCardId}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/getJobCardAndDocumentList', payload);
}

/**
 * getDocumentsInfo — recupera informazioni dettagliate di uno o più documenti.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{DocumentIds: string[]}} params
 */
async function getDocumentsInfo(params) {
  // Convalida campi obbligatori
  const required = ['DocumentIds'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getDocumentsInfo] Missing required field(s): ${missing.join(', ')}`);
  }

  // Convalida che DocumentIds sia un array non vuoto
  if (!Array.isArray(params.DocumentIds) || params.DocumentIds.length === 0) {
    throw new Error(`[getDocumentsInfo] DocumentIds deve essere un array non vuoto`);
  }

  // Costruisce il payload
  const payload = {
    DocumentIds: params.DocumentIds,
  };

  // Log di inizio esecuzione
  console.log(`[getDocumentsInfo] Inizio recupero info per ${params.DocumentIds.length} documento(i)`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/getDocumentsInfo', payload);
}

/**
 * associateDocument — associa un documento a un ticket esterno.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{DocumentId: string, TicketId: string}} params
 */
async function associateDocument(params) {
  // Convalida campi obbligatori
  const required = ['DocumentId', 'TicketId'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[associateDocument] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload
  const payload = {
    DocumentId: params.DocumentId,
    TicketId: params.TicketId,
  };

  // Log di inizio esecuzione
  console.log(`[associateDocument] Inizio associazione documento ${params.DocumentId} a ticket ${params.TicketId}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/associateDocument', payload);
}

/**
 * getDocuments — recupera i documenti associati a una job card.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{JobCardId: string}} params
 */
async function getDocuments(params) {
  // Convalida campi obbligatori
  const required = ['JobCardId'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getDocuments] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload
  const payload = {
    JobCardId: params.JobCardId,
  };

  // Log di inizio esecuzione
  console.log(`[getDocuments] Inizio recupero documenti per JobCardId: ${params.JobCardId}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/getDocuments', payload);
}

/**
 * DeleteDocuments — elimina uno o più documenti.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{DocumentIds: string[]}} params
 */
async function DeleteDocuments(params) {
  // Convalida campi obbligatori
  const required = ['DocumentIds'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[DeleteDocuments] Missing required field(s): ${missing.join(', ')}`);
  }

  // Convalida che DocumentIds sia un array non vuoto
  if (!Array.isArray(params.DocumentIds) || params.DocumentIds.length === 0) {
    throw new Error(`[DeleteDocuments] DocumentIds deve essere un array non vuoto`);
  }

  // Costruisce il payload
  const payload = {
    DocumentIds: params.DocumentIds,
  };

  // Log di inizio esecuzione
  console.log(`[DeleteDocuments] Inizio eliminazione ${params.DocumentIds.length} documento(i)`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/DeleteDocuments', payload);
}

/**
 * DeleteJobcard — elimina una job card.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{JobCardId: string}} params
 */
async function DeleteJobcard(params) {
  // Convalida campi obbligatori
  const required = ['JobCardId'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[DeleteJobcard] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload
  const payload = {
    JobCardId: params.JobCardId,
  };

  // Log di inizio esecuzione
  console.log(`[DeleteJobcard] Inizio eliminazione JobCard: ${params.JobCardId}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/DeleteJobcard', payload);
}

/**
 * getDocumentsDownloadUrl — ottiene le URL di download pre-firmate per i documenti.
 * [NUOVO] Service endpoint: MoparDocs Services API
 * @param {{DocumentId: string, AccessToken: string}} params
 */
async function getDocumentsDownloadUrl(params) {
  // Convalida campi obbligatori
  const required = ['DocumentId', 'AccessToken'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getDocumentsDownloadUrl] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload
  const payload = {
    DocumentId: params.DocumentId,
    AccessToken: params.AccessToken,
  };

  // Log di inizio esecuzione
  console.log(`[getDocumentsDownloadUrl] Inizio recupero URL download per documento: ${params.DocumentId}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/getDocumentsDownloadUrl', payload);
}

module.exports = {
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
