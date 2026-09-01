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
 * @param {{source: string, vin: string, dealerCode?: string, rrdi?: string, market: string}} params
 */
async function getJobCardList(params) {
  // Valida i campi obbligatori: source, vin, market
  const required = ['source', 'vin', 'market'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getJobCardList] Missing required field(s): ${missing.join(', ')}`);
  }
  // Valida che sia presente almeno dealerCode o rrdi
  if (!params.dealerCode && !params.rrdi) {
    throw new Error('[getJobCardList] Missing required field(s): dealerCode or rrdi');
  }

  // Costruisce il payload con i campi obbligatori e opzionali
  const payload = {
    source: params.source,
    vin: params.vin,
    market: params.market,
  };
  // Aggiunge dealerCode o rrdi in base a quale è presente (dealerCode ha priorità)
  if (params.dealerCode) payload.dealerCode = params.dealerCode;
  else payload.rrdi = params.rrdi;

  // Log: informa che verrà recuperata la lista JobCard per il VIN specificato
  console.log(`[getJobCardList] Recupero lista JobCard per VIN=${params.vin}, dealer=${params.dealerCode || params.rrdi}, market=${params.market}`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getJobCardList', payload);
}

/**
 * associateJobCard — Associa JobCard a Ticket.
 * @param {{source: string, Ticket: string, Type: string, JobCardId: string|number}} params
 */
async function associateJobCard(params) {
  // Valida i campi obbligatori: source, Ticket, Type, JobCardId
  const required = ['source', 'Ticket', 'Type', 'JobCardId'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[associateJobCard] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    source: params.source,
    JobCardId: params.JobCardId,
    Ticket: params.Ticket,
    Type: params.Type,
  };

  // Log: informa che verrà associato il JobCard al Ticket specificato
  console.log(`[associateJobCard] Associazione JobCard=${params.JobCardId} a Ticket=${params.Ticket} (Type=${params.Type}, source=${params.source})`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/associateJobCard', payload);
}

/**
 * getJobCardAndDocumentList — Recupera sia JobCard che lista Documenti.
 * @param {{source: string, vin: string, dealerCode?: string, rrdi?: string, market: string, Language: string, StartDate: string}} params
 */
async function getJobCardAndDocumentList(params) {
  // Valida i campi obbligatori: source, vin, market, Language, StartDate
  const required = ['source', 'vin', 'market', 'Language', 'StartDate'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getJobCardAndDocumentList] Missing required field(s): ${missing.join(', ')}`);
  }
  // Valida che sia presente almeno dealerCode o rrdi
  if (!params.dealerCode && !params.rrdi) {
    throw new Error('[getJobCardAndDocumentList] Missing required field(s): dealerCode or rrdi');
  }

  // Costruisce il payload con i campi obbligatori
  const payload = {
    source: params.source,
    vin: params.vin,
    market: params.market,
    language: params.Language,
    startdate: params.StartDate,
  };
  // Aggiunge dealerCode o rrdi in base a quale è presente (dealerCode ha priorità)
  if (params.dealerCode) payload.dealerCode = params.dealerCode;
  else payload.rrdi = params.rrdi;

  // Log: informa che verrà recuperata sia la JobCard che i documenti associati
  console.log(`[getJobCardAndDocumentList] Recupero JobCard e Documenti per VIN=${params.vin}, dealer=${params.dealerCode || params.rrdi}, market=${params.market}`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getJobCardAndDocumentList', payload);
}

/**
 * getDocumentsInfo — Ottiene informazioni dettagliate su documenti specifici.
 * @param {{source: string, Language: string, DocumentIDList: number[]}} params
 */
async function getDocumentsInfo(params) {
  // Valida i campi obbligatori: source, Language, DocumentIDList
  const required = ['source', 'Language', 'DocumentIDList'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getDocumentsInfo] Missing required field(s): ${missing.join(', ')}`);
  }
  // Convalida che DocumentIDList sia un array non vuoto
  if (!Array.isArray(params.DocumentIDList) || params.DocumentIDList.length === 0) {
    throw new Error('[getDocumentsInfo] DocumentIDList deve essere un array non vuoto');
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    source: params.source,
    language: params.Language,
    DocumentIDList: params.DocumentIDList,
  };

  // Log: informa che verranno recuperate le informazioni dei documenti specificati
  console.log(`[getDocumentsInfo] Recupero info per ${params.DocumentIDList.length} documento(i): ${JSON.stringify(params.DocumentIDList)}`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getDocumentsInfo', payload);
}

/**
 * associateDocument — Associa documento a Ticket.
 * @param {{source: string, Ticket: string, Documents: Array<{DocumentId: string|number, AssociateOperation: boolean, DealerVisibility?: boolean}>}} params
 */
async function associateDocument(params) {
  // Valida i campi obbligatori: source, Ticket, Documents
  const required = ['source', 'Ticket', 'Documents'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[associateDocument] Missing required field(s): ${missing.join(', ')}`);
  }
  // Valida che Documents sia un array non vuoto
  if (!Array.isArray(params.Documents) || params.Documents.length === 0) {
    throw new Error('[associateDocument] Documents deve essere un array non vuoto');
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    source: params.source,
    Ticket: params.Ticket,
    Documents: params.Documents,
  };

  // Log: informa che verrà associato il documento al Ticket specificato
  console.log(`[associateDocument] Associazione ${params.Documents.length} documento(i) a Ticket=${params.Ticket} (source=${params.source})`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/associateDocument', payload);
}

/**
 * getDocuments — Recupera lista documenti associati a JobCard.
 * @param {{vin: string, JobCardIds?: number[]}} params
 */
async function getDocuments(params) {
  // Valida il campo obbligatorio: vin
  const required = ['vin'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getDocuments] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con i parametri obbligatori
  const payload = { vin: params.vin };
  // Aggiunge JobCardIds solo se presente (campo opzionale)
  if (params.JobCardIds) payload.JobCardIds = params.JobCardIds;

  // Log: informa che verranno recuperati i documenti per il VIN specificato
  console.log(`[getDocuments] Recupero Documenti per VIN=${params.vin}${params.JobCardIds ? `, JobCardIds=${JSON.stringify(params.JobCardIds)}` : ''}`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/getDocuments', payload);
}

/**
 * DeleteDocuments — Cancella documenti specifici.
 * @param {{source: string, JobCardId: number, Documents: number[]}} params
 */
async function DeleteDocuments(params) {
  // Valida i campi obbligatori: source, JobCardId, Documents
  const required = ['source', 'JobCardId', 'Documents'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[DeleteDocuments] Missing required field(s): ${missing.join(', ')}`);
  }
  // Convalida che Documents sia un array non vuoto
  if (!Array.isArray(params.Documents) || params.Documents.length === 0) {
    throw new Error('[DeleteDocuments] Documents deve essere un array non vuoto');
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    source: params.source,
    JobCardId: params.JobCardId,
    Documents: params.Documents,
  };

  // Log: informa che verranno cancellati i documenti specificati
  console.log(`[DeleteDocuments] Cancellazione ${params.Documents.length} documento(i) dalla JobCard=${params.JobCardId} (source=${params.source})`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/DeleteDocuments', payload);
}

/**
 * DeleteJobcard — Cancella una JobCard.
 * @param {{Source: string, JobCardId: number}} params
 */
async function DeleteJobcard(params) {
  // Valida i campi obbligatori: Source, JobCardId
  const required = ['Source', 'JobCardId'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[DeleteJobcard] Missing required field(s): ${missing.join(', ')}`);
  }

  // Costruisce il payload della richiesta con tutti i parametri obbligatori
  const payload = {
    Source: params.Source,
    JobCardId: params.JobCardId,
  };

  // Log: informa che verrà cancellata la JobCard specificata
  console.log(`[DeleteJobcard] Cancellazione JobCard=${params.JobCardId} (Source=${params.Source})`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
  return postJson(config.moparDocsServices, '/DeleteJobcard', payload);
}

/**
 * getDocumentsDownloadUrl — Ottiene la URL pre-firmata per il download di documenti.
 * @param {{DocumentIDList: number[]}} params
 */
async function getDocumentsDownloadUrl(params) {
  // Valida il campo obbligatorio: DocumentIDList
  const required = ['DocumentIDList'];
  // Filtra i campi mancanti dall'array required
  const missing = required.filter((k) => !params || !params[k]);
  // Se mancano campi obbligatori, lancia un errore con la lista dei campi mancanti
  if (missing.length > 0) {
    throw new Error(`[getDocumentsDownloadUrl] Missing required field(s): ${missing.join(', ')}`);
  }
  // Convalida che DocumentIDList sia un array non vuoto
  if (!Array.isArray(params.DocumentIDList) || params.DocumentIDList.length === 0) {
    throw new Error('[getDocumentsDownloadUrl] DocumentIDList deve essere un array non vuoto');
  }

  // Costruisce il payload della richiesta con il parametro obbligatorio
  const payload = {
    DocumentIDList: params.DocumentIDList,
  };

  // Log: informa che verrà generata la URL di download per i documenti
  console.log(`[getDocumentsDownloadUrl] Generazione URL download per ${params.DocumentIDList.length} documento(i)`);

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato
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
