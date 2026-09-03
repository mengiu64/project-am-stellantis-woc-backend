'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – GET available hours for receptionist (getAvHoursForRec)
 *
 * Calls availableHours + appointment internally, then filters out busy slots.
 *
 * Expected params: { pdvId, date, ccs, locale }
 *   date: YYYYMMDD or YYYY-MM-DD
 *
 * Nota: ldapId non è (più) un parametro di input accettato da questo handler;
 * viene comunque inviato (vuoto) all'endpoint appointment internamente da
 * agendaSOAClient.getAvHoursForRec.
 */
exports.handler = async (event) => {
  // Variabile che conterrà i parametri risolti dopo il parsing/validazione dell'input.
  let params;
  try {
    // Parsing dell'input isolato: un body malformato (JSON.parse) solleva qui un'eccezione.
    params = parseParams(event);
    // Validazione dell'input: individua i parametri obbligatori mancanti.
    const missing = ['pdvId', 'date', 'ccs', 'locale'].filter((k) => !params[k]);
    if (missing.length) {
      // Segnala l'input non valido come eccezione così da mapparlo su 400 nel catch dedicato.
      throw new Error(`Missing required params: ${missing.join(', ')}`);
    }
  } catch (err) {
    // Body malformato / input non valido -> 400 (distinto dagli errori non gestiti 500).
    return response(400, { success: false, message: err.message });
  }

  // Estrae i parametri necessari alla chiamata downstream dopo la validazione.
  const { pdvId, date, ccs, locale } = params;

  try {
    // Costruzione del client e chiamata downstream (eventuali errori qui sono non gestiti).
    const client = await buildClient();
    const result = await client.getAvHoursForRec(pdvId, date, ccs, locale);
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
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
