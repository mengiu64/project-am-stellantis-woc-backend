'use strict';

/**
 * index.js — Punto di ingresso della Lambda srpV360Ota
 *
 * Utilizzo CLI:
 *   node index.js otaCompatibility <vin> [opzioni]
 *
 * Opzioni per "otaCompatibility" (chiave=valore):
 *   includeOtaHistoryData=true|false   (default: false)
 *   locale=<valore>                    (es. en_US)
 *
 * Esempi:
 *   node index.js otaCompatibility VR3UPHPX5P4347291
 *   node index.js otaCompatibility VR3UPHPX5P4347291 includeOtaHistoryData=true locale=fr_FR
 */

// Importa il servizio di autenticazione PingFederate
const { getBearerToken } = require('./authService');
// Importa la funzione di business per la compatibilità OTA
const { otaCompatibility } = require('./otaService');

// ── Handler Lambda ────────────────────────────────────────────────────────────

// Elenco delle azioni valide accettate dall'handler
const VALID_ACTIONS = ['otaCompatibility'];

/**
 * Risolve { action, body } da uno dei due formati possibili:
 *  1) Invocazione diretta Lambda: { "action": "otaCompatibility", "body": {...} }
 *  2) Evento API Gateway proxy integration: l'azione è l'ultimo segmento del path
 *     (es. .../v360/otaCompatibility → "otaCompatibility") e il body è costruito
 *     unendo queryStringParameters con il body JSON della richiesta.
 * @param {object} event - Evento Lambda (diretto o API Gateway proxy)
 * @returns {{ action: string|undefined, body: object }} Azione e parametri estratti
 */
function resolveActionAndBody(event) {
  // Formato 1: invocazione diretta con campo action esplicito
  if (event && event.action) {
    // Parsa il body se è una stringa JSON, altrimenti usa l'oggetto direttamente
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body)
      : (event.body || {});
    return { action: event.action, body };
  }

  // Formato 2: evento API Gateway proxy integration
  // Estrae il path dall'evento (supporta rawPath, path e pathParameters.proxy)
  const rawPath = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  // Divide il path in segmenti rimuovendo quelli vuoti
  const segments = String(rawPath).split('/').filter(Boolean);
  // L'azione corrisponde all'ultimo segmento del path decodificato
  const action = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;

  // Tenta di parsare il body della richiesta
  let parsedBody = {};
  if (event.body) {
    try {
      // Parsa il body se è una stringa JSON
      parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (_) {
      // Body non valido — ignora e usa oggetto vuoto
      parsedBody = {};
    }
  }

  // Unisce i parametri della query string con il body parsato
  const body = { ...(event.queryStringParameters || {}), ...parsedBody };
  return { action, body };
}

/**
 * Handler principale della Lambda.
 * Risolve l'azione dall'evento, la valida e la instrada verso il servizio OTA.
 * Gestisce gli errori classificandoli in HTTP 400 (input errato) o HTTP 502 (errore infrastrutturale).
 * @param {object} event - Evento Lambda (diretto o API Gateway proxy)
 * @returns {Promise<{statusCode: number, headers: object, body: string}>} Risposta HTTP
 */
exports.handler = async (event) => {
  // Risolve azione e body dall'evento ricevuto
  const { action, body } = resolveActionAndBody(event);

  // Verifica che l'azione sia presente e valida
  if (!action || !VALID_ACTIONS.includes(action)) {
    // Restituisce HTTP 400 per azioni sconosciute con messaggio in italiano
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: `Azione sconosciuta: "${action}". Azioni valide: otaCompatibility`,
      }),
    };
  }

  try {
    // Ottiene il token Bearer da PingFederate (con cache)
    const token = await getBearerToken();
    // Invoca il servizio OTA con il token e i parametri della richiesta
    const result = await otaCompatibility(token, body);

    // Restituisce HTTP 200 con il risultato del servizio upstream
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    // Classifica l'errore: 400 se è un errore di validazione input, 502 altrimenti
    const statusCode = err.message.includes('is required') ? 400 : 502;
    // Restituisce la risposta di errore con il messaggio appropriato
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

/**
 * Parsa argomenti CLI nel formato chiave=valore in un oggetto.
 * @param {string[]} args - Array di stringhe "chiave=valore"
 * @returns {object} Oggetto con le coppie chiave-valore estratte
 */
function parseKvArgs(args) {
  // Oggetto risultato per le coppie chiave-valore
  const result = {};
  for (const arg of args) {
    // Cerca il separatore '=' nell'argomento
    const idx = arg.indexOf('=');
    // Ignora argomenti senza separatore
    if (idx === -1) continue;
    // Estrae la chiave (parte prima del '=')
    const key = arg.slice(0, idx).trim();
    // Estrae il valore (parte dopo il '=')
    const raw = arg.slice(idx + 1).trim();
    // Aggiunge la coppia all'oggetto risultato
    result[key] = raw;
  }
  return result;
}

/**
 * Esegue l'azione otaCompatibility da CLI.
 * @param {string} vin - VIN del veicolo
 * @param {string[]} extraArgs - Argomenti aggiuntivi nel formato chiave=valore
 */
async function runOtaCompatibility(vin, extraArgs) {
  // Intestazione per l'output CLI
  console.log('\n=== OTA Compatibility ===');
  // Costruisce i parametri unendo il VIN con gli argomenti aggiuntivi
  const params = { vin, ...parseKvArgs(extraArgs) };
  // Ottiene il token Bearer da PingFederate
  const token = await getBearerToken();
  // Invoca il servizio OTA con il token e i parametri
  const result = await otaCompatibility(token, params);
  // Stampa il risultato formattato in JSON
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Funzione principale per l'esecuzione da riga di comando.
 * Supporta il comando: node index.js otaCompatibility <vin> [chiave=valore ...]
 */
async function main() {
  // Estrae comando, parametro e argomenti aggiuntivi da process.argv
  const [, , command, param, ...rest] = process.argv;

  try {
    // Verifica il comando richiesto
    if (command === 'otaCompatibility') {
      // Usa il VIN fornito o un VIN di default per il test
      const vin = param || 'VR3UPHPX5P4347291';
      await runOtaCompatibility(vin, rest);
    } else {
      // Comando non valido — mostra l'utilizzo corretto
      console.error('[ERRORE] Comando non valido. Usa:');
      console.error('  node index.js otaCompatibility <vin> [chiave=valore ...]');
      process.exit(1);
    }
  } catch (err) {
    // Gestisce errori fatali durante l'esecuzione CLI
    console.error('\n[ERRORE]', err.message);
    process.exit(1);
  }
}

// Esegue la funzione main solo se il file è invocato direttamente da CLI
if (require.main === module) {
  main();
}
