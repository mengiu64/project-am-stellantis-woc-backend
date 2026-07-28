'use strict';

const https = require('https');

// Chiavi considerate sensibili: il loro valore viene sempre mascherato nei log
const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|authorization|pwd/i;
const MAX_LOG_BODY_LENGTH = 4000;

function truncate(str) {
  if (typeof str !== 'string') return str;
  return str.length > MAX_LOG_BODY_LENGTH
    ? `${str.slice(0, MAX_LOG_BODY_LENGTH)}...[truncated]`
    : str;
}

function redactHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***REDACTED***' : value;
  }
  return out;
}

/**
 * Maschera ricorsivamente i valori associati a chiavi sensibili (password, secret,
 * token, apiKey, ...) in un body JSON, oppure — se il body è una stringa non-JSON
 * (es. form-urlencoded) — maschera i valori dei parametri con nome sensibile.
 */
function redactBody(body) {
  if (body == null) return body;

  if (typeof body === 'string') {
    try {
      return redactBody(JSON.parse(body));
    } catch {
      const masked = body.replace(
        /([\w.-]*(?:pass(?:word)?|secret|token|api[-_]?key|pwd)[\w.-]*=)([^&]+)/gi,
        '$1***REDACTED***'
      );
      return truncate(masked);
    }
  }

  if (Array.isArray(body)) return body.map(redactBody);

  if (typeof body === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(body)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***REDACTED***' : redactBody(value);
    }
    return out;
  }

  return body;
}

/**
 * Performs an HTTPS request and returns a Promise resolving to { statusCode, headers, body }.
 * Logga request e response (con dati sensibili mascherati) su CloudWatch per troubleshooting.
 * @param {object} options - Node.js https.request options
 * @param {string|Buffer|null} [body] - optional request body
 */
function httpsRequest(options, body = null) {
  const startedAt = Date.now();
  const url = `https://${options.hostname}${options.path}`;

  console.log(JSON.stringify({
    logType: 'http_request',
    method: options.method,
    url,
    headers: redactHeaders(options.headers),
    body: redactBody(body),
  }));

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }

        console.log(JSON.stringify({
          logType: 'http_response',
          method: options.method,
          url,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          headers: redactHeaders(res.headers),
          body: redactBody(parsed),
        }));

        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', (err) => {
      console.log(JSON.stringify({
        logType: 'http_error',
        method: options.method,
        url,
        durationMs: Date.now() - startedAt,
        error: err.message,
      }));
      reject(err);
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

module.exports = { httpsRequest };
