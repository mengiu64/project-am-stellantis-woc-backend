'use strict';

require('dotenv').config();
const AgendaSOAClient = require('./agendaSOAClient');

/**
 * Builds a configured AgendaSOAClient from environment variables.
 * Override any field by passing explicit config values.
 */
function buildClient(overrides = {}) {
  return new AgendaSOAClient({
    host:     process.env.AGENDA_SOA_HOST,
    username: process.env.AGENDA_SOA_USERNAME,
    password: process.env.AGENDA_SOA_PASSWORD,
    apiKey:   process.env.AGENDA_SOA_API_KEY,
    proxy:    process.env.AGENDA_SOA_PROXY,
    ...overrides,
  });
}

module.exports = { buildClient };
