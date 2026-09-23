// index.js
// Lambda handler - Riceve 4 eventi Kafka specifici da DJC e registra in Aurora
// Implementazione RISTRETTA secondo SRP DL KAFKA Specification
// 4 eventi supportati: DMS_PUSH_SUCCESS_WITHOUT_UPDATE, DMS_PUSH_SUCCESS_WITH_UPDATE, DMS_PUSH_REFUSAL, DMS_PUSH_FAILURE
//
// ⚠️  NOTA IMPORTANTE: Validazione token delegata a IBM API Connect Gateway
//     - La lambda assume che il token ricevuto sia SEMPRE valido
//     - IBM APIC Gateway esegue l'autenticazione e autorizzazione prima di inviare il payload alla lambda
//     - Non c'è validazione di token nel codice lambda (nessun authService.js)
//     - La lambda si concentra SOLO su:
//       1. Parsing e validazione del payload (struttura, valori obbligatori)
//       2. Registrazione stato sincronizzazione in Aurora
//       3. Logging e tracing

// ─────────────────────────────────────────────────────────────────────────────
// 📦 IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

const { v4: uuidv4 } = require('uuid');
const Logger = require('./logger');
const configModule = require('./config');
const { getPool } = require('./shared/dbClient');

// ─────────────────────────────────────────────────────────────────────────────
// 🔧 COSTANTI - Definisci i 4 eventi supportati
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_EVENT_TYPES = {
  DMS_PUSH_SUCCESS_WITHOUT_UPDATE: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
  DMS_PUSH_SUCCESS_WITH_UPDATE: 'DMS_PUSH_SUCCESS_WITH_UPDATE',
  DMS_PUSH_REFUSAL: 'DMS_PUSH_REFUSAL',
  DMS_PUSH_FAILURE: 'DMS_PUSH_FAILURE'
};

const EVENT_TYPE_TO_DB_STATUS = {
  [SUPPORTED_EVENT_TYPES.DMS_PUSH_SUCCESS_WITHOUT_UPDATE]: 'SUCCESS_WITHOUT_UPDATE',
  [SUPPORTED_EVENT_TYPES.DMS_PUSH_SUCCESS_WITH_UPDATE]: 'SUCCESS_WITH_UPDATE',
  [SUPPORTED_EVENT_TYPES.DMS_PUSH_REFUSAL]: 'REFUSAL',
  [SUPPORTED_EVENT_TYPES.DMS_PUSH_FAILURE]: 'FAILURE'
};

// ─────────────────────────────────────────────────────────────────────────────
// 🚀 HANDLER PRINCIPALE - Entry point Lambda
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async (event, context) => {
  const logger = new Logger();
  
  try {
    logger.info('🔔 Lambda synch-status invocata', {
      httpMethod: event.httpMethod || event.requestContext?.http?.method,
      path: event.path || event.rawPath,
      traceId: logger.getTraceId()
    });

    // ─────────────────────────────────────────────────────────────────────
    // 1️⃣  PARSING DEL PAYLOAD
    // ─────────────────────────────────────────────────────────────────────

    let payload = event.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (parseError) {
        logger.error('❌ Errore parsing JSON body', parseError);
        return exports._buildResponse(400, {
          statusCode: 400,
          success: false,
          message: 'Event not updated'
        }, logger.getTraceId());
      }
    }

    // 🔴 NUOVO: Log della request ricevuta da DJC
    logger.info('📥 REQUEST DA DJC RICEVUTA:', JSON.stringify(payload, null, 2));

    // ─────────────────────────────────────────────────────────────────────
    // 2️⃣  VALIDAZIONE DEL PAYLOAD
    // ─────────────────────────────────────────────────────────────────────

    const validation = _validatePayload(payload, logger);
    if (!validation.valid) {
      logger.warn('⚠️  Validazione payload fallita', {
        errors: validation.errors,
        traceId: logger.getTraceId()
      });
      return exports._buildResponse(400, {
        statusCode: 400,
        success: false,
        message: 'Event not updated'
      }, logger.getTraceId());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3️⃣  ESTRAI DATI DAL PAYLOAD VALIDATO
    // ─────────────────────────────────────────────────────────────────────

    // 🔴 MODIFICATO: Rimuovi djc e ambito dall'input - saranno sempre Y e determinati internamente
    const { eventType, jobCardId, timestamp, ...additionalData } = validation.data;

    logger.info('✅ Payload validato', {
      eventType,
      jobCardId,
      timestamp,
      hasAdditionalData: Object.keys(additionalData).length > 0
    });

    // ─────────────────────────────────────────────────────────────────────
    // 4️⃣  CONNETTITI AL DATABASE AURORA PostgreSQL
    // ─────────────────────────────────────────────────────────────────────

    let pool = null;
    try {
      pool = await getPool();
      logger.info('🔗 Connessione Aurora PostgreSQL acquisita');
    } catch (dbConnectError) {
      logger.error('❌ Errore connessione Aurora', dbConnectError);
      return exports._buildResponse(503, {
        statusCode: 503,
        success: false,
        message: 'Event not updated'
      }, logger.getTraceId());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5️⃣  SALVA L'EVENTO IN AURORA - UPDATE RECORD ESISTENTE
    // ─────────────────────────────────────────────────────────────────────

    try {
      // 🔴 MODIFICATO: djcFlag è sempre 'Y' (non ricevuto da input)
      // Calcola djc_sync_status in base al flag djc (sempre Y)
      // djc_sync_status = uno dei 4 stati enum (evento processato)
      const djcSyncStatus = EVENT_TYPE_TO_DB_STATUS[eventType];
      logger.info('🟢 djc=Y: djc_sync_status mappato', {
        eventType,
        djcSyncStatus
      });

      const updateQuery = `
        -- 🔴 MODIFICATO: Cambio da UPSERT a UPDATE-ONLY
        -- La lambda NON inserisce mai record, solo aggiorna record esistenti
        -- Se il record non esiste, la query ritorna 0 righe e generiamo un'eccezione
        -- 🔴 IMPORTANTE: ambito, json_payload, json_modified, djc NON sono mai modificati
        --                Questi campi sono riempiti SOLO dalla lambda che fa il push iniziale verso DJC
        -- 🔴 IMPORTANTE: updated_at è gestito da un trigger PostgreSQL, non dalla lambda
        UPDATE woc.comunication_asyncro_djc
        SET
          -- 🔴 MODIFICATO: NON aggiornare response_id - è la PK e deve rimanere invariato
          -- response_id rimane quello originale inserito da isStellantisBrand
          
          -- Aggiorna stato sincronizzazione DJC
          djc_sync_status = $1,
          -- Incrementa version per optimistic locking
          version = version + 1
        WHERE
          -- Chiave primaria: job_card_id
          job_card_id = $2 AND
          -- Chiave primaria: push_timestamp (chiave UNIQUE)
          push_timestamp = $3
        RETURNING response_id, djc_sync_status, version;
      `;

      // 🔴 MODIFICATO: Valori per la query UPDATE-ONLY (3 parametri)
      // ambito, json_payload, json_modified, djc NON sono mai modificati
      // updated_at è gestito dal trigger PostgreSQL
      const updateValues = [
        djcSyncStatus,                                 // $1: djc_sync_status - stato sincronizzazione aggiornato
        jobCardId,                                     // $2: job_card_id - chiave WHERE
        new Date(timestamp)                            // $3: push_timestamp - chiave WHERE
      ];

      // 🔴 MODIFICATO: Esegui UPDATE-ONLY senza INSERT
      logger.info('📝 Esecuzione query UPDATE-ONLY su woc.comunication_asyncro_djc', {
        jobCardId,
        timestamp,
        traceId: logger.getTraceId()
      });

      const result = await pool.query({
        text: updateQuery,
        values: updateValues,
        statement_timeout: 5000
      });

      // 🔴 MODIFICATO: Verifica che il record sia stato trovato e aggiornato
      // Se nessuna riga ritornata → il record non esiste → errore 404
      if (!result.rows || result.rows.length === 0) {
        // 🔴 NUOVO: Genera eccezione quando il record non viene trovato
        const recordNotFoundError = new Error('RECORD_NOT_FOUND');
        // Imposta status code 404 (Not Found)
        recordNotFoundError.statusCode = 404;
        // Flag per identificare l'errore di record non trovato
        recordNotFoundError.isRecordNotFound = true;
        
        // 🔴 NUOVO: Log completo dell'eccezione con TUTTI i dati ricevuti da DJC
        logger.error('❌ ERRORE CRITICO: Record non trovato in woc.comunication_asyncro_djc', {
          // Informazioni sull'errore
          errorType: 'RECORD_NOT_FOUND',
          message: 'La lambda NON ha trovato il record per aggiornarlo',
          description: 'Il record deve essere creato da un\'altra lambda (e.g., isStellantisBrand) PRIMA di essere aggiornato da syncro-kafka-events',
          
          // Chiavi di ricerca utilizzate nella query WHERE
          searchKeys: {
            job_card_id: jobCardId,
            push_timestamp: timestamp
          },
          
          // Dati completi ricevuti da DJC nel payload
          receivedFromDJC: {
            eventType,
            jobCardId,
            timestamp,
            additionalData
          },
          
          // Payload originale completo inviato da DJC
          originalPayload: JSON.stringify(payload),
          
          // Informazioni tecniche della query
          technical: {
            djcSyncStatus,
            queryType: 'UPDATE-ONLY',
            queryTimeout: 5000,
            parametersCount: updateValues.length
          }
        });
        
        // Lancia l'eccezione per la gestione nel catch block
        throw recordNotFoundError;
      }

      const updatedRecord = result.rows[0];
      // 🔴 MODIFICATO: Log di successo per UPDATE
      logger.info('✅ Evento aggiornato con successo in Aurora', {
        responseId: updatedRecord.response_id,
        djcSyncStatus: updatedRecord.djc_sync_status,
        version: updatedRecord.version,
        jobCardId,
        timestamp
      });

      // Dettaglio evento aggiornato: non più esposto nella response (schema swagger SuccessResponse),
      // ma tracciato comunque nei log per debugging/audit.
      logger.info('📤 Dettaglio evento aggiornato in Aurora:', JSON.stringify({
        response: {
          responseId: updatedRecord.response_id,
          jobCardId,
          eventType,
          status: updatedRecord.djc_sync_status,
          timestamp
        }
      }, null, 2));

      // 🔴 MODIFICATO: Struttura risposta allineata con swagger (solo statusCode/success/message)
      const responseBody = {
        statusCode: 200,
        success: true,
        message: 'Event successfully updated'
      };
      
      // 🔴 NUOVO: Log della risposta inviata a DJC
      logger.info('📤 RESPONSE INVIATA A DJC:', JSON.stringify(responseBody, null, 2));
      
      return exports._buildResponse(200, responseBody, logger.getTraceId());
    } catch (upsertError) {
      // 🔴 MODIFICATO: Gestione errori per UPDATE-ONLY
      
      // Se è l'errore "record non trovato" da noi creato
      if (upsertError.isRecordNotFound) {
        // 🔴 NUOVO: Gestione specifica per record non trovato
        logger.error('❌ ERRORE CRITICO: Record non trovato per UPDATE', {
          statusCode: 404,
          jobCardId,
          timestamp,
          eventType,
          // Include il payload completo per debugging
          payload,
          // Include tutte le informazioni tecniche
          technical: {
            errorMessage: upsertError.message,
            errorStack: upsertError.stack,
            traceId: logger.getTraceId()
          }
        });
        
        const errorResponse = {
          statusCode: 404,
          success: false,
          message: 'Event not updated'
        };
        
        // 🔴 NUOVO: Log della risposta di errore
        logger.info('📤 RESPONSE INVIATA A DJC (404):', JSON.stringify(errorResponse, null, 2));
        
        return exports._buildResponse(404, errorResponse, logger.getTraceId());
      }
      
      // 🔴 MODIFICATO: Log generico di errore durante UPDATE
      logger.error('❌ Errore durante UPDATE in Aurora', upsertError, {
        jobCardId,
        timestamp,
        errorCode: upsertError.code,
        errorMessage: upsertError.message,
        errorStack: upsertError.stack,
        traceId: logger.getTraceId()
      });

      // Gestione errore connessione database
      if (upsertError.code === 'ECONNREFUSED' || upsertError.code === 'ETIMEDOUT') {
        logger.error('❌ Errore connessione al database Aurora', {
          errorCode: upsertError.code,
          jobCardId,
          timestamp,
          traceId: logger.getTraceId()
        });
        return exports._buildResponse(503, {
          statusCode: 503,
          success: false,
          message: 'Event not updated'
        }, logger.getTraceId());
      } 
      // Gestione errore timeout query
      else if (upsertError.message && upsertError.message.includes('statement timeout')) {
        logger.error('❌ Errore timeout query database', {
          message: upsertError.message,
          jobCardId,
          timestamp,
          traceId: logger.getTraceId()
        });
        return exports._buildResponse(504, {
          statusCode: 504,
          success: false,
          message: 'Event not updated'
        }, logger.getTraceId());
      }
      // Errore generico durante UPDATE
      else {
        logger.error('❌ Errore generico durante UPDATE in Aurora', {
          errorMessage: upsertError.message,
          jobCardId,
          timestamp,
          traceId: logger.getTraceId()
        });
        return exports._buildResponse(500, {
          statusCode: 500,
          success: false,
          message: 'Event not updated'
        }, logger.getTraceId());
      }
    }
  } catch (handlerError) {
    logger.error('❌ Errore non gestito in handler', handlerError);
    return exports._buildResponse(500, {
      statusCode: 500,
      success: false,
      message: 'Event not updated'
    }, logger.getTraceId());
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 🔍 FUNZIONI HELPER
// ─────────────────────────────────────────────────────────────────────────────

function _validatePayload(payload, logger) {
  const errors = [];
  const requiredFields = ['eventType', 'jobCardId', 'timestamp'];

  for (const field of requiredFields) {
    const fieldKey = field === 'jobCardId' ? (payload.jobCardSrpId !== undefined ? 'jobCardSrpId' : 'jobCardId') : field;
    
    if (!payload[fieldKey]) {
      errors.push(`Campo obbligatorio mancante: ${fieldKey}`);
    }
  }

  if (payload.eventType && !Object.values(SUPPORTED_EVENT_TYPES).includes(payload.eventType)) {
    errors.push(`eventType non supportato: ${payload.eventType}. Valori supportati: ${Object.keys(SUPPORTED_EVENT_TYPES).join(', ')}`);
  }

  if (payload.timestamp && isNaN(Date.parse(payload.timestamp))) {
    errors.push(`Timestamp non valido (ISO 8601): ${payload.timestamp}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const normalizedData = {
    ...payload,
    jobCardId: payload.jobCardSrpId || payload.jobCardId
  };
  delete normalizedData.jobCardSrpId;

  return {
    valid: true,
    data: normalizedData
  };
}

function _getErrorCode(eventType) {
  switch (eventType) {
    case SUPPORTED_EVENT_TYPES.DMS_PUSH_REFUSAL:
      return 'DMS_PUSH_REFUSED';
    case SUPPORTED_EVENT_TYPES.DMS_PUSH_FAILURE:
      return 'DMS_PUSH_FAILED';
    default:
      return null;
  }
}

function _getErrorMessage(eventType) {
  switch (eventType) {
    case SUPPORTED_EVENT_TYPES.DMS_PUSH_REFUSAL:
      return 'DMS ha rifiutato il push dei dati';
    case SUPPORTED_EVENT_TYPES.DMS_PUSH_FAILURE:
      return 'DMS ha segnalato un fallimento durante l\'elaborazione';
    default:
      return null;
  }
}

exports._buildResponse = (statusCode, body, traceId = '') => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Trace-Id': traceId,
      'X-Lambda': 'synch-status',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
};

module.exports.SUPPORTED_EVENT_TYPES = SUPPORTED_EVENT_TYPES;
module.exports.EVENT_TYPE_TO_DB_STATUS = EVENT_TYPE_TO_DB_STATUS;
module.exports._getErrorCode = _getErrorCode;
module.exports._getErrorMessage = _getErrorMessage;
module.exports._validatePayload = _validatePayload;
