const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Generic HTTPS POST. Resolves with { status, data } where data is the
 * parsed JSON body (or null on parse failure).
 * Rejects with a "TimeoutError" on timeout or a network error.
 *
 * @param {string} url
 * @param {{ headers?: object, timeoutMs?: number }} options
 * @param {string} body - already-serialised request body
 */
function httpsPost(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }, body) {
  const { hostname, port, pathname, search } = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port: port || 443,
        path: pathname + search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(
        Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })
      );
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { httpsPost };
