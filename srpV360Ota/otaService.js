'use strict';

// Modulo servizio OTA per la Lambda srpV360Ota.
// Implementa la logica di business per la chiamata all'endpoint upstream otaCompatibility.
// Valida i parametri, applica i valori di default, costruisce la richiesta e gestisce la risposta.

const { URL } = require('url');
const crypto = require('crypto');
const { httpsRequest } = require('./httpClient');
const { getConfig } = require('./config');

/**
 * Invoca l'endpoint upstream otaCompatibility per verificare la compatibilità OTA di un veicolo.
 * Valida il parametro VIN, applica i default per includeOtaHistoryData e locale,
 * costruisce la richiesta POST con tutti gli header richiesti e restituisce la risposta invariata.
 * @param {string} bearerToken - Token Bearer ottenuto da PingFederate
 * @param {object} params - Parametri della richiesta: { vin, includeOtaHistoryData?, locale? }
 * @returns {Promise<object>} Risposta upstream non trasformata
 * @throws {Error} Se il parametro vin è assente o vuoto
 * @throws {Error} Se la risposta upstream ha status diverso da 200
 */
async function otaCompatibility(bearerToken, params = {}) {
  // Estrae i parametri dalla richiesta
  const { vin, includeOtaHistoryData, locale } = params;

  // Validazione: il VIN è obbligatorio per la chiamata upstream
  if (!vin) {
    throw new Error('[srpV360Ota] vin is required for otaCompatibility');
  }

  // Carica la configurazione (asincrona — credenziali da SSM/Secrets Manager)
  const config = await getConfig();

  // Costruisce il body della richiesta con i valori di default dalla configurazione
  const body = {
    vin,
    // Applica il default 'true' se includeOtaHistoryData non è fornito
    includeOtaHistoryData: includeOtaHistoryData !== undefined ? includeOtaHistoryData : config.otaDefaults.includeOtaHistoryData,
    // Applica il default 'en_US' se locale non è fornito
    locale: locale || config.otaDefaults.locale,
  };

  // Costruisce l'URL base dall'oggetto di configurazione srp
  const base = new URL(config.srp.baseUrl);
  // Serializza il body in formato JSON per l'invio
  const bodyStr = JSON.stringify(body);

  // Configura le opzioni della richiesta HTTPS verso il servizio upstream
  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: `${config.srp.basePath}/otaCompatibility`,
    method: 'POST',
    headers: {
      // Tipo di contenuto della richiesta
      'Content-Type': 'application/json',
      // Formato di risposta accettato
      Accept: 'application/json',
      // Lunghezza del body in byte per il Content-Length
      'Content-Length': Buffer.byteLength(bodyStr),
      // Credenziali IBM API Connect per l'autenticazione upstream
      'X-IBM-Client-Id': config.srp.clientId,
      'X-IBM-Client-Secret': config.srp.clientSecret,
      // Token Bearer PingFederate per l'autorizzazione
      Authorization: `Bearer ${bearerToken}`,
      // Identificativo di tracciabilità distribuita — 16 caratteri esadecimali casuali
      'x-trace-id': crypto.randomBytes(8).toString('hex'),
    },
  };

  // Log in italiano: URL e body della richiesta verso il servizio upstream
  console.log(`[srpV360Ota] Invio richiesta POST https://${options.hostname}${options.path}`);
  console.log(`[srpV360Ota] Body richiesta: ${bodyStr}`);

  // Esegue la richiesta HTTPS verso il servizio upstream
  const response = await httpsRequest(options, bodyStr);

  // Verifica lo status della risposta upstream
  if (response.statusCode !== 200) {
    // Lancia errore formattato in caso di risposta non-200
    throw new Error(
      `[srpV360Ota] otaCompatibility fallita: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  // Restituisce il body della risposta upstream senza alcuna trasformazione
  return response.body;
}

// Esporta la funzione per l'utilizzo nel handler Lambda
module.exports = { otaCompatibility };
