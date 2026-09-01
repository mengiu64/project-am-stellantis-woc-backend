'use strict';

// Carica il file .env per lo sviluppo locale (nessuna dipendenza esterna)
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

// Valida le variabili d'ambiente obbligatorie all'avvio
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

const config = {
  auth: {
    // PingFederate OAuth2 (client_credentials flow)
    baseUrl: 'https://idfed-preprod.mpsa.com:443',
    basePath: '/as/token.oauth2',
    // Endpoint completo PingFederate (baseUrl + basePath) — usato da authService.js per ottenere il token
    url: 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    // Tipo di grant OAuth2 — client_credentials flow verso PingFederate
    grantType: 'client_credentials',
    clientId: process.env.MOPARDOC_PING_CLIENT_ID, // Client ID PingFederate dedicato (env reale della Lambda)
    clientSecret: process.env.MOPARDOC_PING_CLIENT_SECRET, // Client secret PingFederate dedicato (env reale della Lambda)
    scope: 'prd:mdo',
    // Token cache duration (ms) — ricarica se scaduto + buffer di 30s
    cacheBufferMs: 30000,
  },

  // Job Docs API (PSA job-docs connector) — crea JobCard e token di accesso
  jobDocs: {
    baseUrl: 'https://api-oidc-preprod.groupe-psa.com',
    basePath: '/job-docs/connector/v1', // Path corretto per l'API Gateway IBM (da collection Postman)
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID,
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET,
  },

  // MoparDocs Browser API (Fiat) — upload e download documenti
  moparDocsApi: {
    baseUrl: 'https://lab-examaftersales.fiat.com',
    basePath: '/Mopardocs/MoparDocsApi/Browser',
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID,
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET,
  },

  // MoparDocs Services API — getJobCardList, associateJobCard, getJobCardAndDocumentList,
  // getDocumentsInfo, associateDocument, getDocuments, DeleteDocuments, DeleteJobcard
  // Endpoint: tramite API Gateway IBM (api-oidc-preprod.groupe-psa.com) — stessa infrastruttura di jobDocs
  // Il server diretto (mopardocs.stellantis.com:4443) richiede mutual TLS non supportato da Lambda
  // Override possibile via variabili d'ambiente
  moparDocsServices: {
    baseUrl: process.env.MOPARDOCS_SERVICES_BASE_URL || 'https://api-oidc-preprod.groupe-psa.com', // API Gateway IBM preprod
    basePath: process.env.MOPARDOCS_SERVICES_PATH || '/job-docs/connector/v1', // Path base comune (da collection Postman)
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID, // Credenziale IBM API Connect (condivisa)
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET, // Credenziale IBM API Connect (condivisa)
  },
};

module.exports = config;
