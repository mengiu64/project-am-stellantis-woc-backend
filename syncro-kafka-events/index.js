// index.js
// Lambda handler - Riceve 4 eventi Kafka specifici da DJC e registra in Aurora
// Implementazione RISTRETTA secondo SRP DL KAFKA Specification
// 4 eventi supportati: DMS_PUSH_SUCCESS_WITHOUT_UPDATE, DMS_PUSH_SUCCESS_WITH_UPDATE, DMS_PUSH_REFUSAL, DMS_PUSH_FAILURE

// ─────────────────────────────────────────────────────────────────────────────
// 📦 IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

const { v4: uuidv4 } = require('uuid');
const Logger = require('./logger');
const Validator = require('./validator');
const configModule = require('./config');
const { getPool } = require('./shared/dbClient'); // Pool Aurora PostgreSQL (pattern isStellantisBrand)

// ─────────────────────────────────────────────────────────────────────────────
// 🔧 COSTANTI - Definisci i 4 eventi supportati
// ─────────────────────────────────────────────────────────────────────────────

// Enum dei 4 tipi di evento supportati dalla specifica SRP DL KAFKA
// Nota: Questi eventi mappano agli stati finali dell'ENUM woc.djc_sync_status in Aurora
// PENDING è gestito da altre lambda (es. isStellantisBrand), syncro-kafka-events lo trasforma
// in uno dei 4 stati finali sottostanti
const SUPPORTED_EVENT_TYPES = {
  DMS_PUSH_SUCCESS_WITHOUT_UPDATE: 'DMS_PUSH_SUCCESS_WITHOUT_UPDATE',
  DMS_PUSH_SUCCESS_WITH_UPDATE: 'DMS_PUSH_SUCCESS_WITH_UPDATE',
  DMS_PUSH_REFUSAL: 'DMS_PUSH_REFUSAL',
  DMS_PUSH_FAILURE: 'DMS_PUSH_FAILURE'
};

// Mappa dei tipi evento ai valori dell'ENUM woc.djc_sync_status
// Valori ENUM Aurora: PENDING, SUCCESS_WITHOUT_UPDATE, SUCCESS_WITH_UPDATE, REFUSAL, FAILURE
// Syncro-kafka-events trasforma i 4 eventi Kafka nei relativi stati finali
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
  // Crea istanza logger con trace ID per correlazione
  const logger = new Logger();
  
  try {
    // Log: evento ricevuto
    logger.info('🔔 Lambda syncro-kafka-events invocata', {
      httpMethod: event.httpMethod || event.requestContext?.http?.method,
      path: event.path || event.rawPath,
      traceId: logger.getTraceId()
    });

    // ─────────────────────────────────────────────────────────────────────
    // 1️⃣  PARSING DEL PAYLOAD
    // ─────────────────────────────────────────────────────────────────────

    // Estrai il body dalle diverse fonti (API Gateway v1/v2 o direct invoke)
    let payload = event.body;
    if (typeof payload === 'string') {
      // API Gateway invia body come string, parse necessario
      try {
        payload = JSON.parse(payload);
      } catch (parseError) {
        logger.error('❌ Errore parsing JSON body', parseError);
        return exports._buildResponse(400, {
          error: 'Bad Request',
          message: 'Body non è valido JSON',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      }
    }

    logger.info('📋 Payload ricevuto:', { payload });

    // ─────────────────────────────────────────────────────────────────────
    // 2️⃣  VALIDAZIONE DEL PAYLOAD
    // ─────────────────────────────────────────────────────────────────────

    // Valida che payload contiene i 3 campi obbligatori
    const validation = _validatePayload(payload, logger);
    if (!validation.valid) {
      logger.warn('⚠️  Validazione payload fallita', {
        errors: validation.errors,
        traceId: logger.getTraceId()
      });
      return exports._buildResponse(400, {
        error: 'Bad Request',
        message: 'Validazione payload fallita',
        details: validation.errors,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3️⃣  ESTRAI DATI DAL PAYLOAD VALIDATO
    // ─────────────────────────────────────────────────────────────────────

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
      // Ottieni pool da shared/dbClient (pattern isStellantisBrand)
      pool = await getPool();
      logger.info('🔗 Connessione Aurora PostgreSQL acquisita');
    } catch (dbConnectError) {
      logger.error('❌ Errore connessione Aurora', dbConnectError);
      return exports._buildResponse(503, {
        error: 'Service Unavailable',
        message: 'Impossibile connettersi al database Aurora',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5️⃣  SALVA L'EVENTO IN AURORA - INSERT O UPDATE A SECONDA DEL CASO
    // ─────────────────────────────────────────────────────────────────────

    try {
      // Genera response_id univoco per questo evento
      const responseId = uuidv4();
      
      // Converti eventType nel status database corrispondente
      const dbStatus = EVENT_TYPE_TO_DB_STATUS[eventType];

      // Query: INSERT con ON CONFLICT DO UPDATE per idempotency
      // Se (job_card_id, push_timestamp) esiste già, aggiorna; altrimenti inserisce
      const upsertQuery = `
        INSERT INTO woc.comunication_asyncro_djc (
          response_id,
          job_card_id,
          push_timestamp,
          djc_sync_status,
          json_payload,
          json_modified,
          retry_count,
          error_code,
          error_message,
          source_system,
          created_by,
          created_at,
          updated_at,
          version
        ) VALUES (
          $1,     -- response_id: ID univoco della risposta
          $2,     -- job_card_id: job card identifier dal payload
          $3,     -- push_timestamp: timestamp dell'evento Kafka
          $4,     -- djc_sync_status: stato dell'evento (SUCCESS_WITHOUT_UPDATE, SUCCESS_WITH_UPDATE, REFUSAL, FAILURE)
          $5,     -- json_payload: payload originale ricevuto da DJC
          $6,     -- json_modified: metadati aggiuntivi (timestamp ricezione, event type, etc.)
          $7,     -- retry_count: iniziale 0 (per future retry logic)
          $8,     -- error_code: null (se successo) o codice errore (se failure)
          $9,     -- error_message: null (se successo) o messaggio errore
          $10,    -- source_system: 'DJC' (sistema che ha inviato l'evento)
          $11,    -- created_by: identità del chiamante (Bearer token user, o 'djc-system')
          $12,    -- created_at: timestamp di creazione del record
          $13,    -- updated_at: timestamp di ultimo aggiornamento
          $14     -- version: numero versione per optimistic locking (iniziale 1)
        )
        ON CONFLICT (job_card_id, push_timestamp)
        DO UPDATE SET
          response_id = $1,
          djc_sync_status = $4,
          json_modified = $6,
          updated_at = $12,
          version = version + 1
        RETURNING response_id, djc_sync_status, version
      `;

      // Parametri della query
      const upsertValues = [
        responseId,                                    // $1: response_id
        jobCardId,                                     // $2: job_card_id
        new Date(timestamp),                           // $3: push_timestamp (converte a Date PostgreSQL)
        dbStatus,                                      // $4: djc_sync_status (stato evento)
        JSON.stringify(payload),                       // $5: json_payload (payload originale)
        JSON.stringify({
          eventType,                                   // Tipo evento ricevuto
          receivedAt: new Date().toISOString(),        // Quando è stato ricevuto dalla lambda
          additionalFields: Object.keys(additionalData) // Quali campi aggiuntivi erano presenti
        }),                                            // $6: json_modified
        0,                                             // $7: retry_count (iniziale 0)
        _getErrorCode(eventType),                      // $8: error_code (null per success, codice per failure)
        _getErrorMessage(eventType),                   // $9: error_message (null per success, messaggio per failure)
        'DJC',                                         // $10: source_system (sempre DJC)
        'djc-system',                                  // $11: created_by (sistema DJC, eventualmente user da token)
        new Date(),                                    // $12: created_at
        new Date(),                                    // $13: updated_at
        1                                              // $14: version (iniziale 1)
      ];

      // Esegui l'UPSERT (INSERT con ON CONFLICT DO UPDATE)
      const result = await pool.query({
        text: upsertQuery,
        values: upsertValues,
        statement_timeout: 5000  // Timeout 5 secondi per query database
      });

      // Verifica che l'operazione sia andata a buon fine
      if (!result.rows || result.rows.length === 0) {
        logger.error('❌ UPSERT fallito: nessuna riga ritornata', {
          jobCardId,
          eventType
        });
        return exports._buildResponse(500, {
          error: 'Internal Server Error',
          message: 'Errore durante salvataggio evento in Aurora',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      }

      // Estrai risultato dell'UPSERT
      const upsertedRecord = result.rows[0];
      
      logger.info('✅ Evento registrato in Aurora', {
        responseId: upsertedRecord.response_id,
        jobCardId,
        eventType,
        dbStatus: upsertedRecord.djc_sync_status,
        version: upsertedRecord.version,
        isInsert: upsertedRecord.version === 1,  // version=1 significa INSERT, >1 significa UPDATE
        isUpdate: upsertedRecord.version > 1
      });

      // ─────────────────────────────────────────────────────────────────────
      // 6️⃣  COSTRUISCI E RITORNA RISPOSTA DI SUCCESSO
      // ─────────────────────────────────────────────────────────────────────

      // Risposta HTTP 200 OK con dettagli dell'evento registrato
      return exports._buildResponse(200, {
        statusCode: 200,
        success: true,
        message: `Evento ${eventType} registrato con successo`,
        response: {
          responseId: upsertedRecord.response_id,
          jobCardId,
          eventType,
          status: upsertedRecord.djc_sync_status,
          timestamp: new Date().toISOString(),
          version: upsertedRecord.version
        },
        traceId: logger.getTraceId()
      }, logger.getTraceId());

    } catch (dbError) {
      // ─────────────────────────────────────────────────────────────────────
      // 🛑 GESTIONE ERRORE DATABASE
      // ─────────────────────────────────────────────────────────────────────

      logger.error('❌ Errore durante UPSERT in Aurora', dbError, {
        jobCardId,
        eventType,
        errorCode: dbError.code,
        errorMessage: dbError.message
      });

      // Se l'errore è di timeout del database
      if (dbError.message.includes('timeout')) {
        return exports._buildResponse(504, {
          error: 'Gateway Timeout',
          message: 'Query database superato il timeout',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      }

      // Se l'errore è di connessione
      if (dbError.message.includes('connect') || dbError.message.includes('ECONNREFUSED')) {
        return exports._buildResponse(503, {
          error: 'Service Unavailable',
          message: 'Connessione database non disponibile',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      }

      // Errore generico database
      return exports._buildResponse(500, {
        error: 'Internal Server Error',
        message: 'Errore durante salvataggio in Aurora',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

  } catch (error) {
    // ─────────────────────────────────────────────────────────────────────
    // 🔴 ERRORE NON GESTITO - Catch-all handler
    // ─────────────────────────────────────────────────────────────────────

    logger.error('🔴 Errore non gestito nel handler', error);

    // Ritorna 500 Internal Server Error
    return exports._buildResponse(500, {
      error: 'Internal Server Error',
      message: error.message || 'Errore interno del server',
      traceId: logger.getTraceId()
    }, logger.getTraceId());
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 🔍 VALIDAZIONE PAYLOAD
// ─────────────────────────────────────────────────────────────────────────────

function _validatePayload(payload, logger) {
  // Valida che payload sia un oggetto
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      errors: ['Payload deve essere un oggetto JSON']
    };
  }

  // Valida eventType (obbligatorio e deve essere uno dei 4 supportati)
  if (!payload.eventType) {
    return {
      valid: false,
      errors: ['eventType è obbligatorio']
    };
  }

  // Controlla che eventType sia uno dei 4 supportati
  if (!Object.values(SUPPORTED_EVENT_TYPES).includes(payload.eventType)) {
    const supportedList = Object.values(SUPPORTED_EVENT_TYPES).join(', ');
    logger.warn('⚠️  eventType non supportato', {
      receivedEventType: payload.eventType,
      supportedEventTypes: supportedList
    });
    return {
      valid: false,
      errors: [
        `eventType '${payload.eventType}' non supportato. Supportati: ${supportedList}`
      ]
    };
  }

  // Valida jobCardSrpId (obbligatorio - è la chiave insieme a timestamp)
  if (!payload.jobCardSrpId) {
    return {
      valid: false,
      errors: ['jobCardSrpId è obbligatorio (Job Card Identifier)']
    };
  }

  // Valida timestamp (obbligatorio - deve essere valido ISO 8601 o numero)
  if (!payload.timestamp) {
    return {
      valid: false,
      errors: ['timestamp è obbligatorio (formato ISO 8601: 2026-04-24T10:30:00Z)']
    };
  }

  // Valida che timestamp sia convertibile a Date
  const timestampDate = new Date(payload.timestamp);
  if (isNaN(timestampDate.getTime())) {
    return {
      valid: false,
      errors: [`timestamp '${payload.timestamp}' non è valido (ISO 8601: 2026-04-24T10:30:00Z)`]
    };
  }

  // Validazione passata: ritorna dati estratti
  return {
    valid: true,
    data: {
      eventType: payload.eventType,
      jobCardId: payload.jobCardSrpId,  // Rinomina per coerenza nel codice
      timestamp: payload.timestamp,
      // Tutti gli altri campi sono opzionali (jobCardLegacyId, dmsRepairOrderId, xpDealerCode, etc.)
      ...payload
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 📊 MAPPING STATO DB DA EVENT TYPE
// ─────────────────────────────────────────────────────────────────────────────

function _getErrorCode(eventType) {
  // Ritorna error_code a seconda del tipo evento
  // Per SUCCESS: null (nessun errore)
  // Per FAILURE e REFUSAL: codice errore
  
  if (eventType === SUPPORTED_EVENT_TYPES.DMS_PUSH_FAILURE) {
    // DMS_PUSH_FAILURE: errore durante push
    return 'DMS_PUSH_FAILED';
  }
  
  if (eventType === SUPPORTED_EVENT_TYPES.DMS_PUSH_REFUSAL) {
    // DMS_PUSH_REFUSAL: rifiutato dal sistema esterno
    return 'DMS_PUSH_REFUSED';
  }

  // SUCCESS_WITHOUT_UPDATE e SUCCESS_WITH_UPDATE: nessun errore
  return null;
}

function _getErrorMessage(eventType) {
  // Ritorna messaggio errore a seconda del tipo evento
  // Per SUCCESS: null
  // Per FAILURE e REFUSAL: messaggio descrittivo
  
  if (eventType === SUPPORTED_EVENT_TYPES.DMS_PUSH_FAILURE) {
    return 'DMS ha riportato un fallimento durante il push del job card';
  }
  
  if (eventType === SUPPORTED_EVENT_TYPES.DMS_PUSH_REFUSAL) {
    return 'DMS ha rifiutato il push del job card (validazione fallita)';
  }

  // SUCCESS events: nessun messaggio errore
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🛠️  COSTRUZIONE RISPOSTA HTTP
// ─────────────────────────────────────────────────────────────────────────────

function _buildResponse(statusCode, body, traceId) {
  // Costruisce risposta HTTP nel formato API Gateway Proxy (statusCode, headers, body)
  
  return {
    statusCode,                                 // Codice HTTP: 200, 400, 500, etc.
    headers: {
      'Content-Type': 'application/json',      // Risposta sempre JSON
      'X-Trace-Id': traceId,                   // Trace ID per correlazione log
      'Access-Control-Allow-Origin': '*'       // CORS permissivo (eventualmente limitare)
    },
    body: JSON.stringify(body)                  // Body come JSON string
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 📦 EXPORT PER TEST E INTEGRAZIONE
// ─────────────────────────────────────────────────────────────────────────────

// Esponi funzioni ausiliarie per unit test
exports._validatePayload = _validatePayload;
exports._buildResponse = _buildResponse;
exports._getErrorCode = _getErrorCode;
exports._getErrorMessage = _getErrorMessage;
exports.SUPPORTED_EVENT_TYPES = SUPPORTED_EVENT_TYPES;
exports.EVENT_TYPE_TO_DB_STATUS = EVENT_TYPE_TO_DB_STATUS;
