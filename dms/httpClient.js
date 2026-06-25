'use strict';

const https = require('https');

/**
 * Performs an HTTPS request and returns a Promise resolving to { statusCode, headers, body }.
 * @param {object} options - Node.js https.request options
 * @param {string|Buffer|null} [body] - optional request body
 */
function httpsRequest(options, body = null) {
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
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

module.exports = { httpsRequest };
