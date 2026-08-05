'use strict';

/**
 * userSignsService.js — Modulo servizio per operazioni CRUD sulle firme dealer.
 *
 * Gestisce creazione, lettura, aggiornamento e cancellazione dei record
 * nella tabella woc.dealer_sign. Le immagini JPEG sono trasportate come
 * stringhe base64 e decodificate/codificate al confine del servizio.
 */

// Importa il pool di connessione al database Aurora PostgreSQL via RDS Proxy
const { getPool } = require('./shared/dbClient');

/**
 * Crea un log strutturato in formato JSON con awsRequestId incluso.
 *
 * @param {string} level - Livello del log (info, warn, error)
 * @param {string} awsRequestId - ID univoco della richiesta Lambda
 * @param {object} data - Dati aggiuntivi da includere nel log
 */
function log(level, awsRequestId, data) {
  // Serializza il log in formato JSON strutturato per CloudWatch
  console.log(JSON.stringify({ level, awsRequestId, ...data }));
}

/**
 * Costruisce la risposta HTTP nel formato API Gateway Proxy Response.
 *
 * @param {number} statusCode - Codice di stato HTTP
 * @param {object} body - Corpo della risposta (verrà serializzato in JSON)
 * @returns {{ statusCode: number, headers: object, body: string }}
 */
function buildResponse(statusCode, body) {
  return {
    statusCode, // Codice di stato HTTP della risposta
    headers: { 'Content-Type': 'application/json' }, // Header Content-Type JSON
    body: JSON.stringify(body), // Corpo serializzato in JSON
  };
}

/**
 * Crea una nuova firma dealer.
 *
 * Valida i campi obbligatori, decodifica l'immagine da base64 a Buffer,
 * esegue l'inserimento nel database e restituisce l'ID generato.
 *
 * @param {object} body - { dealer_login_userid, sign_image }
 * @param {string} awsRequestId - ID univoco della richiesta Lambda
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
async function createUserSign(body, awsRequestId) {
  // Estrae i campi dal body della richiesta
  const dealerLoginUserid = body ? body.dealer_login_userid : undefined;
  const signImage = body ? body.sign_image : undefined;

  // Log dell'operazione ricevuta
  log('info', awsRequestId, {
    operation: 'createUserSign', // Nome dell'operazione corrente
    message: 'Richiesta di creazione firma ricevuta', // Messaggio descrittivo
  });

  // ── Validazione 1: dealer_login_userid obbligatorio e non vuoto dopo trim ──
  if (dealerLoginUserid === undefined || dealerLoginUserid === null || String(dealerLoginUserid).trim() === '') {
    // Log di warning per campo mancante o vuoto
    log('warn', awsRequestId, {
      operation: 'createUserSign', // Operazione in cui si è verificato l'errore
      message: 'Validazione fallita: dealer_login_userid mancante o vuoto', // Dettaglio errore
    });
    // Risposta 400 con messaggio di errore in italiano
    return buildResponse(400, {
      success: false, // Indicatore di operazione non riuscita
      message: 'dealer_login_userid è obbligatorio', // Messaggio di errore per il client
    });
  }

  // ── Validazione 2: dealer_login_userid non deve superare i 50 caratteri ──
  if (String(dealerLoginUserid).length > 50) {
    // Log di warning per superamento lunghezza massima
    log('warn', awsRequestId, {
      operation: 'createUserSign', // Operazione in cui si è verificato l'errore
      message: 'Validazione fallita: dealer_login_userid supera 50 caratteri', // Dettaglio errore
      length: String(dealerLoginUserid).length, // Lunghezza effettiva del valore
    });
    // Risposta 400 con messaggio di errore sulla lunghezza massima
    return buildResponse(400, {
      success: false, // Indicatore di operazione non riuscita
      message: 'dealer_login_userid deve essere di massimo 50 caratteri', // Messaggio di vincolo lunghezza
    });
  }

  // ── Validazione 3: sign_image obbligatorio e non vuoto ──
  if (signImage === undefined || signImage === null || String(signImage).trim() === '') {
    // Log di warning per campo immagine mancante
    log('warn', awsRequestId, {
      operation: 'createUserSign', // Operazione in cui si è verificato l'errore
      message: 'Validazione fallita: sign_image mancante o vuoto', // Dettaglio errore
    });
    // Risposta 400 con messaggio di errore in italiano
    return buildResponse(400, {
      success: false, // Indicatore di operazione non riuscita
      message: 'sign_image è obbligatorio', // Messaggio di errore per il client
    });
  }

  try {
    // Decodifica l'immagine da stringa base64 a Buffer binario per il tipo BYTEA
    const imageBuffer = Buffer.from(String(signImage), 'base64');

    // Ottiene il pool di connessione al database
    const pool = await getPool();

    // Query parametrizzata INSERT per prevenire SQL injection (parametri posizionali $1, $2)
    const queryText = 'INSERT INTO woc.dealer_sign (dealer_login_userid, sign_image) VALUES ($1, $2) RETURNING dealer_sign_id';

    // Valori da inserire: userid trimmato e buffer immagine decodificato
    const values = [String(dealerLoginUserid).trim(), imageBuffer];

    // Esecuzione della query parametrizzata con statement_timeout di sicurezza
    const result = await pool.query({ text: queryText, values, statement_timeout: 5000 });

    // Estrae l'ID generato dal database dalla riga restituita
    const dealerSignId = result.rows[0].dealer_sign_id;

    // Log di successo con l'ID generato
    log('info', awsRequestId, {
      operation: 'createUserSign', // Operazione completata con successo
      message: 'Firma creata con successo', // Messaggio di conferma
      dealer_sign_id: dealerSignId, // ID del record creato
    });

    // Risposta 201 Created con ID del record generato
    return buildResponse(201, {
      success: true, // Indicatore di operazione riuscita
      dealer_sign_id: dealerSignId, // ID numerico della firma creata
    });
  } catch (err) {
    // ── Gestione errore duplicato (vincolo UNIQUE su dealer_login_userid) ──
    if (err.code === '23505') {
      // Log di warning per tentativo di inserimento duplicato
      log('warn', awsRequestId, {
        operation: 'createUserSign', // Operazione in cui si è verificato il conflitto
        message: 'Validazione fallita: dealer_login_userid già esistente', // Dettaglio errore
      });
      // Risposta 409 Conflict con messaggio specifico in italiano
      return buildResponse(409, {
        success: false, // Indicatore di operazione non riuscita
        message: 'Esiste già una firma per questo dealer_login_userid', // Messaggio per il client
      });
    }

    // Log di errore strutturato senza esporre dettagli interni al client
    log('error', awsRequestId, {
      operation: 'createUserSign', // Operazione in cui si è verificato l'errore
      errorType: (err.constructor && err.constructor.name) || 'UnexpectedError', // Tipo di errore per diagnostica
      message: err.message, // Messaggio di errore per i log (non esposto al client)
    });

    // Risposta 500 con messaggio generico per non rivelare dettagli interni
    return buildResponse(500, {
      success: false, // Indicatore di operazione non riuscita
      message: 'Errore interno del server', // Messaggio generico per il client
    });
  }
}

/**
 * Recupera una firma dealer per dealer_login_userid.
 *
 * Valida il parametro dealer_login_userid, esegue una query SELECT sulla tabella
 * woc.dealer_sign e restituisce il record con l'immagine codificata in base64.
 *
 * @param {object} body - { dealer_login_userid }
 * @param {string} awsRequestId - ID univoco della richiesta Lambda
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
async function getUserSign(body, awsRequestId) {
  // Estrae il campo dealer_login_userid dal body della richiesta
  const dealerLoginUserid = body ? body.dealer_login_userid : undefined;

  // Log dell'operazione ricevuta
  log('info', awsRequestId, {
    operation: 'getUserSign', // Nome dell'operazione corrente
    message: 'Richiesta di lettura firma ricevuta', // Messaggio descrittivo
  });

  // ── Validazione: dealer_login_userid obbligatorio e non vuoto dopo trim ──
  if (dealerLoginUserid === undefined || dealerLoginUserid === null || String(dealerLoginUserid).trim() === '') {
    // Log di warning per campo mancante
    log('warn', awsRequestId, {
      operation: 'getUserSign', // Operazione in cui si è verificato l'errore
      message: 'Validazione fallita: dealer_login_userid mancante o vuoto', // Dettaglio errore
    });
    // Risposta 400 con messaggio di errore in italiano
    return buildResponse(400, {
      success: false, // Indicatore di operazione non riuscita
      message: 'dealer_login_userid è obbligatorio', // Messaggio di errore per il client
    });
  }

  try {
    // Ottiene il pool di connessione al database
    const pool = await getPool();

    // Query parametrizzata SELECT per prevenire SQL injection (parametro posizionale $1)
    const queryText = 'SELECT dealer_sign_id, dealer_login_userid, sign_image, created_at, updated_at FROM woc.dealer_sign WHERE dealer_login_userid = $1';

    // Valore del parametro: userid trimmato
    const values = [String(dealerLoginUserid).trim()];

    // Esecuzione della query parametrizzata con statement_timeout di sicurezza
    const result = await pool.query({ text: queryText, values, statement_timeout: 5000 });

    // ── Verifica se il record esiste ──
    if (result.rows.length === 0) {
      // Log informativo per record non trovato
      log('info', awsRequestId, {
        operation: 'getUserSign', // Operazione corrente
        message: 'Record non trovato', // Nessun record corrispondente
        dealer_login_userid: String(dealerLoginUserid).trim(), // Valore cercato
      });
      // Risposta 404 con messaggio di record non trovato
      return buildResponse(404, {
        success: false, // Indicatore di operazione non riuscita
        message: 'Record non trovato', // Messaggio per il client
      });
    }

    // Estrae il primo (e unico) record dal risultato della query
    const row = result.rows[0];

    // Codifica il Buffer BYTEA dell'immagine in stringa base64 per il trasporto JSON
    const signImageBase64 = row.sign_image.toString('base64');

    // Log di successo con l'userid del record recuperato
    log('info', awsRequestId, {
      operation: 'getUserSign', // Operazione completata con successo
      message: 'Firma recuperata con successo', // Messaggio di conferma
      dealer_login_userid: row.dealer_login_userid, // Userid del record restituito
    });

    // Risposta 200 OK con i dati del record inclusa l'immagine in base64
    return buildResponse(200, {
      success: true, // Indicatore di operazione riuscita
      data: {
        dealer_sign_id: row.dealer_sign_id, // ID del record
        dealer_login_userid: row.dealer_login_userid, // Identificativo utente dealer
        sign_image: signImageBase64, // Immagine firma codificata in base64
        created_at: row.created_at, // Timestamp di creazione
        updated_at: row.updated_at, // Timestamp di ultimo aggiornamento
      },
    });
  } catch (err) {
    // Log di errore strutturato senza esporre dettagli interni al client
    log('error', awsRequestId, {
      operation: 'getUserSign', // Operazione in cui si è verificato l'errore
      errorType: (err.constructor && err.constructor.name) || 'UnexpectedError', // Tipo di errore per diagnostica
      message: err.message, // Messaggio di errore per i log (non esposto al client)
    });

    // Risposta 500 con messaggio generico per non rivelare dettagli interni
    return buildResponse(500, {
      success: false, // Indicatore di operazione non riuscita
      message: 'Errore interno del server', // Messaggio generico per il client
    });
  }
}

/**
 * Aggiorna una firma dealer esistente.
 *
 * Usa dealer_login_userid come chiave di ricerca (obbligatorio).
 * L'unico campo aggiornabile è sign_image.
 *
 * @param {object} body - { dealer_login_userid, sign_image }
 * @param {string} awsRequestId - ID univoco della richiesta Lambda
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
async function updateUserSign(body, awsRequestId) {
  // Estrae i campi dal body della richiesta
  const dealerLoginUserid = body ? body.dealer_login_userid : undefined; // Chiave di ricerca del record
  const signImage = body ? body.sign_image : undefined; // Nuova immagine firma in base64

  // Log dell'operazione ricevuta
  log('info', awsRequestId, {
    operation: 'updateUserSign', // Nome dell'operazione corrente
    message: 'Richiesta di aggiornamento firma ricevuta', // Messaggio descrittivo
  });

  // ── Validazione 1: dealer_login_userid obbligatorio e non vuoto dopo trim ──
  if (dealerLoginUserid === undefined || dealerLoginUserid === null || String(dealerLoginUserid).trim() === '') {
    // Log di warning per campo mancante
    log('warn', awsRequestId, {
      operation: 'updateUserSign', // Operazione in cui si è verificato l'errore
      message: 'Validazione fallita: dealer_login_userid mancante o vuoto', // Dettaglio errore
    });
    // Risposta 400 con messaggio di errore in italiano
    return buildResponse(400, {
      success: false, // Indicatore di operazione non riuscita
      message: 'dealer_login_userid è obbligatorio', // Messaggio di errore per il client
    });
  }

  // ── Validazione 2: sign_image obbligatorio per l'aggiornamento ──
  if (signImage === undefined || signImage === null || String(signImage).trim() === '') {
    // Log di warning per campo immagine mancante
    log('warn', awsRequestId, {
      operation: 'updateUserSign', // Operazione in cui si è verificato l'errore
      message: 'Validazione fallita: sign_image mancante o vuoto', // Dettaglio errore
    });
    // Risposta 400 con messaggio di errore in italiano
    return buildResponse(400, {
      success: false, // Indicatore di operazione non riuscita
      message: 'sign_image è obbligatorio', // Messaggio di errore per il client
    });
  }

  try {
    // Decodifica l'immagine da stringa base64 a Buffer binario per il tipo BYTEA
    const imageBuffer = Buffer.from(String(signImage), 'base64');

    // Ottiene il pool di connessione al database
    const pool = await getPool();

    // Query parametrizzata UPDATE con WHERE su dealer_login_userid (chiave univoca)
    const queryText = 'UPDATE woc.dealer_sign SET sign_image = $1 WHERE dealer_login_userid = $2 RETURNING dealer_sign_id';

    // Valori: nuova immagine e userid trimmato come chiave di ricerca
    const values = [imageBuffer, String(dealerLoginUserid).trim()];

    // Esecuzione della query parametrizzata con statement_timeout di sicurezza
    const result = await pool.query({ text: queryText, values, statement_timeout: 5000 });

    // ── Verifica se il record esiste ──
    if (result.rows.length === 0) {
      // Log informativo per record non trovato
      log('info', awsRequestId, {
        operation: 'updateUserSign', // Operazione corrente
        message: 'Record non trovato', // Nessun record corrispondente
        dealer_login_userid: String(dealerLoginUserid).trim(), // Valore cercato
      });
      // Risposta 404 con messaggio di record non trovato
      return buildResponse(404, {
        success: false, // Indicatore di operazione non riuscita
        message: 'Record non trovato', // Messaggio per il client
      });
    }

    // Log di successo
    log('info', awsRequestId, {
      operation: 'updateUserSign', // Operazione completata con successo
      message: 'Firma aggiornata con successo', // Messaggio di conferma
      dealer_login_userid: String(dealerLoginUserid).trim(), // Chiave del record aggiornato
    });

    // Risposta 200 OK con messaggio di conferma aggiornamento
    return buildResponse(200, {
      success: true, // Indicatore di operazione riuscita
      message: 'Record aggiornato', // Messaggio di conferma per il client
    });
  } catch (err) {
    // Log di errore strutturato senza esporre dettagli interni al client
    log('error', awsRequestId, {
      operation: 'updateUserSign', // Operazione in cui si è verificato l'errore
      errorType: (err.constructor && err.constructor.name) || 'UnexpectedError', // Tipo di errore per diagnostica
      message: err.message, // Messaggio di errore per i log (non esposto al client)
    });

    // Risposta 500 con messaggio generico per non rivelare dettagli interni
    return buildResponse(500, {
      success: false, // Indicatore di operazione non riuscita
      message: 'Errore interno del server', // Messaggio generico per il client
    });
  }
}

/**
 * Elimina una firma dealer per dealer_login_userid.
 *
 * Valida il parametro dealer_login_userid, esegue una query DELETE sulla tabella
 * woc.dealer_sign e restituisce il risultato dell'operazione di cancellazione.
 *
 * @param {object} body - { dealer_login_userid }
 * @param {string} awsRequestId - ID univoco della richiesta Lambda
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
async function deleteUserSign(body, awsRequestId) {
  // Estrae il campo dealer_login_userid dal body della richiesta
  const dealerLoginUserid = body ? body.dealer_login_userid : undefined;

  // Log dell'operazione ricevuta
  log('info', awsRequestId, {
    operation: 'deleteUserSign', // Nome dell'operazione corrente
    message: 'Richiesta di eliminazione firma ricevuta', // Messaggio descrittivo
  });

  // ── Validazione: dealer_login_userid obbligatorio e non vuoto dopo trim ──
  if (dealerLoginUserid === undefined || dealerLoginUserid === null || String(dealerLoginUserid).trim() === '') {
    // Log di warning per campo mancante
    log('warn', awsRequestId, {
      operation: 'deleteUserSign', // Operazione in cui si è verificato l'errore
      message: 'Validazione fallita: dealer_login_userid mancante o vuoto', // Dettaglio errore
    });
    // Risposta 400 con messaggio di errore in italiano
    return buildResponse(400, {
      success: false, // Indicatore di operazione non riuscita
      message: 'dealer_login_userid è obbligatorio', // Messaggio di errore per il client
    });
  }

  try {
    // Ottiene il pool di connessione al database
    const pool = await getPool();

    // Query parametrizzata DELETE con WHERE su dealer_login_userid (chiave univoca)
    const queryText = 'DELETE FROM woc.dealer_sign WHERE dealer_login_userid = $1 RETURNING dealer_sign_id';

    // Valore del parametro: userid trimmato
    const values = [String(dealerLoginUserid).trim()];

    // Esecuzione della query parametrizzata con statement_timeout di sicurezza
    const result = await pool.query({ text: queryText, values, statement_timeout: 5000 });

    // ── Verifica se il record esisteva ed è stato cancellato ──
    if (result.rows.length === 0) {
      // Log informativo per record non trovato
      log('info', awsRequestId, {
        operation: 'deleteUserSign', // Operazione corrente
        message: 'Record non trovato', // Nessun record corrispondente
        dealer_login_userid: String(dealerLoginUserid).trim(), // Valore cercato
      });
      // Risposta 404 con messaggio di record non trovato
      return buildResponse(404, {
        success: false, // Indicatore di operazione non riuscita
        message: 'Record non trovato', // Messaggio per il client
      });
    }

    // Log di successo
    log('info', awsRequestId, {
      operation: 'deleteUserSign', // Operazione completata con successo
      message: 'Firma eliminata con successo', // Messaggio di conferma
      dealer_login_userid: String(dealerLoginUserid).trim(), // Chiave del record eliminato
    });

    // Risposta 200 OK con messaggio di conferma eliminazione
    return buildResponse(200, {
      success: true, // Indicatore di operazione riuscita
      message: 'Record eliminato', // Messaggio di conferma per il client
    });
  } catch (err) {
    // Log di errore strutturato senza esporre dettagli interni al client
    log('error', awsRequestId, {
      operation: 'deleteUserSign', // Operazione in cui si è verificato l'errore
      errorType: (err.constructor && err.constructor.name) || 'UnexpectedError', // Tipo di errore per diagnostica
      message: err.message, // Messaggio di errore per i log (non esposto al client)
    });

    // Risposta 500 con messaggio generico per non rivelare dettagli interni
    return buildResponse(500, {
      success: false, // Indicatore di operazione non riuscita
      message: 'Errore interno del server', // Messaggio generico per il client
    });
  }
}
module.exports = {
  createUserSign, // Esporta la funzione di creazione firma
  getUserSign, // Esporta la funzione di lettura firma
  updateUserSign, // Esporta la funzione di aggiornamento firma
  deleteUserSign, // Esporta la funzione di eliminazione firma
};
