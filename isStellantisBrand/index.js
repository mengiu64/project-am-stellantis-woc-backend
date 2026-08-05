'use strict';

/**
 * index.js — Lambda handler multi-azione per isStellantisBrand e User Signs CRUD
 *
 * Router che supporta invocazione diretta { action, body } e integrazione
 * proxy API Gateway (ultimo segmento del path come azione).
 * Verifica brand Stellantis e operazioni CRUD sulle firme dealer.
 */

// Libreria condivisa per connessione al database
const { getPool } = require('./shared/dbClient');

// Modulo servizio per operazioni CRUD sulle firme dealer
const userSignsService = require('./userSignsService');

/**
 * Azioni valide gestite da questa Lambda.
 * @type {string[]}
 */
const VALID_ACTIONS = [
  'isStellantisBrand',
  'createUserSign',
  'getUserSign',
  'updateUserSign',
  'deleteUserSign',
];

/**
 * Crea un log strutturato in formato JSON con awsRequestId incluso.
 *
 * @param {string} level - Livello del log (info, warn, error)
 * @param {string} awsRequestId - ID univoco della richiesta Lambda
 * @param {object} data - Dati aggiuntivi da includere nel log
 */
function log(level, awsRequestId, data) {
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
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Risolve l'azione e il corpo della richiesta dall'evento Lambda.
 *
 * Supporta due modalità:
 *  1) Invocazione diretta: { "action": "nomeAzione", "body": {...} }
 *  2) Integrazione proxy API Gateway: l'azione è l'ultimo segmento del path
 *     e il body è il merge di queryStringParameters + body JSON parsato.
 *
 * @param {object} event - Evento Lambda (diretto o API Gateway proxy)
 * @returns {{ action: string|undefined, body: object }} Azione risolta e corpo della richiesta
 */
function resolveActionAndBody(event) {
  // Modalità 1: invocazione diretta con campo action esplicito
  if (event && event.action) {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body)
      : (event.body || {});
    return { action: event.action, body };
  }

  // Modalità 2: integrazione proxy API Gateway — azione dall'ultimo segmento del path
  const rawPath  = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  const segments = String(rawPath).split('/').filter(Boolean);
  const action   = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;

  // Parsing del body JSON se presente
  let parsedBody = {};
  if (event.body) {
    try {
      parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (_) {
      // Body non parsabile — si ignora e si usa oggetto vuoto
      parsedBody = {};
    }
  }

  // Merge dei query string parameters con il body parsato
  const body = { ...(event.queryStringParameters || {}), ...parsedBody };
  return { action, body };
}

/**
 * Handler principale della Lambda multi-azione.
 *
 * Risolve l'azione dalla richiesta, valida contro le azioni ammesse,
 * e instrada verso la logica appropriata.
 *
 * @param {object} event - Evento API Gateway Proxy o invocazione diretta
 * @param {object} context - Contesto Lambda (contiene awsRequestId)
 * @returns {Promise<{ statusCode: number, headers: object, body: string }>}
 */
exports.handler = async (event, context) => {
  const awsRequestId = context.awsRequestId;

  // Risoluzione dell'azione e del corpo dalla richiesta
  const { action, body } = resolveActionAndBody(event);

  // Log della richiesta ricevuta con azione risolta
  log('info', awsRequestId, {
    operation: 'handler',
    message: 'Richiesta ricevuta',
    action: action || null,
  });

  // Validazione: azione deve essere tra quelle valide
  if (!action || !VALID_ACTIONS.includes(action)) {
    log('warn', awsRequestId, {
      operation: 'handler',
      message: 'Azione non valida',
      action: action || null,
    });
    return buildResponse(400, {
      success: false,
      message: `Azione sconosciuta: "${action}". Azioni valide: ${VALID_ACTIONS.join(', ')}`,
    });
  }

  // Dispatch in base all'azione risolta
  try {
    switch (action) {
      // ─── isStellantisBrand: logica brand-check esistente (inline) ───
      case 'isStellantisBrand': {
        // Estrazione del parametro ar_codbrand dal body (query string o body parsato)
        const arCodbrand = body ? body.ar_codbrand : undefined;

        // Log della richiesta brand-check
        log('info', awsRequestId, {
          operation: 'isStellantisBrand',
          message: 'Verifica brand Stellantis',
          ar_codbrand: arCodbrand !== undefined ? arCodbrand : null,
        });

        // ── Validazione 1: parametro mancante, null, vuoto o solo whitespace ──
        if (arCodbrand === undefined || arCodbrand === null || arCodbrand.trim() === '') {
          log('warn', awsRequestId, {
            operation: 'validazione',
            message: 'ar_codbrand mancante o vuoto',
            ar_codbrand: arCodbrand !== undefined ? arCodbrand : null,
          });
          return buildResponse(400, {
            success: false,
            message: 'ar_codbrand è obbligatorio',
          });
        }

        // ── Validazione 2: lunghezza massima 2 caratteri ──
        if (arCodbrand.length > 2) {
          log('warn', awsRequestId, {
            operation: 'validazione',
            message: 'ar_codbrand supera i 2 caratteri',
            ar_codbrand: arCodbrand,
          });
          return buildResponse(400, {
            success: false,
            message: 'ar_codbrand deve essere di massimo 2 caratteri',
          });
        }

        // ── Validazione 3: solo caratteri alfabetici (A-Z, a-z) ──
        if (!/^[a-zA-Z]+$/.test(arCodbrand)) {
          log('warn', awsRequestId, {
            operation: 'validazione',
            message: 'ar_codbrand contiene caratteri non alfabetici',
            ar_codbrand: arCodbrand,
          });
          return buildResponse(400, {
            success: false,
            message: 'ar_codbrand deve contenere solo caratteri alfabetici',
          });
        }

        // Conversione a uppercase per la query al database
        const arCodbrandUpper = arCodbrand.toUpperCase();

        log('info', awsRequestId, {
          operation: 'isStellantisBrand',
          message: 'Validazione superata, parametro normalizzato',
          ar_codbrand: arCodbrandUpper,
        });

        // ── Query al database ──
        const pool = await getPool();

        const queryText = 'SELECT logo_s3_key FROM woc.anag_brand WHERE ar_codbrand = $1 LIMIT 1';
        const result = await pool.query({
          text: queryText,
          values: [arCodbrandUpper],
          statement_timeout: 5000,
        });

        if (result.rows.length > 0) {
          const row = result.rows[0];
          const logoS3Key = row.logo_s3_key && row.logo_s3_key.trim() !== ''
            ? row.logo_s3_key
            : null;

          // Log strutturato della query riuscita con logoS3Key
          log('info', awsRequestId, {
            operation: 'query',
            message: 'Query eseguita — brand trovato',
            queryText,
            rowCount: result.rows.length,
            logoS3Key,
          });

          return buildResponse(200, {
            success: true,
            isStellantisBrand: true,
            logoS3Key,
          });
        } else {
          // Log strutturato della query riuscita — brand non trovato
          log('info', awsRequestId, {
            operation: 'query',
            message: 'Query eseguita — brand non trovato',
            queryText,
            rowCount: result.rows.length,
          });

          return buildResponse(200, {
            success: true,
            isStellantisBrand: false,
          });
        }
      }

      // ─── Operazioni CRUD firme dealer — delegate al servizio ───
      case 'createUserSign':
        return await userSignsService.createUserSign(body, awsRequestId);

      case 'getUserSign':
        return await userSignsService.getUserSign(body, awsRequestId);

      case 'updateUserSign':
        return await userSignsService.updateUserSign(body, awsRequestId);

      case 'deleteUserSign':
        return await userSignsService.deleteUserSign(body, awsRequestId);

      // Caso di default — non dovrebbe mai verificarsi data la validazione sopra
      default:
        return buildResponse(400, {
          success: false,
          message: `Azione sconosciuta: "${action}". Azioni valide: ${VALID_ACTIONS.join(', ')}`,
        });
    }
  } catch (err) {
    // Errore interno — log strutturato senza esporre dettagli al client
    log('error', awsRequestId, {
      operation: 'handler',
      errorType: err.constructor.name || 'UnexpectedError',
      message: err.message,
    });

    return buildResponse(500, {
      success: false,
      message: 'Errore interno del server',
    });
  }
};
