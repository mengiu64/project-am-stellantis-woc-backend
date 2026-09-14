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

/**
 * deleteDocumentsByVin — Azione accorpata: cancella uno o piu' documenti Mopar di un veicolo
 * fornendo solo { source, vin, Documents }, senza conoscere il JobCardId numerico reale.
 * Orchestra internamente getDocuments (per risolvere il JobCardId) e DeleteDocuments.
 * Gli errori del client (input non valido, jobCardList vuota, ID non trovati, documenti su job card
 * diverse) portano statusCode 400; gli Upstream_Failure propagati da getDocuments/DeleteDocuments
 * non impostano statusCode e verranno mappati a 502 dall'handler; le cause realmente impreviste
 * vengono avvolte in un Error con statusCode 500.
 * @param {{source: string, vin: string, Documents: number[]}} params
 */
async function deleteDocumentsByVin(params) {
  // Definisce i campi obbligatori attesi nell'input della nuova azione
  const required = ['source', 'vin', 'Documents'];
  // Filtra i campi mancanti o non valorizzati dall'array required (params puo' essere undefined)
  const missing = required.filter((k) => !params || !params[k]);
  // Se manca almeno un campo obbligatorio, prepara il messaggio d'errore con l'elenco dei campi mancanti
  if (missing.length > 0) {
    // Costruisce un Error dedicato con il testo "Missing required field(s)" e i campi mancanti
    const e = new Error(`[deleteDocumentsByVin] Missing required field(s): ${missing.join(', ')}`);
    // Marca l'errore come errore del client (input non valido) impostando statusCode 400
    e.statusCode = 400;
    // Interrompe l'esecuzione lanciando l'errore, senza effettuare alcuna chiamata upstream
    throw e;
  }

  // Convalida che Documents sia effettivamente un array e che non sia vuoto
  if (!Array.isArray(params.Documents) || params.Documents.length === 0) {
    // Costruisce un Error dedicato che indica il vincolo su Documents (array non vuoto)
    const e = new Error('[deleteDocumentsByVin] Documents deve essere un array non vuoto');
    // Marca l'errore come errore del client (input non valido) impostando statusCode 400
    e.statusCode = 400;
    // Interrompe l'esecuzione lanciando l'errore, senza effettuare alcuna chiamata upstream
    throw e;
  }

  // Ignora esplicitamente un eventuale campo JobCardId nell'input: NON viene letto ne' usato.
  // Il JobCardId reale sara' risolto dai dati restituiti da getDocuments (fasi successive).

  // Log della ricezione richiesta con soli metadati non sensibili: VIN e numero di documenti richiesti
  // (nessun token, credenziale o URL firmato viene mai stampato)
  console.log(`[deleteDocumentsByVin] Richiesta ricevuta: VIN=${params.vin}, numeroDocumenti=${params.Documents.length}`);

  // Avvolge l'orchestrazione (dal recupero JobCardList in poi) in un try/catch esterno per il mapping degli errori
  try {
    // Log: sta per essere invocata getDocuments per risolvere i JobCardId reali associati al VIN
    console.log(`[deleteDocumentsByVin] Invocazione getDocuments per VIN=${params.vin} (riuso azione esistente, nessuna chiamata HTTP diretta)`);
    // Riusa la funzione esistente getDocuments passando solo { vin }; eventuali Upstream_Failure si propagano al catch esterno
    const documentsResult = await getDocuments({ vin: params.vin });
    // Estrae la jobCardList dall'esito di getDocuments (shape: { errorCode, errorMessage, jobCardList })
    const jobCardList = documentsResult && documentsResult.jobCardList;
    // Log dell'esito di getDocuments con soli metadati non sensibili: numero di job card trovate
    console.log(`[deleteDocumentsByVin] Esito getDocuments: jobCard trovate=${Array.isArray(jobCardList) ? jobCardList.length : 0}`);

    // Verifica che la jobCardList sia presente e non vuota: senza job card non e' possibile risolvere alcun JobCardId
    if (!Array.isArray(jobCardList) || jobCardList.length === 0) {
      // Log della condizione di errore: nessuna job card trovata per il VIN richiesto
      console.log(`[deleteDocumentsByVin] Nessuna job card trovata per il VIN=${params.vin}`);
      // Costruisce un Error dedicato che indica l'assenza di job card per il VIN
      const e = new Error(`[deleteDocumentsByVin] Nessuna job card trovata per il VIN ${params.vin}`);
      // Marca l'errore come errore del client (dati incoerenti rispetto al VIN) impostando statusCode 400
      e.statusCode = 400;
      // Interrompe l'esecuzione lanciando l'errore, senza procedere alla risoluzione dei documenti
      throw e;
    }

    // Inizializza la mappa che associa ogni Document_ID reale al JobCardId della job card che lo contiene
    const documentToJobCard = new Map();
    // Scorre ogni job card presente nella jobCardList restituita da getDocuments
    for (const jobCard of jobCardList) {
      // Estrae la DocumentList della job card corrente, garantendo un array anche se il campo e' assente
      const documentList = Array.isArray(jobCard && jobCard.DocumentList) ? jobCard.DocumentList : [];
      // Scorre ogni documento della DocumentList della job card corrente
      for (const document of documentList) {
        // Considera solo i documenti che espongono un campo ID valorizzato (identificativo del documento)
        if (document && document.ID !== undefined && document.ID !== null) {
          // Registra nella mappa l'associazione Document_ID -> JobCardId della job card contenitrice
          documentToJobCard.set(document.ID, jobCard.JobCardId);
        }
      }
    }

    // Log della risoluzione (mapping): stampa solo la coppia Document_ID->JobCardId, senza mai esporre signedUrl/previewUrl
    console.log(`[deleteDocumentsByVin] Mappa Document_ID->JobCardId risolta: ${JSON.stringify(Object.fromEntries(documentToJobCard))}`);

    // Accumula i Document_ID richiesti che non risultano presenti in alcuna DocumentList del VIN (documenti mancanti)
    const missingDocuments = params.Documents.filter((documentId) => !documentToJobCard.has(documentId));

    // Se esiste almeno un Document_ID richiesto non trovato, la richiesta e' incoerente rispetto ai dati del VIN
    if (missingDocuments.length > 0) {
      // Log della condizione di errore: elenca gli specifici Document_ID non trovati (nessun URL firmato coinvolto)
      console.log(`[deleteDocumentsByVin] Document ID non trovati per il VIN=${params.vin}: ${JSON.stringify(missingDocuments)}`);
      // Costruisce un Error dedicato che elenca esplicitamente i Document_ID non trovati per il VIN
      const e = new Error(`[deleteDocumentsByVin] Document ID non trovati per il VIN: [${missingDocuments.join(', ')}]`);
      // Marca l'errore come errore del client (documenti richiesti inesistenti) impostando statusCode 400
      e.statusCode = 400;
      // Interrompe l'esecuzione lanciando l'errore, senza invocare DeleteDocuments (nessuna cancellazione)
      throw e;
    }

    // Costruisce la ripartizione Document_ID->JobCardId limitata ai soli Document_ID effettivamente richiesti
    const requestedPartition = params.Documents.map((documentId) => [documentId, documentToJobCard.get(documentId)]);
    // Calcola l'insieme dei JobCardId distinti coinvolti dai Document_ID richiesti (deduplica tramite Set)
    const distinctJobCardIds = new Set(requestedPartition.map(([, jobCardId]) => jobCardId));

    // Log della verifica del vincolo: numero di JobCardId distinti coinvolti dai documenti richiesti
    console.log(`[deleteDocumentsByVin] Verifica vincolo stessa job card: JobCardId distinti coinvolti=${distinctJobCardIds.size}`);

    // Se i documenti richiesti appartengono a piu' di una job card, il vincolo "stessa job card" e' violato
    if (distinctJobCardIds.size > 1) {
      // Costruisce l'oggetto di ripartizione Document_ID->JobCardId da includere nel messaggio d'errore (nessun URL firmato)
      const partition = Object.fromEntries(requestedPartition);
      // Log della condizione di errore: i documenti coprono job card diverse, con la relativa ripartizione
      console.log(`[deleteDocumentsByVin] Documenti su job card diverse; ripartizione=${JSON.stringify(partition)}`);
      // Costruisce un Error dedicato che indica il vincolo violato e riporta la ripartizione Document_ID->JobCardId
      const e = new Error(`[deleteDocumentsByVin] Tutti i documenti devono appartenere alla stessa job card. Ripartizione: ${JSON.stringify(partition)}`);
      // Marca l'errore come errore del client (richiesta incoerente rispetto ai dati del VIN) impostando statusCode 400
      e.statusCode = 400;
      // Interrompe l'esecuzione lanciando l'errore, senza invocare DeleteDocuments (nessuna cancellazione parziale)
      throw e;
    }

    // Risolve l'unico JobCardId a cui appartengono tutti i documenti richiesti (primo ed unico elemento del Set)
    const JobCardId = distinctJobCardIds.values().next().value;

    // Log: sta per essere invocata DeleteDocuments una sola volta con il JobCardId risolto (mai quello passato in input)
    console.log(`[deleteDocumentsByVin] Invocazione DeleteDocuments: JobCardId risolto=${JobCardId}, numeroDocumenti=${params.Documents.length} (source=${params.source})`);
    // Riusa la funzione esistente DeleteDocuments esattamente una volta con { source, JobCardId risolto, Documents }; eventuali Upstream_Failure si propagano al catch esterno
    const result = await DeleteDocuments({ source: params.source, JobCardId, Documents: params.Documents });
    // Log dell'esito di DeleteDocuments con soli metadati non sensibili: JobCardId risolto ed errorCode restituito dall'upstream
    console.log(`[deleteDocumentsByVin] Esito DeleteDocuments: JobCardId=${JobCardId}, errorCode=${result && result.errorCode !== undefined ? result.errorCode : 'n/d'}`);

    // Ritorna l'oggetto di successo con il JobCardId risolto, i documenti cancellati e l'esito grezzo dell'upstream
    return { success: true, JobCardId, deleted: params.Documents, result };
  } catch (err) {
    // Gli Error del client gia' classificati (statusCode 400 impostato nelle fasi 1.1-1.4) vanno rilanciati invariati
    if (err && typeof err.statusCode === 'number') {
      // Rilancia l'errore del client cosi' com'e', preservando statusCode e messaggio originali (es. 400)
      throw err;
    }
    // Gli Upstream_Failure propagati da getDocuments/DeleteDocuments hanno messaggio con prefisso "[moparDocService]" e nessuno statusCode
    if (err && typeof err.message === 'string' && err.message.startsWith('[moparDocService]')) {
      // Rilancia invariato l'errore upstream (senza statusCode): sara' mappato a 502 dall'handler
      throw err;
    }
    // Ogni altra causa e' realmente imprevista: la si avvolge in un Error dedicato per non propagare eccezioni non gestite
    const wrapped = new Error(`[deleteDocumentsByVin] Errore imprevisto: ${err && err.message ? err.message : err}`);
    // Marca l'errore imprevisto con statusCode 500 (errore interno) per il mapping dell'handler
    wrapped.statusCode = 500;
    // Rilancia l'errore avvolto affinche' l'handler risponda con 500 senza propagare l'eccezione originale
    throw wrapped;
  }
}

/**
 * httpsPutBinary — Esegue una PUT del contenuto binario verso una URL pre-firmata (S3).
 * NON usa httpClient.js (condiviso e pensato per JSON): qui serve inviare Buffer grezzi
 * senza serializzazione JSON e con Content-Type arbitrario, quindi si usa direttamente https.
 * @param {string} presignedUrl - URL pre-firmata S3 restituita da getUploadDocURL
 * @param {Buffer} buffer - contenuto binario del file da caricare
 * @param {string} contentType - MIME type del file (es. image/jpeg)
 * @returns {Promise<{statusCode:number, body:string}>}
 */
function httpsPutBinary(presignedUrl, buffer, contentType) {
  // Importa i moduli core solo qui dentro per non toccare gli import esistenti in cima al file
  const https = require('https'); // Client HTTPS nativo di Node
  const { URL } = require('url'); // Parser URL nativo (gia' usato altrove nel modulo)

  // Ritorna una Promise perche' https.request e' basato su callback/eventi
  return new Promise((resolve, reject) => {
    // Prova a interpretare la URL pre-firmata; se malformata rigetta subito con errore descrittivo
    let target;
    try {
      target = new URL(presignedUrl); // Effettua il parsing della URL pre-firmata
    } catch (e) {
      // URL non valida: rigetta con un messaggio chiaro
      return reject(new Error(`[httpsPutBinary] URL pre-firmata non valida: ${e.message}`));
    }

    // Costruisce le options della richiesta PUT verso S3
    const options = {
      hostname: target.hostname, // Host della URL pre-firmata
      port: target.port || 443, // Porta (443 di default per https)
      path: `${target.pathname}${target.search}`, // Path + querystring (la firma S3 vive nella querystring)
      method: 'PUT', // Metodo richiesto per l'upload su URL pre-firmata
      headers: {
        'Content-Type': contentType, // Content-Type del binario caricato
        'Content-Length': buffer.length, // Lunghezza esatta del contenuto binario
      },
    };

    // Log della richiesta PUT: NON logga la querystring (contiene la firma S3), solo host e path base
    console.log(`[httpsPutBinary] PUT ${target.protocol}//${target.hostname}${target.pathname} (Content-Type=${contentType}, bytes=${buffer.length})`);

    // Crea la richiesta HTTPS
    const req = https.request(options, (res) => {
      // Accumula l'eventuale corpo della risposta (S3 in caso di errore restituisce un XML)
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk)); // Raccoglie i chunk di risposta
      res.on('end', () => {
        // Ricompone il corpo della risposta come stringa
        const respBody = Buffer.concat(chunks).toString('utf8');
        // Log dell'esito della PUT con solo lo status code (nessun dato sensibile)
        console.log(`[httpsPutBinary] Esito PUT: HTTP ${res.statusCode}`);
        // Considera successo qualunque 2xx
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Risolve con status e body
          resolve({ statusCode: res.statusCode, body: respBody });
        } else {
          // Errore di upload su S3: rigetta con status e corpo (troncato) per il troubleshooting
          reject(new Error(`[httpsPutBinary] Upload S3 fallito: HTTP ${res.statusCode} - ${respBody.slice(0, 500)}`));
        }
      });
    });

    // Gestione degli errori di trasporto (rete/DNS/TLS)
    req.on('error', (err) => {
      // Log dell'errore di trasporto
      console.error(`[httpsPutBinary] Errore di trasporto durante la PUT: ${err.message}`);
      // Rigetta la Promise propagando l'errore
      reject(err);
    });

    // Scrive il corpo binario e chiude la richiesta
    req.write(buffer); // Invia il Buffer come corpo della PUT
    req.end(); // Termina la richiesta
  });
}

/**
 * createJobCardAndUploadDocument — Azione accorpata esposta al front-end.
 * Orchestra in un'unica chiamata l'intero flusso di upload di un documento Mopar:
 *   1) createJobCard   -> ottiene JobCardId (+ AccessToken gia' utilizzabile)
 *   2) getUploadDocURL -> ottiene DocumentId + URL pre-firmata (S3)
 *   3) PUT del binario sulla URL pre-firmata (upload effettivo su S3)
 *   4) uploadedDoc     -> notifica il completamento dell'upload
 * NON modifica i metodi esistenti: li riusa cosi' come sono.
 *
 * @param {object} params
 * @param {string} params.vin              - VIN del veicolo (per createJobCard)
 * @param {string} params.market           - Mercato (es. "IT") (per createJobCard)
 * @param {string} params.source           - Sistema chiamante (es. "WOC") (per createJobCard)
 * @param {string} params.UserName         - Utente richiedente (per createJobCard)
 * @param {string} params.dealerCode       - Codice dealer (per createJobCard)
 * @param {string} params.JobCard_Title    - Titolo della job card (per createJobCard)
 * @param {string} params.Filename         - Nome del file da caricare (per getUploadDocURL)
 * @param {string} params.ContentType      - MIME type del file (es. "image/jpeg")
 * @param {string} params.Filetype         - Estensione/tipo file (es. "jpeg")
 * @param {string} params.FileContentBase64 - Contenuto del file codificato in Base64
 * @param {string|number} [params.Size]    - Dimensione in byte; se assente viene calcolata dal binario
 * @returns {Promise<object>} Riepilogo con JobCardId, DocumentId ed esiti dei singoli step
 */
async function createJobCardAndUploadDocument(params) {
  // Log di ingresso con soli metadati non sensibili (nessun contenuto file, nessun token)
  console.log(`[createJobCardAndUploadDocument] Avvio flusso accorpato: VIN=${params && params.vin}, Filename=${params && params.Filename}`);

  // Valida i campi obbligatori dell'intero flusso (unione dei required dei singoli step, escluso cio' che viene generato internamente)
  const required = ['vin', 'market', 'source', 'UserName', 'dealerCode', 'JobCard_Title', 'Filename', 'ContentType', 'Filetype', 'FileContentBase64'];
  // Calcola quali campi obbligatori mancano o sono vuoti
  const missing = required.filter((k) => !params || !params[k]);
  // Se manca almeno un campo obbligatorio, lancia un errore 400 (input non valido)
  if (missing.length > 0) {
    // Costruisce l'errore con il prefisso "Missing required field(s)" (coerente con gli altri metodi e con il mapping 400 dell'handler)
    const e = new Error(`[createJobCardAndUploadDocument] Missing required field(s): ${missing.join(', ')}`);
    // Marca esplicitamente l'errore come client-error (400)
    e.statusCode = 400;
    // Interrompe subito senza effettuare alcuna chiamata upstream
    throw e;
  }

  // Decodifica il contenuto del file da Base64 a Buffer binario
  let fileBuffer;
  try {
    // Converte la stringa Base64 nel Buffer effettivo da caricare su S3
    fileBuffer = Buffer.from(params.FileContentBase64, 'base64');
  } catch (e) {
    // Base64 non valido: errore 400
    const err = new Error(`[createJobCardAndUploadDocument] FileContentBase64 non valido: ${e.message}`);
    err.statusCode = 400;
    throw err;
  }
  // Verifica che il buffer decodificato non sia vuoto (Base64 malformato o file vuoto)
  if (!fileBuffer || fileBuffer.length === 0) {
    // Buffer vuoto: errore 400
    const err = new Error('[createJobCardAndUploadDocument] Il contenuto del file (FileContentBase64) risulta vuoto dopo la decodifica');
    err.statusCode = 400;
    throw err;
  }

  // Calcola la dimensione del file: usa params.Size se fornita, altrimenti la lunghezza del buffer decodificato
  const fileSize = (params.Size !== undefined && params.Size !== null && `${params.Size}` !== '')
    ? params.Size // Usa la dimensione dichiarata dal chiamante
    : fileBuffer.length; // Altrimenti calcola i byte reali del binario

  // Avvolge l'orchestrazione in try/catch per mappare gli errori in modo coerente
  try {
    // ── STEP 1: createJobCard ──────────────────────────────────────────────
    // Log inizio step 1
    console.log('[createJobCardAndUploadDocument] STEP 1/4 createJobCard...');
    // Riusa la funzione esistente createJobCard passando solo i campi che le competono
    const jobCardResult = await createJobCard({
      vin: params.vin, // VIN veicolo
      market: params.market, // Mercato
      source: params.source, // Sistema chiamante
      UserName: params.UserName, // Utente
      dealerCode: params.dealerCode, // Codice dealer
      JobCard_Title: params.JobCard_Title, // Titolo job card
    });
    // Estrae il JobCardId dalla risposta (l'upstream puo' usare JobCardId o JobCardID)
    const jobCardId = jobCardResult && (jobCardResult.JobCardId ?? jobCardResult.JobCardID ?? jobCardResult.jobCardId);
    // Estrae l'AccessToken eventualmente gia' restituito da createJobCard (in tal caso si evita una CreateAccessToken separata)
    let accessToken = jobCardResult && (jobCardResult.AccessToken ?? jobCardResult.accessToken);
    // Se manca il JobCardId non ha senso proseguire: errore upstream (502 via handler)
    if (!jobCardId) {
      throw new Error(`[createJobCardAndUploadDocument] createJobCard non ha restituito un JobCardId valido: ${JSON.stringify(jobCardResult)}`);
    }
    // Log esito step 1 con soli metadati non sensibili (JobCardId; MAI l'AccessToken)
    console.log(`[createJobCardAndUploadDocument] STEP 1/4 OK: JobCardId=${jobCardId}`);

    // ── STEP 1-bis (fallback automatico): createAccessToken ─────────────────
    // Alcuni ambienti/gateway NON restituiscono l'AccessToken direttamente da createJobCard.
    // In tal caso lo si ottiene esplicitamente con createAccessToken (riuso del metodo esistente).
    let accessTokenResult = null; // Traccia l'esito dell'eventuale createAccessToken (per il riepilogo steps)
    if (!accessToken) {
      // Log: AccessToken assente nella risposta di createJobCard -> attivazione fallback
      console.log('[createJobCardAndUploadDocument] STEP 1-bis createAccessToken (AccessToken assente in createJobCard)...');
      // Riusa la funzione esistente createAccessToken con i campi che le competono
      accessTokenResult = await createAccessToken({
        JobCardId: jobCardId, // JobCard appena creata
        UserName: params.UserName, // Utente richiedente
        dealerCode: params.dealerCode, // Codice dealer
        market: params.market, // Mercato
      });
      // Estrae l'AccessToken dalla risposta (nomi possibili: AccessToken / accessToken)
      accessToken = accessTokenResult && (accessTokenResult.AccessToken ?? accessTokenResult.accessToken);
      // Se anche createAccessToken non restituisce un token utilizzabile, e' un errore upstream
      if (!accessToken) {
        throw new Error(`[createJobCardAndUploadDocument] createAccessToken non ha restituito un AccessToken utilizzabile: ${JSON.stringify(accessTokenResult)}`);
      }
      // Log esito step 1-bis (MAI il valore del token)
      console.log('[createJobCardAndUploadDocument] STEP 1-bis OK: AccessToken ottenuto via createAccessToken');
    }

    // ── STEP 2: getUploadDocURL ────────────────────────────────────────────
    // Log inizio step 2
    console.log('[createJobCardAndUploadDocument] STEP 2/4 getUploadDocURL...');
    // Riusa la funzione esistente getUploadDocURL con il JobCardId e l'AccessToken appena ottenuti
    const uploadUrlResult = await getUploadDocURL({
      JobCardId: jobCardId, // JobCard appena creata
      Filename: params.Filename, // Nome file
      Size: fileSize, // Dimensione file (dichiarata o calcolata)
      ContentType: params.ContentType, // MIME type
      AccessToken: accessToken, // Token ottenuto da createJobCard
      Filetype: params.Filetype, // Tipo/estensione file
    });
    // Estrae il DocumentId dalla risposta (l'upstream puo' usare DocumentId o DocumentID)
    const documentId = uploadUrlResult && (uploadUrlResult.DocumentId ?? uploadUrlResult.DocumentID ?? uploadUrlResult.documentId);
    // Estrae la URL pre-firmata dalla risposta (nomi possibili: PresignedUrl / UploadURL / presignedUrl / url)
    const presignedUrl = uploadUrlResult && (uploadUrlResult.PresignedUrl ?? uploadUrlResult.UploadURL ?? uploadUrlResult.presignedUrl ?? uploadUrlResult.url ?? uploadUrlResult.UploadUrl);
    // Senza DocumentId non possiamo poi notificare l'upload: errore upstream
    if (!documentId) {
      throw new Error(`[createJobCardAndUploadDocument] getUploadDocURL non ha restituito un DocumentId valido: ${JSON.stringify(uploadUrlResult)}`);
    }
    // Senza URL pre-firmata non possiamo caricare il binario: errore upstream
    if (!presignedUrl) {
      throw new Error(`[createJobCardAndUploadDocument] getUploadDocURL non ha restituito una URL pre-firmata valida: ${JSON.stringify(uploadUrlResult)}`);
    }
    // Log esito step 2 (DocumentId; NON logga la URL pre-firmata che contiene la firma S3)
    console.log(`[createJobCardAndUploadDocument] STEP 2/4 OK: DocumentId=${documentId}`);

    // ── STEP 3: PUT del binario sulla URL pre-firmata (S3) ─────────────────
    // Log inizio step 3
    console.log('[createJobCardAndUploadDocument] STEP 3/4 PUT binario su URL pre-firmata (S3)...');
    // Esegue l'upload effettivo del binario su S3 tramite l'helper dedicato
    const putResult = await httpsPutBinary(presignedUrl, fileBuffer, params.ContentType);
    // Log esito step 3 con solo lo status HTTP di S3
    console.log(`[createJobCardAndUploadDocument] STEP 3/4 OK: upload S3 HTTP ${putResult.statusCode}`);

    // ── STEP 4: uploadedDoc ────────────────────────────────────────────────
    // Log inizio step 4
    console.log('[createJobCardAndUploadDocument] STEP 4/4 uploadedDoc...');
    // Riusa la funzione esistente uploadedDoc per notificare il completamento dell'upload
    const uploadedResult = await uploadedDoc({
      JobCardId: jobCardId, // JobCard di riferimento
      DocumentId: documentId, // Documento appena caricato
      Action: 'Uploaded', // Azione di notifica completamento (coerente con il flusso esistente)
      AccessToken: accessToken, // Stesso AccessToken del flusso
    });
    // Log esito step 4
    console.log('[createJobCardAndUploadDocument] STEP 4/4 OK: upload notificato');

    // Restituisce un riepilogo completo dell'operazione accorpata (nessun token/URL firmato nel payload di ritorno)
    return {
      success: true, // Esito complessivo positivo
      JobCardId: jobCardId, // Id job card creata
      DocumentId: documentId, // Id documento caricato
      uploadHttpStatus: putResult.statusCode, // Status HTTP dell'upload su S3
      steps: { // Esiti grezzi dei singoli step upstream (utili al front-end/troubleshooting)
        createJobCard: jobCardResult, // Risposta di createJobCard
        createAccessToken: accessTokenResult, // Risposta di createAccessToken (null se l'AccessToken era gia' presente in createJobCard)
        getUploadDocURL: uploadUrlResult, // Risposta di getUploadDocURL
        uploadedDoc: uploadedResult, // Risposta di uploadedDoc
      },
    };
  } catch (err) {
    // Se l'errore ha gia' uno statusCode (es. 400 di validazione), lo rilancia invariato
    if (err && typeof err.statusCode === 'number') {
      // Log dell'errore gia' classificato
      console.error(`[createJobCardAndUploadDocument] Errore [${err.statusCode}]: ${err.message}`);
      // Rilancia mantenendo il mapping dell'handler
      throw err;
    }
    // Altrimenti e' un errore upstream/imprevisto: viene rilanciato cosi' com'e' (l'handler lo mappa a 502)
    console.error(`[createJobCardAndUploadDocument] Errore durante il flusso accorpato: ${err && err.message}`);
    // Rilancia l'errore originale
    throw err;
  }
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
  deleteDocumentsByVin, // Espone la nuova azione accorpata per la cancellazione documenti a partire dal VIN
  createJobCardAndUploadDocument, // NUOVO: azione accorpata createJobCard+getUploadDocURL+PUT S3+uploadedDoc in un'unica chiamata
};
