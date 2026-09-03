'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – POST createnaga
 *
 * Full appointment payload must be in event.body (JSON string).
 */
exports.handler = async (event) => {
  // Fase di parsing/validazione input isolata: un body malformato o input
  // non valido deve tradursi in 400 (tabella errori E5), distinguendolo dal 500.
  let body;
  try {
    body = parseParams(event);
  } catch (err) {
    // Body JSON malformato / input non valido -> 400 (E5, Req 3.3, 6.6)
    return response(400, { success: false, message: err.message });
  }

  // Fase di invocazione del client: gli errori non gestiti (es. init mTLS
  // fallita) restano 500 (E6); l'esito applicativo negativo diventa 502 (E4).
  try {
    const client = await buildClient();
    const result = await client.createnaga(body);
    return response(result.success ? 200 : 502, result);
  } catch (err) {
    // Errori non gestiti -> 500 (E6)
    return response(500, { success: false, message: err.message });
  }
};

/**
 * Estrae il payload dall'evento.
 * Se presente, event.body (stringa JSON) viene deserializzato; altrimenti si
 * usano direttamente i parametri event.params. Un JSON.parse su body malformato
 * solleva SyntaxError, intercettato dal chiamante per restituire 400.
 */
function parseParams(event) {
  return event.body ? JSON.parse(event.body) : (event.params || {});
}

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
