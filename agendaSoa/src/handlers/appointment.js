'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – GET appointment
 *
 * Expected queryStringParameters / body:
 *   { ccs: "...", date: "YYYY-MM-DD", ldapId: "...", pdvId: "...", locale: "..." }
 */
exports.handler = async (event) => {
  // Variabile che conterrà i parametri risolti dopo il parsing/validazione dell'input.
  let params;
  try {
    // Parsing/validazione dell'input isolati: eventuali body malformati (JSON.parse)
    // o input non validi sollevano qui un'eccezione (es. SyntaxError).
    params = parseParams(event);
  } catch (err) {
    // Body malformato / input non valido -> 400 (distinto dagli errori non gestiti 500).
    return response(400, { success: false, message: err.message });
  }

  try {
    // Costruzione del client e chiamata downstream: eventuali errori qui (es. init mTLS)
    // sono errori non gestiti applicativi.
    const client = await buildClient();
    const result = await client.appointment(params);
    // 200 su esito applicativo positivo, 502 su esito applicativo negativo.
    return response(result.success ? 200 : 502, result);
  } catch (err) {
    // Errore non gestito durante l'elaborazione -> 500.
    return response(500, { success: false, message: err.message });
  }
};

function parseParams(event) {
  return {
    ...(event.queryStringParameters || {}),
    ...(event.body ? JSON.parse(event.body) : {}),
    ...(event.params || {}),
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
