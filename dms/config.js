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
    clientId: process.env.PING_CLIENT_ID,
    clientSecret: process.env.PING_CLIENT_SECRET,
  },

  // Stellantis DML API
  dml: {
    baseUrl: 'https://api-async-dml.bsn0027990-stage-f4ou0acl.np.stla-aws.net',
    basePath: '/dms',
    ibmClientId: process.env.DML_IBM_CLIENT_ID,
    ibmClientSecret: process.env.DML_IBM_CLIENT_SECRET,
    xTargetEnv: process.env.DML_X_TARGET_ENV || 'stage',
  },
};
