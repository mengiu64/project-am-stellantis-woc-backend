'use strict';

const axios = require('axios');

const ALLOWED_STATUS_CODES = [200, 201, 202, 203, 204, 205, 206];

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
   */
  constructor(config = {}) {
    this.host     = config.host     || process.env.AGENDA_SOA_HOST;
    this.username = config.username || process.env.AGENDA_SOA_USERNAME;
    this.password = config.password || process.env.AGENDA_SOA_PASSWORD;
    this.apiKey   = config.apiKey   || process.env.AGENDA_SOA_API_KEY;

    this.http = axios.create({
      baseURL: this.host,
      timeout: 30000,
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
