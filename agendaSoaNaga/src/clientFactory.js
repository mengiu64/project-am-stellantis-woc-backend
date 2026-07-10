'use strict';

require('dotenv').config();
const AgendaNagaClient = require('./agendaNagaClient');
const { getHttpsAgent } = require('./certService');

/**
 * Builds a configured AgendaNagaClient from environment variables.
 * Override any field by passing explicit config values.
 * Loads (and caches) the mTLS httpsAgent from S3 unless one is passed via `overrides`.
 */
async function buildClient(overrides = {}) {
  const { httpsAgent: httpsAgentOverride, ...restOverrides } = overrides;
  const httpsAgent = httpsAgentOverride !== undefined
    ? httpsAgentOverride
    : await getHttpsAgent();

  return new AgendaNagaClient({
    host:     process.env.AGENDA_SOA_HOST,
    username: process.env.AGENDA_SOA_USERNAME,
    password: process.env.AGENDA_SOA_PASSWORD,
    apiKey:   process.env.AGENDA_SOA_API_KEY,
    proxy:    process.env.AGENDA_SOA_PROXY,
    httpsAgent,
    ...restOverrides,
  });
}

module.exports = { buildClient };
