'use strict';

/**
 * moparDocService.js — Chiamate downstream verso i tre gateway MoparDoc:
 *  - job-docs connector (api-oidc-preprod.groupe-psa.com): CreateJobCard, CreateAccessToken
 *  - MoparDocs Browser API (lab-examaftersales.fiat.com): getUploadDocURL, UploadedDoc
 *  - MoparDocs Services API (stellantis.com): getJobCardList, getJobCardAndDocumentList, 
 *    getDocumentsInfo, getDocuments, DeleteDocuments, DeleteJobcard, getDocumentsDownloadUrl
 *
 * Tutte le chiamate condividono lo stesso PingFederate (authService.getBearerToken) 
 * e le stesse credenziali IBM API Connect (X-IBM-Client-Id / X-IBM-Client-Secret), 
 * ma usano host diversi a seconda del servizio.
 */

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getBearerToken } = require('./authService');
const { getConfig } = require('./config');

/**
 * Costruisce le options per una richiesta POST JSON verso uno dei gateway.
 * @param {{baseUrl: string, basePath: string, ibmClientId: string, ibmClientSecret: string}} target
 * @param {string} resourcePath - es. "/CreateJobCard"
 * @param {string} bearerToken - token Bearer (ignorato se noAuth = true)
 * @param {string} bodyStr
 * @param {{noAuth?: boolean}} [opts] - se noAuth = true, non aggiunge Authorization né header IBM
 */
function buildOptions(target, resourcePath, bearerToken, bodyStr, opts = {}) {
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

  // Header di base sempre presenti
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr),
  };

  // Aggiunge autenticazione (Bearer + credenziali IBM) solo se richiesto.
  // Gli endpoint browser (getUploadDocURL/UploadedDoc) sono invocati senza autenticazione.
  if (!opts.noAuth) {
    headers.Authorization = `Bearer ${bearerToken}`;
    headers['X-IBM-Client-Id'] = target.ibmClientId;
    headers['X-IBM-Client-Secret'] = target.ibmClientSecret;
  }

  return {
    hostname: endpoint.hostname,
    port,
    path,
    method: 'POST',
    headers,
  };
}

async function postJson(targetName, resourcePath, payload, opts = {}) {
  // Risolve la configurazione (credenziali da SSM/Secrets Manager o .env)
  const config = await getConfig();
  // Seleziona il target di destinazione per nome (jobDocs | moparDocsApi | moparDocsServices)
  const target = config[targetName];
  // Recupera il token Bearer solo se la chiamata richiede autenticazione
  const bearerToken = opts.noAuth ? null : await getBearerToken();
  const bodyStr = JSON.stringify(payload);
  const options = buildOptions(target, resourcePath, bearerToken, bodyStr, opts);

  console.log(`[moparDocService] POST ${target.baseUrl}${options.path}`);
  const response = await httpsRequest(options, bodyStr);

  // Errore a livello di trasporto HTTP (status non 2xx)
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `[moparDocService] ${resourcePath} failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  // Errore applicativo: il servizio MoparDocs risponde HTTP 200 ma segnala il fallimento
  // tramite errorCode diverso da 0 (0 = SUCCESS, <>0 = FAILURE come da documentazione)
  const body = response.body;
  if (body && typeof body === 'object' && body.errorCode !== undefined && Number(body.errorCode) !== 0) {
    throw new Error(
      `[moparDocService] ${resourcePath} failed: errorCode ${body.errorCode} - ${body.errorMessage || 'errore applicativo'}`
    );
  }

  return body;
}

/**
 * CreateJobCard — crea una job card sul connector job-docs (PSA).
 * TAMAccessCode non è più un parametro del body: viene caricato dalla configurazione (secret / .env).
 * @param {{vin: string, market: string, source: string, UserName: string, dealerCode: string, JobCard_Title: string}} params
 */
async function createJobCard(params) {
  // Rimosso TAMAccessCode dai campi obbligatori: ora proviene dalla configurazione, non dal body
  const required = ['vin', 'market', 'source', 'UserName', 'dealerCode', 'JobCard_Title'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[createJobCard] Missing required field(s): ${missing.join(', ')}`);
  }

  // Recupera la configurazione (credenziali e codici di accesso dal secret / .env); eventuali errori si propagano al chiamante
  const config = await getConfig();

  // Log: costruzione payload — NON stampa mai il valore del codice TAM
  console.log('[createJobCard] Costruzione payload CreateJobCard; TAMAccessCode caricato dalla configurazione');

  const payload = {
    vin: params.vin,
    market: params.market,
    source: params.source,
    UserName: params.UserName,
    dealerCode: params.dealerCode,
    JobCard_Title: params.JobCard_Title,
    TAMAccessCode: config.jobDocs.tamAccessCode, // Valore dal secret; eventuale params.TAMAccessCode ignorato
  };

  return postJson('jobDocs', '/CreateJobCard', payload);
}

/**
 * CreateAccessToken — ottiene un APIAccessCode/AccessToken per una job card
 * già creata (necessario per autenticare getUploadDocURL/uploadedDoc verso
 * MoparDocs Browser API). Stesso connector job-docs (PSA) di createJobCard.
 * APIAccessCode non è più un parametro di input: proviene dalla configurazione (secret).
 * @param {{JobCardId: string, UserName: string, dealerCode: string, market: string}} params
 */
async function createAccessToken(params) {
  // Rimosso APIAccessCode dai campi obbligatori: ora proviene dalla configurazione, non dal body
  const required = ['JobCardId', 'UserName', 'dealerCode', 'market'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[createAccessToken] Missing required field(s): ${missing.join(', ')}`);
  }

  // Recupera la configurazione (credenziali e codici di accesso dal secret / .env); eventuali errori si propagano
  const config = await getConfig();

  // Log: costruzione payload — NON stampa mai il valore del codice API
  console.log('[createAccessToken] Costruzione payload CreateAccessToken; APIAccessCode caricato dalla configurazione');

  const payload = {
    JobCardId: params.JobCardId,
    UserName: params.UserName,
    dealerCode: params.dealerCode,
    market: params.market,
    APIAccessCode: config.jobDocs.apiAccessCode, // Valore dal secret; eventuale params.APIAccessCode ignorato
  };

  return postJson('jobDocs', '/CreateAccessToken', payload);
}

/**
 * getUploadDocURL — ottiene la URL pre-firmata per l'upload di un documento.
 * Endpoint browser (examaftersales.fiat.com) senza autenticazione.
 * @param {{JobCardId: string, Filename: string, Size: string|number, ContentType: string, AccessToken: string, Filetype: string}} params
 */
async function getUploadDocURL(params) {
  const required = ['JobCardId', 'Filename', 'Size', 'ContentType', 'AccessToken', 'Filetype'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getUploadDocURL] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    JobCardId: params.JobCardId,
    Filename: params.Filename,
    Size: params.Size,
    ContentType: params.ContentType,
    AccessToken: params.AccessToken,
    Filetype: params.Filetype,
  };

  // Chiamata senza autenticazione (endpoint browser MoparDocs)
  return postJson('moparDocsApi', '/getUploadDocURL', payload, { noAuth: true });
}

/**
 * UploadedDoc — notifica il completamento dell'upload di un documento.
 * Endpoint browser (examaftersales.fiat.com) senza autenticazione.
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

  // Chiamata senza autenticazione (endpoint browser MoparDocs)
  return postJson('moparDocsApi', '/UploadedDoc', payload, { noAuth: true });
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
  return postJson('moparDocsServices', '/getJobCardList', payload);
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
  return postJson('moparDocsServices', '/getJobCardAndDocumentList', payload);
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
  return postJson('moparDocsServices', '/getDocumentsInfo', payload);
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
  return postJson('moparDocsServices', '/getDocuments', payload);
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
  return postJson('moparDocsServices', '/DeleteDocuments', payload);
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
  return postJson('moparDocsServices', '/DeleteJobcard', payload);
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

  // Effettua la richiesta POST al servizio MoparDocs Services e ritorna il risultato.
  // NOTA: questo endpoint non risulta esposto sul gateway IBM job-docs/connector/v1 (HTTP 404).
  // In alternativa usare getDocumentsInfo, che restituisce gli stessi signedUrl/previewUrl.
  return postJson('moparDocsServices', '/getDocumentsDownloadUrl', payload);
}

module.exports = {
  createJobCard,
  createAccessToken,
  getUploadDocURL,
  uploadedDoc,
  getJobCardList,
  getJobCardAndDocumentList,
  getDocumentsInfo,
  getDocuments,
  DeleteDocuments,
  DeleteJobcard,
  getDocumentsDownloadUrl,
};
