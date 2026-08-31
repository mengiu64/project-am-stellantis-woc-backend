'use strict';

const config = {
  auth: {
    // PingFederate OAuth2 (client_credentials flow)
    baseUrl: 'https://api-oidc-preprod.groupe-psa.com',
    basePath: '/as/token.oauth2',
    clientId: process.env.MOPARDOC_CLIENT_ID,
    clientSecret: process.env.MOPARDOC_CLIENT_SECRET,
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

  // MoparDocs Services API (Stellantis) — Gestione JobCard e Documenti
  // Endpoint per i metodi: getJobCardList, associateJobCard,
  // getJobCardAndDocumentList, getDocumentsInfo, associateDocument, getDocuments,
  // DeleteDocuments, DeleteJobcard
  // NUOVO: Aggiunto target per i servizi MoparDocs Stellantis (non presente prima)
  moparDocsServices: {
    baseUrl: 'https://lab-mopardocs.stellantis.com:4443', // Host del servizio Stellantis
    basePath: '/services', // Path base comune a tutti i metodi Services
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID, // Credenziale IBM API Connect (condivisa)
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET, // Credenziale IBM API Connect (condivisa)
  },

  // MoparDocs Browser API (Fiat) — upload e download documenti
  moparDocsApi: {
    baseUrl: 'https://lab-examaftersales.fiat.com',
    basePath: '/Mopardocs/MoparDocsApi/Browser',
    ibmClientId: process.env.MOPARDOC_IBM_CLIENT_ID,
    ibmClientSecret: process.env.MOPARDOC_IBM_CLIENT_SECRET,
  },
};

module.exports = config;
