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
 * Costruisce le options per una richiesta POST JSON verso uno dei tre gateway.
 * @param {{baseUrl: string, basePath: string, ibmClientId: string, ibmClientSecret: string}} target
 * @param {string} resourcePath - es. "/CreateJobCard"
 * @param {string} bearerToken
 * @param {string} bodyStr
 */
function buildOptions(target, resourcePath, bearerToken, bodyStr) {
  // Protegge la costruzione dell'URL: se baseUrl è mancante o malformato,
  // lancia un errore descrittivo invece di un opaco "Invalid URL"
  let endpoint;
  try {
    endpoint = new URL(target.baseUrl);
  } catch (err) {
    throw new Error(`baseUrl non valido: "${target.baseUrl}" (basePath: "${target.basePath}", resource: "${resourcePath}")`);
  }

  // Compone hostname, porta e path definitivi della richiesta
  const port = endpoint.port || 443;
  const path = `${target.basePath}${resourcePath}`;

  // Log: URL completo effettivamente chiamato (schema, host, porta, path)
  console.log(`[buildOptions] URL chiamata: ${endpoint.protocol}//${endpoint.hostname}:${port}${path}`);

  return {
    hostname: endpoint.hostname,
    port,
    path,
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
 * getJobCardList — Recupera lista JobCard per VIN, dealer, market.
 * @param {{VIN: string, dealerCode: string, market: string}} params
 */
async function getJobCardList(params) {
  // Valida i campi obbligatori: VIN, dealerCode, market
  const required = ['VIN', 'dealerCode', 'market'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getJobCardList] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    VIN: params.VIN,
    dealerCode: params.dealerCode,
    market: params.market,
  };

  // Log: informa che verrà recuperata la lista JobCard per il VIN specificato
  console.log(`[getJobCardList] Recupero lista JobCard per VIN=${params.VIN}, dealer=${params.dealerCode}, market=${params.market}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getJobCardList', payload);
}

/**
 * associateJobCard — Associa JobCard a Ticket.
 * @param {{JobCardId: string, TicketId: string}} params
 */
async function associateJobCard(params) {
  // Valida i campi obbligatori: JobCardId, TicketId
  const required = ['JobCardId', 'TicketId'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[associateJobCard] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    JobCardId: params.JobCardId,
    TicketId: params.TicketId,
  };

  // Log di inizio esecuzione
  console.log(`[associateJobCard] Inizio associazione JobCard ${params.JobCardId} a ticket ${params.TicketId}`);

  // Esecuzione
  // Log: informa che verrà associato il JobCard al Ticket specificato
  console.log(`[associateJobCard] Associazione JobCard=${params.JobCardId} a Ticket=${params.TicketId}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/associateJobCard', payload);
}

/**
 * getJobCardAndDocumentList — Recupera sia JobCard che lista Documenti.
 * @param {{JobCardId: string}} params
 */
async function getJobCardAndDocumentList(params) {
  // Valida il campo obbligatorio: JobCardId
  const required = ['JobCardId'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getJobCardAndDocumentList] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con il parametro obbligatorio
  const payload = {
    JobCardId: params.JobCardId,
  };

  // Log di inizio esecuzione
  console.log(`[getJobCardAndDocumentList] Inizio recupero job card e documenti per JobCardId: ${params.JobCardId}`);

  // Esecuzione
  // Log: informa che verrà recuperata sia la JobCard che i documenti associati
  console.log(`[getJobCardAndDocumentList] Recupero JobCard e Documenti per JobCardId=${params.JobCardId}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getJobCardAndDocumentList', payload);
}

/**
 * getDocumentsInfo — Ottiene informazioni dettagliate su documenti specifici.
 * @param {{DocumentIds: string[]}} params
 */
async function getDocumentsInfo(params) {
  // Valida il campo obbligatorio: DocumentIds
  const required = ['DocumentIds'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getDocumentsInfo] Missing required field(s): ${missing.join(', ')}`);
  }

  // Convalida che DocumentIds sia un array non vuoto
  if (!Array.isArray(params.DocumentIds) || params.DocumentIds.length === 0) {
    throw new Error(`[getDocumentsInfo] DocumentIds deve essere un array non vuoto`);
  }

  // Costruisce il payload
  // Costruisce il payload della richiesta con il parametro obbligatorio
  const payload = {
    DocumentIds: params.DocumentIds,
  };

  // Log di inizio esecuzione
  console.log(`[getDocumentsInfo] Inizio recupero info per ${params.DocumentIds.length} documento(i)`);

  // Esecuzione
  // Log: informa che verranno recuperate le informazioni dei documenti specificati
  console.log(`[getDocumentsInfo] Recupero info per Documenti: ${JSON.stringify(params.DocumentIds)}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getDocumentsInfo', payload);
}

/**
 * associateDocument — Associa documento a Ticket.
 * @param {{DocumentId: string, TicketId: string}} params
 */
async function associateDocument(params) {
  // Valida i campi obbligatori: DocumentId, TicketId
  const required = ['DocumentId', 'TicketId'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[associateDocument] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    DocumentId: params.DocumentId,
    TicketId: params.TicketId,
  };

  // Log di inizio esecuzione
  console.log(`[associateDocument] Inizio associazione documento ${params.DocumentId} a ticket ${params.TicketId}`);

  // Esecuzione
  // Log: informa che verrà associato il documento al Ticket specificato
  console.log(`[associateDocument] Associazione Documento=${params.DocumentId} a Ticket=${params.TicketId}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/associateDocument', payload);
}

/**
 * getDocuments — Recupera lista documenti associati a JobCard.
 * @param {{JobCardId: string}} params
 */
async function getDocuments(params) {
  // Valida il campo obbligatorio: JobCardId
  const required = ['JobCardId'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getDocuments] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con il parametro obbligatorio
  const payload = {
    JobCardId: params.JobCardId,
  };

  // Log di inizio esecuzione
  console.log(`[getDocuments] Inizio recupero documenti per JobCardId: ${params.JobCardId}`);

  // Esecuzione
  // Log: informa che verranno recuperati i documenti associati alla JobCard
  console.log(`[getDocuments] Recupero Documenti per JobCardId=${params.JobCardId}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getDocuments', payload);
}

/**
 * DeleteDocuments — Cancella documenti specifici.
 * @param {{DocumentIds: string[]}} params
 */
async function DeleteDocuments(params) {
  // Valida il campo obbligatorio: DocumentIds
  const required = ['DocumentIds'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[DeleteDocuments] Missing required field(s): ${missing.join(', ')}`);
  }

  // Convalida che DocumentIds sia un array non vuoto
  if (!Array.isArray(params.DocumentIds) || params.DocumentIds.length === 0) {
    throw new Error(`[DeleteDocuments] DocumentIds deve essere un array non vuoto`);
  }

  // Costruisce il payload
  // Costruisce il payload della richiesta con il parametro obbligatorio
  const payload = {
    DocumentIds: params.DocumentIds,
  };

  // Log di inizio esecuzione
  console.log(`[DeleteDocuments] Inizio eliminazione ${params.DocumentIds.length} documento(i)`);

  // Esecuzione
  // Log: informa che verranno cancellati i documenti specificati
  console.log(`[DeleteDocuments] Cancellazione Documenti: ${JSON.stringify(params.DocumentIds)}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/DeleteDocuments', payload);
}

/**
 * DeleteJobcard — Cancella una JobCard.
 * @param {{JobCardId: string}} params
 */
async function DeleteJobcard(params) {
  // Valida il campo obbligatorio: JobCardId
  const required = ['JobCardId'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[DeleteJobcard] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con il parametro obbligatorio
  const payload = {
    JobCardId: params.JobCardId,
  };

  // Log di inizio esecuzione
  console.log(`[DeleteJobcard] Inizio eliminazione JobCard: ${params.JobCardId}`);

  // Esecuzione
  // Log: informa che verrà cancellata la JobCard specificata
  console.log(`[DeleteJobcard] Cancellazione JobCard=${params.JobCardId}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/DeleteJobcard', payload);
}

/**
 * getDocumentsDownloadUrl — Ottiene la URL pre-firmata per il download di documenti.
 * @param {{DocumentId: string, AccessToken: string}} params
 */
async function getDocumentsDownloadUrl(params) {
  // Valida i campi obbligatori: DocumentId, AccessToken
  const required = ['DocumentId', 'AccessToken'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getDocumentsDownloadUrl] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    DocumentId: params.DocumentId,
    AccessToken: params.AccessToken,
  };

  // Log di inizio esecuzione
  console.log(`[getDocumentsDownloadUrl] Inizio recupero URL download per documento: ${params.DocumentId}`);

  // Esecuzione
  return postJson(config.moparDocsServices, '/getDocumentsDownloadUrl', payload);
  // Log: informa che verrà generata la URL di download per il documento
  console.log(`[getDocumentsDownloadUrl] Generazione URL di download per Documento ${params.DocumentId}`);
  
  // Effettua la richiesta POST al servizio MoparDocs Browser API e ritorna il risultato
  return postJson(config.moparDocsApi, '/getDocumentsDownloadUrl', payload);
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
