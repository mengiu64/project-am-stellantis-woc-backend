'use strict';

// Modulo client HTTP per la Lambda srpV360Ota.
// Esegue richieste HTTPS con logging JSON strutturato e redazione automatica dei dati sensibili.
// Utilizza esclusivamente il modulo nativo Node.js `https` senza dipendenze npm.

const https = require('https');

// Pattern regex per identificare chiavi sensibili: il loro valore viene sempre mascherato nei log
const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|authorization|pwd/i;

// Lunghezza massima del body nei log (caratteri) — oltre questo limite viene troncato
const MAX_LOG_BODY_LENGTH = 4000;

/**
 * Tronca una stringa alla lunghezza massima consentita per i log.
 * Se la stringa supera MAX_LOG_BODY_LENGTH caratteri, viene tagliata e viene aggiunto il suffisso `...[truncated]`.
 * @param {string} str - Stringa da troncare
 * @returns {string} Stringa originale o troncata con suffisso
 */
function truncate(str) {
  // Se il valore non è una stringa, lo restituisce invariato
  if (typeof str !== 'string') return str;
  // Verifica se la lunghezza supera il limite massimo
  return str.length > MAX_LOG_BODY_LENGTH
    ? `${str.slice(0, MAX_LOG_BODY_LENGTH)}...[truncated]`
    : str;
}

/**
 * Maschera i valori degli header HTTP che corrispondono a chiavi sensibili.
 * Gli header con nome corrispondente al pattern (password, secret, token, ecc.)
 * vengono sostituiti con "***REDACTED***".
 * @param {object} headers - Oggetto con gli header HTTP
 * @returns {object} Header con valori sensibili mascherati
 */
function redactHeaders(headers = {}) {
  // Oggetto di output con gli header redatti
  const out = {};
  // Itera su ogni coppia chiave-valore degli header
  for (const [key, value] of Object.entries(headers)) {
    // Se la chiave corrisponde al pattern sensibile, maschera il valore
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***REDACTED***' : value;
  }
  return out;
}

/**
 * Maschera ricorsivamente i valori associati a chiavi sensibili (password, secret,
 * token, apiKey, ...) in un body JSON, oppure — se il body è una stringa non-JSON
 * (es. form-urlencoded) — maschera i valori dei parametri con nome sensibile.
 * @param {*} body - Body della richiesta/risposta da redarre
 * @returns {*} Body con valori sensibili mascherati
 */
function redactBody(body) {
  // Se il body è null o undefined, lo restituisce invariato
  if (body == null) return body;

  // Se il body è una stringa, tenta il parsing JSON per redazione ricorsiva
  if (typeof body === 'string') {
    try {
      // Prova a parsare come JSON e applica la redazione ricorsivamente
      return redactBody(JSON.parse(body));
    } catch {
      // Se non è JSON valido, tratta come form-urlencoded e maschera i parametri sensibili
      const masked = body.replace(
        /([\w.-]*(?:pass(?:word)?|secret|token|api[-_]?key|pwd)[\w.-]*=)([^&]+)/gi,
        '$1***REDACTED***'
      );
      // Tronca il risultato se supera la lunghezza massima
      return truncate(masked);
    }
  }

  // Se il body è un array, applica la redazione a ogni elemento
  if (Array.isArray(body)) return body.map(redactBody);

  // Se il body è un oggetto, itera sulle proprietà e redige i valori sensibili
  if (typeof body === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(body)) {
      // Se la chiave corrisponde al pattern sensibile, maschera il valore
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***REDACTED***' : redactBody(value);
    }
    return out;
  }

  // Per tutti gli altri tipi (numero, booleano, ecc.), restituisce invariato
  return body;
}

/**
 * Esegue una richiesta HTTPS e restituisce una Promise con { statusCode, headers, body }.
 * Logga richiesta e risposta (con dati sensibili mascherati) su CloudWatch per troubleshooting.
 * @param {object} options - Opzioni per https.request di Node.js
 * @param {string|Buffer|null} [body] - Corpo opzionale della richiesta
 * @returns {Promise<{statusCode: number, headers: object, body: any}>} Risposta HTTP
 */
function httpsRequest(options, body = null) {
  // Registra il timestamp di inizio per calcolare la durata
  const startedAt = Date.now();
  // Costruisce l'URL completo dalla hostname e path delle opzioni
  const url = `https://${options.hostname}${options.path}`;

  // Log strutturato della richiesta in uscita (con header e body redatti)
  console.log(JSON.stringify({
    logType: 'http_request',
    method: options.method,
    url,
    headers: redactHeaders(options.headers),
    body: redactBody(body),
  }));

  // Restituisce una Promise che incapsula la richiesta HTTPS nativa
  return new Promise((resolve, reject) => {
    // Crea la richiesta HTTPS con le opzioni fornite
    const req = https.request(options, (res) => {
      // Array per accumulare i chunk della risposta
      const chunks = [];
      // Aggiunge ogni chunk ricevuto all'array
      res.on('data', (chunk) => chunks.push(chunk));
      // Alla fine della risposta, assembla e processa il body
      res.on('end', () => {
        // Concatena tutti i chunk e converte in stringa UTF-8
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          // Tenta il parsing JSON del body della risposta
          parsed = JSON.parse(raw);
        } catch {
          // Se il parsing fallisce, usa la stringa grezza
          parsed = raw;
        }

        // Log strutturato della risposta ricevuta (con header e body redatti)
        console.log(JSON.stringify({
          logType: 'http_response',
          method: options.method,
          url,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          headers: redactHeaders(res.headers),
          body: redactBody(parsed),
        }));

        // Risolve la Promise con statusCode, headers e body parsato
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    // Gestisce gli errori di rete (DNS, timeout, connessione rifiutata, ecc.)
    req.on('error', (err) => {
      // Log strutturato dell'errore di rete
      console.log(JSON.stringify({
        logType: 'http_error',
        method: options.method,
        url,
        durationMs: Date.now() - startedAt,
        error: err.message,
      }));
      // Rigetta la Promise con l'errore originale
      reject(err);
    });

    // Scrive il body nella richiesta se presente
    if (body) {
      req.write(body);
    }

    // Chiude la richiesta e invia i dati al server
    req.end();
  });
}

// Esporta tutte le funzioni per utilizzo nel modulo e nei test
module.exports = { httpsRequest, redactHeaders, redactBody, truncate };
