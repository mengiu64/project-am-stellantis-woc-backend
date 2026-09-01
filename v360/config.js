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
  'V360_PING_CLIENT_ID',
  'V360_PING_CLIENT_SECRET',
  'ASV_CLIENT_ID',
  'ASV_CLIENT_SECRET',
  'ASV_GETDETAILS_CLIENT_ID',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`[config] Missing required environment variables: ${missing.join(', ')}`);
}

module.exports = {
  // PingFederate token endpoint
  auth: {
    url: 'https://idfed.mpsa.com:443/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:asv',
    clientId: process.env.V360_PING_CLIENT_ID,
    clientSecret: process.env.V360_PING_CLIENT_SECRET,
  },

  // Stellantis ASV360 API
  asv: {
    baseUrl: 'https://emea-aws.api.stellantis.com',
    basePath: '/ps-prod/extra/asv360/vehicle/v1',
    clientId: process.env.ASV_CLIENT_ID,
    clientSecret: process.env.ASV_CLIENT_SECRET,
  },

  // Default values used by getdetails when not provided in the input (vin is always mandatory and never defaulted).
  // clientId is environment-specific (dev/stage/prod), hence sourced from env var.
  getDetailsDefaults: {
    countryCode: 'FR',
    languageCode: 'fr',
    clientId: process.env.ASV_GETDETAILS_CLIENT_ID,
    offering: 'Vehicle Description, campaign, warranty',
  },

  // Default values used by otaCompatibility when not provided in the input (vin is always mandatory and never defaulted).
  otaCompatibilityDefaults: {
    includeOtaHistoryData: 'true',
    locale: 'en_EN',
  },
};
