'use strict';

require('dotenv').config();
const AgendaNagaClient = require('./agendaNagaClient');

/**
 * Builds a configured AgendaNagaClient from environment variables.
 * Override any field by passing explicit config values.
 */
function buildClient(overrides = {}) {
  return new AgendaNagaClient({
    host:     process.env.AGENDA_SOA_HOST,
    username: process.env.AGENDA_SOA_USERNAME,
    password: process.env.AGENDA_SOA_PASSWORD,
    apiKey:   process.env.AGENDA_SOA_API_KEY,
    proxy:    process.env.AGENDA_SOA_PROXY,
    ...overrides,
  });
}

module.exports = { buildClient };
