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
    logger.info('🔔 Lambda syncro-kafka-events invocata', {
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

    const { eventType, jobCardId, timestamp, djc, ambito, ...additionalData } = validation.data;

    logger.info('✅ Payload validato', {
      eventType,
      jobCardId,
      timestamp,
      djc: djc || 'Y (default)',
      ambito,
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
        error: 'Service Unavailable',
        message: 'Impossibile connettersi al database Aurora',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5️⃣  SALVA L'EVENTO IN AURORA - INSERT O UPDATE A SECONDA DEL CASO
    // ─────────────────────────────────────────────────────────────────────

    try {
      const responseId = uuidv4();
      
      // Valida e normalizza il flag djc (default: 'Y')
      const djcFlag = djc ? djc.toUpperCase() : 'Y';
      if (!['Y', 'N'].includes(djcFlag)) {
        logger.warn('⚠️  Flag djc non valido', {
          providedDjc: djc,
          validValues: ['Y', 'N'],
          traceId: logger.getTraceId()
        });
        return exports._buildResponse(400, {
          error: 'Bad Request',
          message: 'Flag djc non valido - deve essere Y o N',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      }

      // LOGICA: Calcola djc_sync_status in base al flag djc
      // - Se djc='N' → djc_sync_status=NULL (evento non processato per sincronizzazione)
      // - Se djc='Y' → djc_sync_status=uno dei 4 stati enum (evento processato)
      let djcSyncStatus;
      if (djcFlag === 'N') {
        djcSyncStatus = null;
        logger.info('🔴 Flag djc=N: djc_sync_status sarà NULL', { traceId: logger.getTraceId() });
      } else {
        djcSyncStatus = EVENT_TYPE_TO_DB_STATUS[eventType];
        logger.info('🟢 Flag djc=Y: djc_sync_status verrà impostato', {
          eventType,
          djcSyncStatus,
          traceId: logger.getTraceId()
        });
      }

      const upsertQuery = `
        INSERT INTO woc.comunication_asyncro_djc (
          response_id,
          job_card_id,
          push_timestamp,
          djc_sync_status,
          djc,
          ambito,
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
          $4,     -- djc_sync_status: NULL se djc='N', altrimenti uno dei 4 stati enum
          $5,     -- djc: flag Y/N per abilitare sincronizzazione (default Y)
          $6,     -- ambito: ambito/contesto dell'evento
          $7,     -- json_payload: payload originale ricevuto da DJC
          $8,     -- json_modified: metadati aggiuntivi
          $9,     -- retry_count: iniziale 0
          $10,    -- error_code: null o codice errore
          $11,    -- error_message: null o messaggio errore
          $12,    -- source_system: sempre 'DJC'
          $13,    -- created_by: identità del chiamante
          $14,    -- created_at: timestamp di creazione
          $15,    -- updated_at: timestamp di aggiornamento
          $16     -- version: numero versione per optimistic locking (iniziale 1)
        )
        ON CONFLICT (job_card_id, push_timestamp)
        DO UPDATE SET
          response_id = $1,
          djc_sync_status = $4,
          djc = $5,
          ambito = $6,
          json_modified = $8,
          updated_at = $15,
          version = version + 1
        RETURNING response_id, djc_sync_status, version
      `;

      const upsertValues = [
        responseId,                                    // $1: response_id
        jobCardId,                                     // $2: job_card_id
        new Date(timestamp),                           // $3: push_timestamp
        djcSyncStatus,                                 // $4: djc_sync_status (NULL se djc='N')
        djcFlag,                                       // $5: djc (flag Y/N)
        ambito,                                        // $6: ambito (nuovo campo obbligatorio)
        JSON.stringify(payload),                       // $7: json_payload
        JSON.stringify({
          eventType,
          receivedAt: new Date().toISOString(),
          djcFlag,
          ambito,
          additionalFields: Object.keys(additionalData)
        }),                                            // $8: json_modified
        0,                                             // $9: retry_count
        _getErrorCode(eventType),                      // $10: error_code
        _getErrorMessage(eventType),                   // $11: error_message
        'DJC',                                         // $12: source_system
        'djc-system',                                  // $13: created_by
        new Date(),                                    // $14: created_at
        new Date(),                                    // $15: updated_at
        1                                              // $16: version
      ];

      const result = await pool.query({
        text: upsertQuery,
        values: upsertValues,
        statement_timeout: 5000
      });

      if (!result.rows || result.rows.length === 0) {
        logger.error('❌ UPSERT non ha ritornato righe', {
          jobCardId,
          traceId: logger.getTraceId()
        });
        return exports._buildResponse(500, {
          error: 'Internal Server Error',
          message: 'Database UPSERT non ha ritornato risultati',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      }

      const upsertedRecord = result.rows[0];
      logger.info('✅ Evento registrato in Aurora', {
        responseId: upsertedRecord.response_id,
        djcSyncStatus: upsertedRecord.djc_sync_status,
        version: upsertedRecord.version,
        traceId: logger.getTraceId()
      });

      return exports._buildResponse(200, {
        message: 'Evento registrato con successo in Aurora',
        data: {
          responseId: upsertedRecord.response_id,
          jobCardId,
          timestamp,
          djcFlag,
          ambito,
          djcSyncStatus: upsertedRecord.djc_sync_status,
          version: upsertedRecord.version,
          traceId: logger.getTraceId()
        }
      }, logger.getTraceId());
    } catch (upsertError) {
      logger.error('❌ Errore durante UPSERT in Aurora', upsertError, {
        jobCardId,
        errorCode: upsertError.code,
        errorMessage: upsertError.message,
        traceId: logger.getTraceId()
      });

      if (upsertError.code === 'ECONNREFUSED' || upsertError.code === 'ETIMEDOUT') {
        return exports._buildResponse(503, {
          error: 'Service Unavailable',
          message: 'Errore connessione al database Aurora',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      } else if (upsertError.message && upsertError.message.includes('statement timeout')) {
        return exports._buildResponse(504, {
          error: 'Gateway Timeout',
          message: 'Query database ha superato il timeout',
          traceId: logger.getTraceId()
        }, logger.getTraceId());
      }

      return exports._buildResponse(500, {
        error: 'Internal Server Error',
        message: 'Errore durante salvataggio in database',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }
  } catch (handlerError) {
    logger.error('❌ Errore non gestito in handler', handlerError);
    return exports._buildResponse(500, {
      error: 'Internal Server Error',
      message: 'Errore non gestito',
      traceId: logger.getTraceId()
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
      'X-Lambda': 'syncro-kafka-events',
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
