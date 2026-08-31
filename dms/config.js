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
  'DMS_PING_CLIENT_ID',
  'DMS_PING_CLIENT_SECRET',
  'DML_IBM_CLIENT_ID',
  'DML_IBM_CLIENT_SECRET',
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
    scope: 'prd:dmy',
    clientId: process.env.DMS_PING_CLIENT_ID,
    clientSecret: process.env.DMS_PING_CLIENT_SECRET,
  },

  // Stellantis DML API (IBM API Connect gateway — emea-aws.dev.np-api.stellantis.com)
  dml: {
    baseUrl: 'https://emea-aws.dev.np-api.stellantis.com',
    settingsPath: '/ps-dev/extra/dml/dms-settings/v1/settings',
    inquiryPath: '/ps-dev/extra/dml/aftersales/v1/inquiry',
    ibmClientId: process.env.DML_IBM_CLIENT_ID,
    ibmClientSecret: process.env.DML_IBM_CLIENT_SECRET,
    xTargetEnv: process.env.DML_X_TARGET_ENV || 'stage',
  },
  // ApplicationArea.Sender defaults (optional, used in CLI inquiry command)
  sender: {
    componentId:          process.env.DML_SENDER_COMPONENT_ID     || '1.0.0',
    dealerNumberId:       process.env.DML_SENDER_DEALER_ID        || '0062230',
    dealerNumberIdSource: process.env.DML_SENDER_DEALER_ID_SRC    || '0062230',
    dealerCountryCode:    process.env.DML_SENDER_COUNTRY          || 'FR',
    languageCode:         process.env.DML_SENDER_LANGUAGE         || 'fr-FR',
    physicalSiteId:       process.env.DML_SENDER_SITE_ID          || '001',
    serviceId:            process.env.DML_SENDER_SERVICE_ID       || 'FR-0062230.D001',
    currencyId:           process.env.DML_SENDER_CURRENCY         || 'EUR',
    brand:                process.env.DML_SENDER_BRAND            || 'FT',
  },
};
