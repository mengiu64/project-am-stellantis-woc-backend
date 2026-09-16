// index.js
// Lambda handler - orchestrazione autenticazione, validazione, elaborazione

const Logger = require('./logger');
const Validator = require('./validator');
const configModule = require('./config');
const AuthService = require('./authService');
const ExternalSystemClient = require('./externalSystemClient');

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
      return this._buildResponse(401, {
        error: 'Unauthorized',
        message: authValidation.error,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // Valida Bearer token
    const tokenValidation = authService.validateBearerToken(authValidation.token);
    if (!tokenValidation.valid) {
      logger.warn('Token validation fallita', { error: tokenValidation.error });
      return this._buildResponse(401, {
        error: 'Unauthorized',
        message: 'Bearer token non valido',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // Verifica permessi
    const permCheck = authService.verifyPermissions(tokenValidation.decoded, []);
    if (!permCheck.authorized) {
      logger.warn('Permission denied', { reason: permCheck.reason });
      return this._buildResponse(403, {
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
        return await this._handlePostSynchStatus(
          event,
          authValidation.token,
          config,
          authService,
          externalClient,
          logger
        );
      } else if (method === 'GET' && path.includes('/synch-status')) {
        return await this._handleGetSynchStatus(
          event,
          logger
        );
      }
    } else if (event.action) {
      // Direct Lambda invoke con action
      logger.info('Direct Lambda invoke', { action: event.action });

      if (event.action === 'POST_SYNCH_STATUS') {
        return await this._handlePostSynchStatus(
          event,
          authValidation.token,
          config,
          authService,
          externalClient,
          logger
        );
      } else if (event.action === 'GET_SYNCH_STATUS') {
        return await this._handleGetSynchStatus(event, logger);
      }
    }

    // Path non riconosciuto
    logger.warn('Endpoint non trovato', {
      path: event.rawPath || event.path,
      method: event.httpMethod
    });

    return this._buildResponse(404, {
      error: 'Not Found',
      message: 'Endpoint non trovato',
      traceId: logger.getTraceId()
    }, logger.getTraceId());

  } catch (error) {
    logger.error('Errore non gestito in handler', error);
    
    return this._buildResponse(500, {
      error: 'Internal Server Error',
      message: 'Errore interno del server',
      traceId: logger.getTraceId()
    }, logger.getTraceId());
  }
};

// Gestisci POST /api/synch-status
async function _handlePostSynchStatus(
  event,
  bearerToken,
  config,
  authService,
  externalClient,
  logger
) {
  try {
    // Valida payload
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const validation = Validator.validatePostSynchStatus(body);

    if (!validation.valid) {
      logger.warn('Validazione payload fallita', {
        errors: validation.errors
      });

      return this._buildResponse(400, {
        error: 'Bad Request',
        message: 'Validazione fallita',
        details: validation.errors,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    const { events } = validation.data;
    const requestId = this._generateRequestId();

    logger.info('Validazione superata', {
      requestId,
      eventCount: events.length
    });

    // Ottieni header per sistemi esterni
    const headers = await authService.getExternalSystemHeaders();

    // Recupera X-IBM-Client-Secret dalla configurazione (obbligatorio dopo FIX APIC)
    const xIbmClientSecret = config.getByPath('apic.clientSecret');
    if (!xIbmClientSecret) {
      logger.error('X-IBM-Client-Secret non configurato', new Error('Config missing'), {
        configPath: 'apic.clientSecret'
      });
      return this._buildResponse(500, {
        error: 'Internal Server Error',
        message: 'Configurazione APIC incompleta - Client Secret mancante',
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    logger.debug('APIC Client Secret loaded', {
      hasSecret: !!xIbmClientSecret,
      traceId: logger.getTraceId()
    });

    // Invia a sistemi esterni (DJC + GCT) con APIC Client Secret
    const sendResults = await externalClient.sendToMultipleSystems(
      events,
      bearerToken,
      config.getByPath('apic.clientId'),
      xIbmClientSecret,  // AGGIUNTO: Pass X-IBM-Client-Secret
      ['djc', 'gct']
    );

    logger.info('Invio completato', {
      requestId,
      successful: sendResults.successful.length,
      failed: sendResults.failed.length
    });

    // Se anche un sistema ha successo, ritorna 200
    if (sendResults.successful.length > 0) {
      return this._buildResponse(200, {
        requestId,
        message: 'Eventi inviati con successo',
        results: {
          successful: sendResults.successful.length,
          failed: sendResults.failed.length
        },
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    // Se tutti falliscono, ritorna errore
    const firstError = sendResults.failed[0];
    return this._buildResponse(firstError.statusCode || 502, {
      error: 'External System Error',
      message: 'Errore invio a sistemi esterni',
      systems: sendResults.failed,
      traceId: logger.getTraceId()
    }, logger.getTraceId());

  } catch (error) {
    logger.error('Errore handler POST /synch-status', error);

    // Se errore ha statusCode mappato, usa quello
    if (error.statusCode) {
      return this._buildResponse(error.statusCode, {
        error: 'Error',
        message: error.message,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    return this._buildResponse(500, {
      error: 'Internal Server Error',
      message: error.message,
      traceId: logger.getTraceId()
    }, logger.getTraceId());
  }
}

// Gestisci GET /api/synch-status/{requestId}
async function _handleGetSynchStatus(event, logger) {
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

      return this._buildResponse(400, {
        error: 'Bad Request',
        message: 'requestId non valido',
        details: validation.errors,
        traceId: logger.getTraceId()
      }, logger.getTraceId());
    }

    logger.info('GET /synch-status', { requestId });

    // TODO: Implementare lookup in DynamoDB per stato request
    // Per ora ritorna status mock
    return this._buildResponse(200, {
      requestId,
      status: 'PENDING', // PENDING, PROCESSING, SUCCESS, FAILED
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      traceId: logger.getTraceId()
    }, logger.getTraceId());

  } catch (error) {
    logger.error('Errore handler GET /synch-status', error);

    return this._buildResponse(500, {
      error: 'Internal Server Error',
      message: error.message,
      traceId: logger.getTraceId()
    }, logger.getTraceId());
  }
}

// Utilità: costruisci risposta HTTP
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

// Utilità: genera ID richiesta univoco
function _generateRequestId() {
  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

// Rendi funzioni accessibili per esport
exports._handlePostSynchStatus = _handlePostSynchStatus;
exports._handleGetSynchStatus = _handleGetSynchStatus;
exports._buildResponse = _buildResponse;
exports._generateRequestId = _generateRequestId;
