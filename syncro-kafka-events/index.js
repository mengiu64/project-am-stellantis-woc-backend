// index.js
// Lambda handler - orchestrazione autenticazione, validazione, elaborazione + database integration

const { v4: uuidv4 } = require('uuid');
const Logger = require('./logger');
const Validator = require('./validator');
const configModule = require('./config');
const AuthService = require('./authService');
const ExternalSystemClient = require('./externalSystemClient');
const { getPool } = require('./shared/dbClient'); // 📦 Importa pool da shared directory (isStellantisBrand pattern)

// Funzione principale Lambda handler
exports.handler = async (event, context) => {
  // Crea logger con trace ID per questa richiesta
  const logger = new Logger();
  
  try {
    logger.info('Lambda invocata', {
      eventSource: event.source || 'api-gateway',
      httpMethod: event.httpMethod || event.requestContext?.http?.method,
      path: event.path || event.rawPath
    });

    // Inizializza config (singleton)
    const config = await configModule.getInstance();
    
    // Crea servizi
    const authService = new AuthService(config, logger);
    const externalClient = new ExternalSystemClient(config, logger);

    // Estrai Authorization header
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const authValidation = Validator.validateAuthorizationHeader(authHeader);

    if (!authValidation.valid) {
      logger.warn('Authorization fallita', { error: authValidation.error });
      return exports._buildResponse(401, {
        error: 'Unauthorized',
        message: authValidation.error,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // Valida bearer token
    const tokenValidation = authService.validateBearerToken(authValidation.token);
    if (!tokenValidation.valid) {
      logger.warn('Token validation fallita', { error: tokenValidation.error });
      return exports._buildResponse(401, {
        error: 'Unauthorized',
        message: 'Bearer token non valido',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // Verifica permessi
    const permCheck = authService.verifyPermissions(tokenValidation.decoded, []);
    if (!permCheck.authorized) {
      logger.warn('Permission denied', { reason: permCheck.reason });
      return exports._buildResponse(403, {
        error: 'Forbidden',
        message: permCheck.reason,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // Determina se API Gateway Proxy o direct invoke
    const isApiGateway = event.rawPath || event.resource;
    const isApiGatewayHttpApi = event.requestContext?.http?.method;

    if (isApiGateway || isApiGatewayHttpApi) {
      // API Gateway Proxy integration
      const method = event.requestContext?.http?.method || event.httpMethod;
      const path = event.rawPath || event.path;

      logger.info('API Gateway request', {
        method,
        path,
        pathParameters: event.pathParameters
      });

      if (method === 'POST' && path.includes('/synch-status')) {
        return await exports._handlePostSynchStatus(
          event,
          authValidation.token,
          config,
          authService,
          externalClient,
          logger
        );
      } else if (method === 'GET' && path.includes('/synch-status')) {
        return await exports._handleGetSynchStatus(
          event,
          logger
        );
      }
    } else if (event.action) {
      // Direct Lambda invoke con action
      logger.info('Direct Lambda invoke', { action: event.action });

      if (event.action === 'POST_SYNCH_STATUS') {
        return await exports._handlePostSynchStatus(
          event,
          authValidation.token,
          config,
          authService,
          externalClient,
          logger
        );
      } else if (event.action === 'GET_SYNCH_STATUS') {
        return await exports._handleGetSynchStatus(event, logger);
      }
    }

    // Path non riconosciuto
    logger.warn('Endpoint non trovato', {
      path: event.rawPath || event.path,
      method: event.httpMethod
    });

    return exports._buildResponse(404, {
      error: 'Not Found',
      message: 'Endpoint non trovato',
      traceId: logger.getTraceId()
    }, logger.getTraceId());

  } catch (error) {
    logger.error('Errore non gestito in handler', error);
    
    return exports._buildResponse(500, {
      error: 'Internal Server Error',
      message: 'Errore interno del server',
      traceId: logger.getTraceId()
    }, logger.getTraceId());
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 📝 Gestisci POST /api/synch-status
// Ricevi callback DJC → INSERT/UPDATE in Aurora comunication_asyncro_djc
// ──────────────────────────────────────────────────────────────────────────────
async function _handlePostSynchStatus(
  event,
  bearerToken,
  config,
  authService,
  externalClient,
  logger
) {
  let pool = null;

  try {
    // Valida payload
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const validation = Validator.validatePostSynchStatus(body);

    if (!validation.valid) {
      logger.warn('Validazione payload fallita', {
        errors: validation.errors
      });

      return exports._buildResponse(400, {
        error: 'Bad Request',
        message: 'Validazione fallita',
        details: validation.errors,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    const { events } = validation.data;
    const responseId = exports._generateRequestId(); // 🆔 UUID unico per questa risposta DJC
    const pushTimestamp = new Date();

    logger.info('Validazione superata', {
      responseId,
      eventCount: events.length,
      timestamp: pushTimestamp.toISOString()
    });

    // Ottieni header per sistemi esterni
    const headers = await authService.getExternalSystemHeaders();

    // Recupera X-IBM-Client-Secret dalla configurazione (obbligatorio dopo FIX APIC)
    const xIbmClientSecret = config.getByPath('apic.clientSecret');
    if (!xIbmClientSecret) {
      logger.error('X-IBM-Client-Secret non configurato', new Error('Config missing'), {
        configPath: 'apic.clientSecret'
      });
      return exports._buildResponse(500, {
        error: 'Internal Server Error',
        message: 'Configurazione APIC incompleta - Client Secret mancante',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    logger.debug('APIC Client Secret loaded', {
      hasSecret: !!xIbmClientSecret,
      traceId: logger.getTraceId()
    });

    // ─────────────────────────────────────────────────────────────────────
    // 1️⃣  CONNETTITI AL DATABASE AURORA PostgreSQL
    // Usa pattern isStellantisBrand: pool riutilizzato tra invocazioni (warm start)
    // ─────────────────────────────────────────────────────────────────────
    pool = await getPool();
    logger.info('Connessione Aurora PostgreSQL acquisita', { responseId });

    // ─────────────────────────────────────────────────────────────────────
    // 2️⃣  ESTRAI job_card_id DAL PRIMO EVENTO (obbligatorio per tracciamento)
    // ─────────────────────────────────────────────────────────────────────
    const firstEvent = events[0];
    const jobCardId = firstEvent?.job_card_id || firstEvent?.jobCardId || null;

    if (!jobCardId) {
      logger.warn('job_card_id mancante nel primo evento', { responseId });
      return exports._buildResponse(400, {
        error: 'Bad Request',
        message: 'job_card_id obbligatorio nel payload',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    logger.info('Job Card ID estratto dal payload', { responseId, jobCardId });

    // ─────────────────────────────────────────────────────────────────────
    // 3️⃣  INSERT record in woc.comunication_asyncro_djc
    // Status iniziale: PENDING
    // Unique key (job_card_id, push_timestamp) garantisce idempotency
    // ON CONFLICT DO UPDATE: se la stessa richiesta viene inviata due volte
    // ─────────────────────────────────────────────────────────────────────
    const insertQuery = `
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      ON CONFLICT (job_card_id, push_timestamp) 
      DO UPDATE SET 
        json_modified = $6,
        djc_sync_status = $4,
        retry_count = 0,
        updated_at = $13,
        version = version + 1
      RETURNING response_id, djc_sync_status, version
    `;

    const insertValues = [
      responseId,                                    // $1: response_id (UUID pk)
      jobCardId,                                     // $2: job_card_id (unique key)
      pushTimestamp,                                 // $3: push_timestamp (unique key)
      'PENDING',                                     // $4: djc_sync_status (initial state)
      JSON.stringify({ events }),                    // $5: json_payload (evento DJC completo)
      JSON.stringify({ events, receivedAt: new Date().toISOString() }), // $6: json_modified
      0,                                             // $7: retry_count (iniziale = 0)
      null,                                          // $8: error_code (null initially)
      null,                                          // $9: error_message (null initially)
      'DJC',                                         // $10: source_system (DJC callbacks)
      'syncro-kafka-events-lambda',                  // $11: created_by (audit trail)
      pushTimestamp,                                 // $12: created_at (timestamp)
      pushTimestamp,                                 // $13: updated_at (timestamp)
      1                                              // $14: version (optimistic locking = 1)
    ];

    const insertResult = await pool.query({
      text: insertQuery,
      values: insertValues,
      statement_timeout: 5000  // ⏱️ Timeout 5 secondi per questa query
    });

    if (!insertResult.rows || insertResult.rows.length === 0) {
      throw new Error('INSERT into comunication_asyncro_djc failed: no record returned');
    }

    const insertedRecord = insertResult.rows[0];
    logger.info('✅ Record inserito in woc.comunication_asyncro_djc', {
      responseId,
      jobCardId,
      status: insertedRecord.djc_sync_status,
      version: insertedRecord.version
    });

    // Invia a sistemi esterni (DJC + GCT) con APIC Client Secret
    const sendResults = await externalClient.sendToMultipleSystems(
      events,
      bearerToken,
      config.getByPath('apic.clientId'),
      xIbmClientSecret,
      ['djc', 'gct']
    );

    logger.info('Invio a sistemi esterni completato', {
      responseId,
      jobCardId,
      successful: sendResults.successful.length,
      failed: sendResults.failed.length
    });

    // ─────────────────────────────────────────────────────────────────────
    // 4️⃣  AGGIORNA STATO A SUCCESS SE ALMENO UN SISTEMA HA SUCCESSO
    // ─────────────────────────────────────────────────────────────────────
    if (sendResults.successful.length > 0) {
      const updateQuery = `
        UPDATE woc.comunication_asyncro_djc
        SET 
          djc_sync_status = 'SUCCESS',
          json_modified = json_modified || $1::jsonb,
          updated_at = $2,
          version = version + 1
        WHERE response_id = $3
        RETURNING response_id, version
      `;

      const updateValues = [
        JSON.stringify({ 
          sentAt: new Date().toISOString(),
          systems: sendResults.successful.map(s => s.system)
        }),
        new Date(),
        responseId
      ];

      const updateResult = await pool.query({
        text: updateQuery,
        values: updateValues,
        statement_timeout: 5000
      });

      logger.info('✅ Stato aggiornato a SUCCESS in Aurora', {
        responseId,
        jobCardId,
        updatedRows: updateResult.rows.length,
        version: updateResult.rows[0]?.version
      });
    }

    // Se anche un sistema ha successo, ritorna 200
    if (sendResults.successful.length > 0) {
      return exports._buildResponse(200, {
        responseId,
        jobCardId,
        message: 'Eventi inviati con successo e registrati in Aurora',
        results: {
          successful: sendResults.successful.length,
          failed: sendResults.failed.length
        },
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5️⃣  AGGIORNA STATO A FAILURE SE TUTTI I SISTEMI FALLISCONO
    // Salva error_code e error_message per debugging
    // ─────────────────────────────────────────────────────────────────────
    const firstError = sendResults.failed[0];
    const updateErrorQuery = `
      UPDATE woc.comunication_asyncro_djc
      SET 
        djc_sync_status = 'FAILURE',
        error_code = $1,
        error_message = $2,
        json_modified = json_modified || $3::jsonb,
        updated_at = $4,
        version = version + 1
      WHERE response_id = $5
      RETURNING response_id, version
    `;

    const updateErrorValues = [
      firstError?.statusCode || 'UNKNOWN_ERROR',
      firstError?.message || 'Errore durante invio a sistemi esterni',
      JSON.stringify({ 
        errors: sendResults.failed,
        failedAt: new Date().toISOString()
      }),
      new Date(),
      responseId
    ];

    const updateErrorResult = await pool.query({
      text: updateErrorQuery,
      values: updateErrorValues,
      statement_timeout: 5000
    });

    logger.warn('❌ Stato aggiornato a FAILURE in Aurora', {
      responseId,
      jobCardId,
      errorCode: firstError?.statusCode,
      version: updateErrorResult.rows[0]?.version
    });

    return exports._buildResponse(firstError.statusCode || 502, {
      responseId,
      jobCardId,
      error: 'External System Error',
      message: 'Errore invio a sistemi esterni (registrato in Aurora)',
      systems: sendResults.failed,
      traceId: logger.getTraceId()
    }, logger.getTraceId());

  } catch (error) {
    logger.error('Errore handler POST /synch-status', error);

    // ─────────────────────────────────────────────────────────────────────
    // 6️⃣  REGISTRA ERRORE LAMBDA IN AURORA (se connessione disponibile)
    // Status: ERROR, error_code: LAMBDA_EXCEPTION
    // ─────────────────────────────────────────────────────────────────────
    if (pool) {
      try {
        const errorQuery = `
          INSERT INTO woc.comunication_asyncro_djc (
            response_id, job_card_id, push_timestamp,
            djc_sync_status, error_code, error_message,
            source_system, created_by, created_at, updated_at, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (job_card_id, push_timestamp) 
          DO UPDATE SET 
            djc_sync_status = 'ERROR',
            error_code = 'LAMBDA_EXCEPTION',
            error_message = $6,
            updated_at = $10,
            version = version + 1
        `;

        const errorValues = [
          exports._generateRequestId(),
          event.body?.events?.[0]?.job_card_id || 'UNKNOWN',
          new Date(),
          'ERROR',
          'LAMBDA_EXCEPTION',
          error.message,
          'DJC',
          'syncro-kafka-events-lambda',
          new Date(),
          new Date(),
          1
        ];

        await pool.query({
          text: errorQuery,
          values: errorValues,
          statement_timeout: 5000
        });

        logger.info('⚠️  Errore lambda registrato in Aurora', { errorCode: 'LAMBDA_EXCEPTION' });
      } catch (dbErr) {
        logger.error('Impossibile registrare errore in Aurora', dbErr);
      }
    }

    // Se errore ha statusCode mappato, usa quello
    if (error.statusCode) {
      return exports._buildResponse(error.statusCode, {
        error: 'Error',
        message: error.message,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    return exports._buildResponse(500, {
      error: 'Internal Server Error',
      message: error.message,
      traceId: logger.getTraceId()
    }, logger.getTraceId());
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 📖 Gestisci GET /api/synch-status/{requestId}
// Leggi stato di una comunicazione da Aurora comunication_asyncro_djc
// ──────────────────────────────────────────────────────────────────────────────
async function _handleGetSynchStatus(event, logger) {
  let pool = null;

  try {
    // Estrai requestId da path
    const requestId = event.pathParameters?.requestId || 
                      event.requestId ||
                      (event.rawPath?.split('/').pop());

    const validation = Validator.validateGetSynchStatus(requestId);

    if (!validation.valid) {
      logger.warn('Validazione GET fallita', {
        errors: validation.errors
      });

      return exports._buildResponse(400, {
        error: 'Bad Request',
        message: 'requestId non valido',
        details: validation.errors,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    logger.info('GET /synch-status richiesto', { requestId });

    // ─────────────────────────────────────────────────────────────────────
    // 1️⃣  CONNETTITI AL DATABASE AURORA
    // ─────────────────────────────────────────────────────────────────────
    pool = await getPool();
    logger.info('Connessione Aurora acquisita per GET', { requestId });

    // ─────────────────────────────────────────────────────────────────────
    // 2️⃣  SELECT RECORD DA woc.comunication_asyncro_djc
    // Query con indice PK su response_id → molto veloce
    // ─────────────────────────────────────────────────────────────────────
    const selectQuery = `
      SELECT 
        response_id,
        job_card_id,
        push_timestamp,
        djc_sync_status,
        json_payload,
        json_modified,
        retry_count,
        error_code,
        error_message,
        created_at,
        updated_at,
        version
      FROM woc.comunication_asyncro_djc
      WHERE response_id = $1
      LIMIT 1
    `;

    const selectResult = await pool.query({
      text: selectQuery,
      values: [requestId],
      statement_timeout: 5000
    });

    // ─────────────────────────────────────────────────────────────────────
    // 3️⃣  RITORNA STATO DEL RECORD
    // Status: PENDING, SUCCESS, FAILURE, ERROR
    // ─────────────────────────────────────────────────────────────────────
    if (selectResult.rows && selectResult.rows.length > 0) {
      const record = selectResult.rows[0];

      logger.info('✅ Record trovato in Aurora', {
        requestId,
        jobCardId: record.job_card_id,
        status: record.djc_sync_status
      });

      return exports._buildResponse(200, {
        requestId,
        jobCardId: record.job_card_id,
        status: record.djc_sync_status, // PENDING, SUCCESS, FAILURE, ERROR
        pushTimestamp: record.push_timestamp,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        retryCount: record.retry_count,
        errorCode: record.error_code,
        errorMessage: record.error_message,
        version: record.version,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // Record non trovato in Aurora
    logger.warn('❌ Record non trovato in Aurora', { requestId });

    return exports._buildResponse(404, {
      requestId,
      error: 'Not Found',
      message: 'Comunicazione non trovata in Aurora',
      traceId: logger.getTraceId()
    }, logger.getTraceId());

  } catch (error) {
    logger.error('Errore handler GET /synch-status', error);

    return exports._buildResponse(500, {
      error: 'Internal Server Error',
      message: error.message,
      traceId: logger.getTraceId()
    }, logger.getTraceId());
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 🛠️  Funzioni Utilità
// ──────────────────────────────────────────────────────────────────────────────

// Costruisci risposta HTTP nel formato API Gateway Proxy Response
// Includi sempre X-Trace-Id header per distributed tracing
function _buildResponse(statusCode, body, traceId) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Trace-Id': traceId,
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

// Genera UUID unico per response_id (tracciamento end-to-end di ogni comunicazione)
function _generateRequestId() {
  return uuidv4();
}

// Rendi funzioni accessibili per export e test unitari
exports._handlePostSynchStatus = _handlePostSynchStatus;
exports._handleGetSynchStatus = _handleGetSynchStatus;
exports._buildResponse = _buildResponse;
exports._generateRequestId = _generateRequestId;
