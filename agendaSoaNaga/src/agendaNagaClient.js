'use strict';

const axios = require('axios');

const ALLOWED_STATUS_CODES = [200, 201, 202, 203, 204, 205, 206];

// Chiavi considerate sensibili: il loro valore viene sempre mascherato nei log
const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|authorization|pwd|authUser/i;
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

function redactBody(body) {
  if (body == null) return body;
  if (Array.isArray(body)) return body.map(redactBody);
  if (typeof body === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(body)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***REDACTED***' : redactBody(value);
    }
    return out;
  }
  if (typeof body === 'string') return truncate(body);
  return body;
}

/**
 * AgendaNaga REST Client for Node.js
 * Handles NAGA appointment creation and update endpoints.
 */
class AgendaNagaClient {
  /**
   * @param {object} config
   * @param {string} config.host       - Base URL of the AgendaSOA service
   * @param {string} config.username   - Basic-auth username
   * @param {string} config.password   - Basic-auth password
   * @param {string} [config.apiKey]   - Static API-Key (optional)
   * @param {string} [config.proxy]    - Proxy URL (optional)
   * @param {https.Agent} [config.httpsAgent] - Agent mTLS (certificato client), opzionale
   */
  constructor(config = {}) {
    this.host     = config.host     || process.env.AGENDA_SOA_HOST;
    this.username = config.username || process.env.AGENDA_SOA_USERNAME;
    this.password = config.password || process.env.AGENDA_SOA_PASSWORD;
    this.apiKey   = config.apiKey   || process.env.AGENDA_SOA_API_KEY;

    const axiosConfig = {
      baseURL: this.host,
      timeout: 30000,
    };

    if (config.httpsAgent) {
      axiosConfig.httpsAgent = config.httpsAgent;
    }

    this.http = axios.create(axiosConfig);

    this.http.interceptors.request.use((req) => {
      req.metadata = { startedAt: Date.now() };
      console.log(JSON.stringify({
        logType: 'http_request',
        service: 'agendaSoaNaga',
        method: req.method?.toUpperCase(),
        url: (req.baseURL || '') + req.url,
        headers: redactHeaders(req.headers),
        params: req.params,
        body: redactBody(req.data),
      }));
      return req;
    });

    this.http.interceptors.response.use((res) => {
      console.log(JSON.stringify({
        logType: 'http_response',
        service: 'agendaSoaNaga',
        method: res.config?.method?.toUpperCase(),
        url: (res.config?.baseURL || '') + (res.config?.url || ''),
        statusCode: res.status,
        durationMs: res.config?.metadata ? Date.now() - res.config.metadata.startedAt : undefined,
        headers: redactHeaders(res.headers),
        body: redactBody(res.data),
      }));
      return res;
    }, (err) => {
      console.log(JSON.stringify({
        logType: 'http_error',
        service: 'agendaSoaNaga',
        method: err.config?.method?.toUpperCase(),
        url: err.config ? (err.config.baseURL || '') + err.config.url : undefined,
        statusCode: err.response?.status,
        error: err.message,
        body: redactBody(err.response?.data),
      }));
      return Promise.reject(err);
    });
  }

  // ─── private helpers ────────────────────────────────────────────────────────

  _basicAuthHeader() {
    const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  async _post(urlPath, body = {}) {
    const response = await this.http.post(urlPath, body, {
      headers: {
        ...this._basicAuthHeader(),
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });
    return this._processResponse(response);
  }

  _processResponse(response) {
    const success = ALLOWED_STATUS_CODES.includes(response.status);
    if (!success) {
      return {
        success: false,
        data: `${response.status}: ${response.data?.status ?? 'GENERIC'}: ${response.data?.message ?? 'ERROR'}`,
      };
    }
    return {
      success: true,
      data: response.data,
    };
  }

  // ─── public API methods ──────────────────────────────────────────────────────

  /**
   * POST appointmentrest/rdvs/v1/createnaga
   * Creates a new appointment (NAGA).
   *
   * @param {object} body  - Appointment payload
   */
  async createnaga(body) {
    return this._post('appointmentrest/rdvs/v1/createnaga', body);
  }

  /**
   * POST appointmentrest/rdvs/v1/updatenaga/{apptId}
   * Updates an existing appointment (NAGA).
   *
   * @param {object} body    - Appointment payload (authUser is added automatically)
   * @param {string} apptId  - Appointment identifier to update
   */
  async updatenaga(body, apptId) {
    const authUser = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return this._post(`appointmentrest/rdvs/v1/updatenaga/${apptId}`, { ...body, authUser });
  }
}

module.exports = AgendaNagaClient;
