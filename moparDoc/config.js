'use strict';

const config = {
  auth: {
    // PingFederate OAuth2 (client_credentials flow)
    baseUrl: 'https://api-oidc-preprod.groupe-psa.com',
    basePath: '/as/token.oauth2',
    // Endpoint completo PingFederate (baseUrl + basePath) — usato da authService.js per ottenere il token
    url: 'https://api-oidc-preprod.groupe-psa.com/as/token.oauth2',
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
    basePath: '/mopardocs/mopardocs-it/v1',
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

  // MoparDocs Services API (Stellantis) — getJobCardList, associateJobCard, getJobCardAndDocumentList,
  // getDocumentsInfo, associateDocument, getDocuments, DeleteDocuments, DeleteJobcard
  // Endpoint: POST /services/<action> su mopardocs.stellantis.com:4443
  // Fonte: MoparDocs JobCard Associate v 3.0.15.1 documentation
  // Valori di default allineati alla documentazione; override possibile via variabili d'ambiente
  moparDocsServices: {
    baseUrl: process.env.MOPARDOCS_SERVICES_BASE_URL || 'https://mopardocs.stellantis.com:4443', // Host servizio Stellantis (default da documentazione)
    basePath: process.env.MOPARDOCS_SERVICES_PATH || '/services', // Path base comune a tutti i metodi Services
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID, // Credenziale IBM API Connect (condivisa)
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET, // Credenziale IBM API Connect (condivisa)
  },
};

module.exports = config;
