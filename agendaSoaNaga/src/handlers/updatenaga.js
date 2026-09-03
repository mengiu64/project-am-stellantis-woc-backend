'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – POST updatenaga
 *
 * event.body must be a JSON string with the appointment payload.
 * event.pathParameters.apptId (or event.params.apptId) must contain the
 * appointment identifier.
 */
exports.handler = async (event) => {
  // Fase di parsing/validazione input isolata: apptId mancante o body JSON
  // malformato devono tradursi in 400 (tabella errori E5), non in 500.
  let apptId;
  let body;
  try {
    ({ apptId, body } = parseParams(event));
  } catch (err) {
    // Body JSON malformato / input non valido -> 400 (E5, Req 3.3, 6.6)
    return response(400, { success: false, message: err.message });
  }

  // Fase di invocazione del client: gli errori non gestiti (es. init mTLS
  // fallita) restano 500 (E6); l'esito applicativo negativo diventa 502 (E4).
  try {
    const client = await buildClient();
    const result = await client.updatenaga(body, apptId);
    return response(result.success ? 200 : 502, result);
  } catch (err) {
    // Errori non gestiti -> 500 (E6)
    return response(500, { success: false, message: err.message });
  }
};

/**
 * Estrae apptId e payload dall'evento.
 * apptId proviene da event.pathParameters.apptId o event.params.apptId ed è
 * obbligatorio: la sua assenza è un input non valido e solleva un errore
 * intercettato dal chiamante per restituire 400.
 * Il payload deriva da event.body (stringa JSON deserializzata) oppure da
 * event.params; un body malformato solleva SyntaxError (anch'esso -> 400).
 */
function parseParams(event) {
  const apptId =
    (event.pathParameters && event.pathParameters.apptId) ||
    (event.params && event.params.apptId);

  if (!apptId) {
    throw new Error('Missing required param: apptId');
  }

  const body = event.body ? JSON.parse(event.body) : (event.params || {});
  return { apptId, body };
}

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
