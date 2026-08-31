/**
 * index.js — Entry point (moparDoc)
 *
 * Espone 13 azioni verso i gateway MoparDoc:
 *  - createJobCard     (POST /job-docs/connector/v1/CreateJobCard)
 *  - createAccessToken (POST /job-docs/connector/v1/CreateAccessToken)
 *  - getUploadDocURL   (POST /Mopardocs/MoparDocsApi/Browser/getUploadDocURL)
 *  - uploadedDoc       (POST /Mopardocs/MoparDocsApi/Browser/UploadedDoc)
 *  - getJobCardList    (POST /services/getJobCardList) [NUOVO]
 *  - associateJobCard  (POST /services/associateJobCard) [NUOVO]
 *  - getJobCardAndDocumentList (POST /services/getJobCardAndDocumentList) [NUOVO]
 *  - getDocumentsInfo  (POST /services/getDocumentsInfo) [NUOVO]
 *  - associateDocument (POST /services/associateDocument) [NUOVO]
 *  - getDocuments      (POST /services/getDocuments) [NUOVO]
 *  - DeleteDocuments   (POST /services/DeleteDocuments) [NUOVO]
 *  - DeleteJobcard     (POST /services/DeleteJobcard) [NUOVO]
 *  - getDocumentsDownloadUrl (POST /Mopardocs/MoparDocsApi/Browser/getDocumentsDownloadUrl) [NUOVO]
 */

const fs = require('fs');
// NUOVO: Importa 9 nuovi metodi dal servizio moparDocService (in aggiunta ai 4 pre-esistenti)
const {
  createJobCard,
  createAccessToken,
  getUploadDocURL,
  uploadedDoc,
  // ────── Metodi NUOVI ──────
  getJobCardList, // Recupera lista JobCard per VIN, dealer, market
  associateJobCard, // Associa JobCard a Ticket
  getJobCardAndDocumentList, // Recupera sia JobCard che Documenti
  getDocumentsInfo, // Ottiene info su documenti specifici
  associateDocument, // Associa documento a Ticket
  getDocuments, // Recupera documenti per JobCard
  DeleteDocuments, // Cancella documenti
  DeleteJobcard, // Cancella JobCard
  getDocumentsDownloadUrl, // Genera URL download documento
} = require('./moparDocService');

function resolveActionAndBody(event) {
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

// NUOVO: Array esteso con 9 nuove azioni oltre alle 4 pre-esistenti (13 totali)
const VALID_ACTIONS = [
  // ────── Metodi originali (4) ──────
  'createJobCard', // Crea JobCard
  'createAccessToken', // Crea token di accesso
  'getUploadDocURL', // Ottiene URL upload documento
  'uploadedDoc', // Notifica upload documento completato
  // ────── Metodi NUOVI (9) ──────
  'getJobCardList', // Recupera lista JobCard
  'associateJobCard', // Associa JobCard a Ticket
  'getJobCardAndDocumentList', // Recupera JobCard e Documenti
  'getDocumentsInfo', // Ottiene informazioni documenti
  'associateDocument', // Associa documento a Ticket
  'getDocuments', // Recupera documenti
  'DeleteDocuments', // Cancella documenti
  'DeleteJobcard', // Cancella JobCard
  'getDocumentsDownloadUrl', // Genera URL download
];

// NUOVO: Dispatcher esteso che mappa le azioni ai metodi del servizio
// Ogni azione chiama il corrispondente metodo async da moparDocService
const ACTIONS = {
  // ────── Dispatcher originale (4 metodi) ──────
  createJobCard, // Crea JobCard presso il gateway job-docs
  createAccessToken, // Ottiene token accesso dall'endpoint job-docs
  getUploadDocURL, // Recupera URL upload presso il gateway MoparDocs Browser
  uploadedDoc, // Notifica al gateway che l'upload è completato
  // ────── Dispatcher NUOVO (9 metodi) ──────
  getJobCardList, // Recupera lista JobCard per VIN, dealer, market presso MoparDocs Services
  associateJobCard, // Associa un JobCard a un Ticket presso MoparDocs Services
  getJobCardAndDocumentList, // Recupera sia JobCard che relativa lista Documenti presso MoparDocs Services
  getDocumentsInfo, // Ottiene informazioni dettagliate su documenti specifici presso MoparDocs Services
  associateDocument, // Associa un documento a un Ticket presso MoparDocs Services
  getDocuments, // Recupera lista documenti associati a JobCard presso MoparDocs Services
  DeleteDocuments, // Cancella documenti specifici presso MoparDocs Services
  DeleteJobcard, // Cancella una JobCard presso MoparDocs Services
  getDocumentsDownloadUrl, // Genera URL pre-firmata per il download di un documento presso MoparDocs Browser
};

exports.handler = async (event) => {
  // Log: Riceve l'evento API Gateway e inizia a elaborare la richiesta
  console.log('[handler] Richiesta ricevuta. Event:', JSON.stringify(event, null, 2));
  
  // Risolve l'azione e il body dai parametri dell'evento
  const { action, body } = resolveActionAndBody(event);
  
  // Log: Informa quale azione è stata risolta dalla richiesta
  console.log(`[handler] Azione risolta: "${action}", Body ricevuto:`, JSON.stringify(body, null, 2));

  // Valida che l'azione sia tra quelle supportate dal dispatcher ACTIONS
  if (!action || !VALID_ACTIONS.includes(action)) {
    // Log di errore: azione non riconosciuta
    console.error(`[handler] ERRORE: Azione sconosciuta "${action}". Azioni valide: ${VALID_ACTIONS.join(', ')}`);
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
    // Log: Informa che l'azione sta per essere eseguita
    console.log(`[handler] Esecuzione azione: ${action} con payload:`, JSON.stringify(body.payload ?? body, null, 2));
    
    // Esegue il metodo corrispondente dall'oggetto ACTIONS
    const result = await ACTIONS[action](body.payload ?? body);
    
    // Log di successo: informa che l'azione è stata completata con successo
    console.log(`[handler] Azione "${action}" completata con successo. Risultato:`, JSON.stringify(result, null, 2));
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    // Determina il codice di errore: 400 se campo obbligatorio mancante, 502 se errore generico
    const statusCode = err.message.includes('Missing required field') ? 400 : 502;
    // Log di errore: informa dell'eccezione durante l'esecuzione dell'azione
    console.error(`[handler] ERRORE durante esecuzione "${action}": [${statusCode}] ${err.message}`);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────
// NUOVO: Funzione CLI per eseguire le azioni direttamente da riga di comando
// Usata per testing e debug durante lo sviluppo

// NUOVO: Carica il payload dal file JSON e esegue l'azione specifificata
async function runAction(action, payloadJsonFile) {
  // Log: informa quale azione sta per essere eseguita
  console.log(`\n=== MoparDoc: ${action} ===`);
  
  // Log: carica il file JSON con il payload
  console.log(`[CLI] Caricamento payload da: ${payloadJsonFile}`);
  const payload = JSON.parse(fs.readFileSync(payloadJsonFile, 'utf8'));
  
  // Log: informa i parametri caricati
  console.log(`
