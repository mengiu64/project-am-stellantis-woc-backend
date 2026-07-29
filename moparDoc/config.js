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
  'MOPARDOC_PING_CLIENT_ID',
  'MOPARDOC_PING_CLIENT_SECRET',
  'MOPARDOC_IBM_CLIENT_ID',
  'MOPARDOC_IBM_CLIENT_SECRET',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`[config] Missing required environment variables: ${missing.join(', ')}`);
}

module.exports = {
  // PingFederate token endpoint — stesso host/scope (prd:dgt) di jobcard/djc,
  // ma con un client dedicato a MoparDoc (client_id/secret diversi).
  auth: {
    url: 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dgt',
    clientId: process.env.MOPARDOC_PING_CLIENT_ID,
    clientSecret: process.env.MOPARDOC_PING_CLIENT_SECRET,
  },

  // job-docs connector (PSA/groupe-psa.com) — CreateJobCard
  jobDocs: {
    baseUrl: 'https://api-oidc-preprod.groupe-psa.com',
    basePath: '/job-docs/connector/v1',
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID,
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET,
  },

  // MoparDocs Browser API (FCA/Fiat) — getUploadDocURL, UploadedDoc
  moparDocsApi: {
    baseUrl: 'https://lab-examaftersales.fiat.com',
    basePath: '/Mopardocs/MoparDocsApi/Browser',
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID,
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET,
  },
};
