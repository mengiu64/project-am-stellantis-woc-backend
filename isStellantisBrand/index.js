'use strict';

/**
 * index.js — Lambda handler per isStellantisBrand
 *
 * Verifica se un codice brand ARCAD (ar_codbrand) appartiene al gruppo Stellantis,
 * consultando la tabella woc.anag_brand su Aurora PostgreSQL tramite RDS Proxy.
 */

// Libreria condivisa per connessione al database
const { getPool } = require('./shared/dbClient');

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
 * Handler principale della Lambda isStellantisBrand.
 *
 * Riceve una richiesta GET con il parametro ar_codbrand,
 * valida l'input, e interroga il database per verificare l'appartenenza al gruppo Stellantis.
 *
 * @param {object} event - Evento API Gateway Proxy
 * @param {object} context - Contesto Lambda (contiene awsRequestId)
 * @returns {Promise<{ statusCode: number, headers: object, body: string }>}
 */
exports.handler = async (event, context) => {
  const awsRequestId = context.awsRequestId;

  try {
    // Estrazione del parametro ar_codbrand dai query string parameters
    const params = event.queryStringParameters;
    const arCodbrand = params ? params.ar_codbrand : undefined;

    // Log della richiesta ricevuta
    log('info', awsRequestId, {
      operation: 'handler',
      message: 'Richiesta ricevuta',
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
      operation: 'handler',
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
