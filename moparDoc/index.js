  /**
 * index.js — Entry point (moparDoc)
 *
 * Espone 11 azioni verso i gateway MoparDoc (documenti Mopar/Jobcard):
 *  ── 4 metodi originali (job-docs PSA + MoparDocs FCA):
 * Espone 11 azioni verso i gateway MoparDoc:
 *  - createJobCard     (POST /job-docs/connector/v1/CreateJobCard)
 *  - createAccessToken (POST /job-docs/connector/v1/CreateAccessToken)
 *  - getUploadDocURL   (POST /Mopardocs/MoparDocsApi/Browser/getUploadDocURL)
 *  - uploadedDoc       (POST /Mopardocs/MoparDocsApi/Browser/UploadedDoc)
 *
 *  ── 7 metodi nuovi (MoparDocs Services Stellantis):
 *  - getJobCardList               [NUOVO]
 *  - getJobCardAndDocumentList    [NUOVO]
 *  - getDocumentsInfo             [NUOVO]
 *  - getDocuments                 [NUOVO]
 *  - DeleteDocuments              [NUOVO]
 *  - DeleteJobcard                [NUOVO]
 *  - getDocumentsDownloadUrl      [NUOVO]
 *
 *  ── 1 metodo accorpato (orchestrazione VIN -> JobCardId reale):
 *  - deleteDocumentsByVin         [NUOVO]
 *
 * Usage:
 *   node index.js createJobCard     <payloadJsonFile>
 *   node index.js createAccessToken <payloadJsonFile>
 *   node index.js getUploadDocURL   <payloadJsonFile>
 *   node index.js uploadedDoc       <payloadJsonFile>
 *   node index.js getJobCardList               <payloadJsonFile> [NUOVO]
 *   node index.js getJobCardAndDocumentList    <payloadJsonFile> [NUOVO]
 *   node index.js getDocumentsInfo             <payloadJsonFile> [NUOVO]
 *   node index.js getDocuments                 <payloadJsonFile> [NUOVO]
 *   node index.js DeleteDocuments              <payloadJsonFile> [NUOVO]
 *   node index.js DeleteJobcard                <payloadJsonFile> [NUOVO]
 *   node index.js getDocumentsDownloadUrl      <payloadJsonFile> [NUOVO]
 *   node index.js deleteDocumentsByVin         <payloadJsonFile> [NUOVO]
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
  getJobCardAndDocumentList,
  getDocumentsInfo,
  getDocuments,
  DeleteDocuments,
  DeleteJobcard,
  getDocumentsDownloadUrl,
  deleteDocumentsByVin, // NUOVO: azione accorpata che risolve il JobCardId dal VIN e cancella i documenti in una sola chiamata
} = require('./moparDocService');

// ── Lambda handler ────────────────────────────────────────────────────────────

function resolveActionAndBody(event) {
  // Priorità 1: event.action (direct invoke)
  let action = event.action;
  
  // Priorità 2: estrai dal path (API Gateway proxy)
  if (!action) {
    const rawPath  = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
    const segments = String(rawPath).split('/').filter(Boolean);
    action = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;
  }

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

// NUOVO: Array esteso con 7 nuove azioni oltre alle 4 pre-esistenti (11 totali)
const VALID_ACTIONS = [
  // ────── Metodi originali (4) ──────
  'createJobCard', // Crea JobCard
  'createAccessToken', // Crea token di accesso
  'getUploadDocURL', // Ottiene URL upload documento
  'uploadedDoc', // Notifica upload documento completato
  // ────── Metodi NUOVI (7) ──────
  'getJobCardList', // Recupera lista JobCard
  'getJobCardAndDocumentList', // Recupera JobCard e Documenti
  'getDocumentsInfo', // Ottiene informazioni documenti
  'getDocuments', // Recupera documenti
  'DeleteDocuments', // Cancella documenti
  'DeleteJobcard', // Cancella JobCard
  'getDocumentsDownloadUrl', // Genera URL download
  // ────── Azione accorpata NUOVA (1) ──────
  'deleteDocumentsByVin', // NUOVO: cancella documenti a partire dal solo VIN (risolve internamente il JobCardId reale)
];

// NUOVO: Dispatcher esteso che mappa le azioni ai metodi del servizio
// Ogni azione chiama il corrispondente metodo async da moparDocService
const ACTIONS = {
  // ────── Dispatcher originale (4 metodi) ──────
  createJobCard, // Crea JobCard presso il gateway job-docs
  createAccessToken, // Ottiene token accesso dall'endpoint job-docs
  getUploadDocURL, // Recupera URL upload presso il gateway MoparDocs Browser
  uploadedDoc, // Notifica al gateway che l'upload è completato
  // ────── Dispatcher NUOVO (7 metodi) ──────
  getJobCardList, // Recupera lista JobCard per VIN, dealer, market presso MoparDocs Services
  getJobCardAndDocumentList, // Recupera sia JobCard che relativa lista Documenti presso MoparDocs Services
  getDocumentsInfo, // Ottiene informazioni dettagliate su documenti specifici presso MoparDocs Services
  getDocuments, // Recupera lista documenti associati a JobCard presso MoparDocs Services
  DeleteDocuments, // Cancella documenti specifici presso MoparDocs Services
  DeleteJobcard, // Cancella una JobCard presso MoparDocs Services
  getDocumentsDownloadUrl, // Genera URL pre-firmata per il download di un documento presso MoparDocs Browser
  // ────── Dispatcher accorpato NUOVO (1 metodo) ──────
  deleteDocumentsByVin, // NUOVO: orchestra getDocuments + DeleteDocuments risolvendo il JobCardId reale dal VIN (vincolo: documenti sulla stessa job card)
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
    // MODIFICA retrocompatibile: se l'Error espone uno statusCode numerico esplicito (es. 400/500 impostati dalla funzione di servizio deleteDocumentsByVin) lo usa in via prioritaria
    // Altrimenti mantiene l'euristica pre-esistente ('Missing required field' -> 400, altrimenti 502): le 11 azioni esistenti non impostano err.statusCode e restano quindi invariate
    const statusCode =
      (typeof err.statusCode === 'number' && err.statusCode) || // Usa lo statusCode esplicito quando presente e valido (copre anche il fallback 500 per eccezioni impreviste)
      (err.message.includes('Missing required field') ? 400 : 502); // Euristica retrocompatibile per gli errori che non portano statusCode
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
  console.log(`[CLI] Payload caricato:`, JSON.stringify(payload, null, 2));
  
  // Esegue l'azione recuperandola dal dispatcher ACTIONS
  console.log(`[CLI] Esecuzione azione: ${action}...`);
  const result = await ACTIONS[action](payload);
  
  // Log: stampa il risultato
  console.log(`[CLI] Risultato:`, JSON.stringify(result, null, 2));
  return result;
}

// NUOVO: Funzione main della CLI
async function main() {
  // Recupera i parametri della riga di comando: node index.js <command> <param>
  const [, , command, param] = process.argv;

  try {
    // Verifica se il comando è un'azione valida nel dispatcher
    if (VALID_ACTIONS.includes(command)) {
      // Verifica che sia stato passato il file JSON con il payload
      if (!param) {
        // Log di errore: il file JSON è obbligatorio
        console.error('[ERROR] È richiesto il path del file JSON con il payload.');
        process.exit(1);
      }
      // Esegue l'azione con il payload dal file JSON
      await runAction(command, param);
    } else {
      // Log di errore: comando non riconosciuto
      console.error('[ERROR] Comando non valido. Usa:');
      // NUOVO: Mostra la lista completa di tutti i 14 comandi disponibili (13 esistenti + deleteDocumentsByVin)
      console.error('  node index.js createJobCard     <payloadJsonFile>');
      console.error('  node index.js createAccessToken <payloadJsonFile>');
      console.error('  node index.js getUploadDocURL   <payloadJsonFile>');
      console.error('  node index.js uploadedDoc       <payloadJsonFile>');
      console.error('  node index.js getJobCardList    <payloadJsonFile>');
      console.error('  node index.js getJobCardAndDocumentList <payloadJsonFile>');
      console.error('  node index.js getDocumentsInfo  <payloadJsonFile>');
      console.error('  node index.js getDocuments      <payloadJsonFile>');
      console.error('  node index.js DeleteDocuments   <payloadJsonFile>');
      console.error('  node index.js DeleteJobcard     <payloadJsonFile>');
      console.error('  node index.js getDocumentsDownloadUrl <payloadJsonFile>');
      console.error('  node index.js deleteDocumentsByVin <payloadJsonFile>'); // NUOVO: uso CLI dell'azione accorpata deleteDocumentsByVin
      process.exit(1);
    }
  } catch (err) {
    // Log di errore: cattura eccezioni durante l'esecuzione dell'azione da CLI
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

// NUOVO: Se questo file è eseguito direttamente (non importato), avvia la CLI main
if (require.main === module) {
  main();
}
