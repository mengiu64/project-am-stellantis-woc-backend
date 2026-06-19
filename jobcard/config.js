'use strict';

// Load .env file for local development (no external dependencies)
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    });
}

// Validate required environment variables
const REQUIRED_ENV = [
  'PING_CLIENT_ID',
  'PING_CLIENT_SECRET',
  'DGT_CLIENT_ID',
  'DGT_CLIENT_SECRET',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`[config] Missing required environment variables: ${missing.join(', ')}`);
}

module.exports = {
  // PingFederate token endpoint
  auth: {
    url: 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dgt',
    clientId: process.env.PING_CLIENT_ID,
    clientSecret: process.env.PING_CLIENT_SECRET,
  },

  // Stellantis DGT API
  dgt: {
    baseUrl: 'https://emea-aws.stage.np-api.stellantis.com',
    basePath: '/ps-stage/extra/srp/digital-layer/v1',
    clientId: process.env.DGT_CLIENT_ID,
    clientSecret: process.env.DGT_CLIENT_SECRET,
  },
};
