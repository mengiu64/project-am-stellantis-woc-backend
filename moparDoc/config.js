'use strict';

// Modulo di configurazione per la Lambda moparDoc.
// In ambiente AWS Lambda: carica le credenziali da SSM Parameter Store → Secrets Manager.
// In locale (CLI): carica le credenziali dal file .env.
// Esporta una funzione asincrona getConfig() che restituisce l'oggetto di configurazione.
// Il risultato viene cachato in memoria per le invocazioni successive (warm start).

const fs = require('fs');
const path = require('path');

// Cache della configurazione — persiste tra invocazioni (warm start)
let cachedConfig = null;

/**
 * Carica il file .env locale per lo sviluppo (no dipendenze npm esterne).
 * Le variabili nel file .env non sovrascrivono quelle già presenti in process.env.
 */
function loadEnvFile() {
  // Percorso del file .env nella directory corrente
  const envFile = path.join(__dirname, '.env');
  // Carica solo se il file esiste (sviluppo locale)
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8')
      .split('\n')
      .forEach((line) => {
        // Rimuove spazi bianchi iniziali e finali
        const trimmed = line.trim();
        // Ignora righe vuote e commenti
        if (!trimmed || trimmed.startsWith('#')) return;
        // Cerca il separatore chiave=valore
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        // Estrae chiave e valore
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        // Imposta la variabile solo se non già presente in process.env
        if (key && !(key in process.env)) {
          process.env[key] = val;
        }
      });
  }
}

/**
 * Costruisce l'oggetto di configurazione a partire dalle credenziali caricate.
 * @param {object} secrets - Oggetto con le 4 credenziali
 * @returns {object} Oggetto di configurazione con sezioni auth, jobDocs, moparDocsApi, moparDocsServices
 */
function buildConfig(secrets) {
  return {
    auth: {
      // PingFederate OAuth2 (client_credentials flow)
      baseUrl: 'https://idfed-preprod.mpsa.com:443',
      basePath: '/as/token.oauth2',
      // Endpoint completo PingFederate (baseUrl + basePath) — usato da authService.js per ottenere il token
      url: 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
      // Tipo di grant OAuth2 — client_credentials flow verso PingFederate
      grantType: 'client_credentials',
      clientId: secrets.MOPARDOC_PING_CLIENT_ID, // Client ID PingFederate dedicato (dal secret)
      clientSecret: secrets.MOPARDOC_PING_CLIENT_SECRET, // Client secret PingFederate dedicato (dal secret)
      scope: 'prd:mdo',
      // Token cache duration (ms) — ricarica se scaduto + buffer di 30s
      cacheBufferMs: 30000,
    },

    // Job Docs API (PSA job-docs connector) — crea JobCard e token di accesso
    jobDocs: {
      baseUrl: 'https://api-oidc-preprod.groupe-psa.com',
      basePath: '/job-docs/connector/v1', // Path corretto per l'API Gateway IBM (da collection Postman)
      ibmClientId: secrets.MOPARDOC_IBM_CLIENT_ID,
      ibmClientSecret: secrets.MOPARDOC_IBM_CLIENT_SECRET,
    },

    // MoparDocs Browser API (Fiat) — upload e download documenti
    moparDocsApi: {
      baseUrl: 'https://lab-examaftersales.fiat.com',
      basePath: '/Mopardocs/MoparDocsApi/Browser',
      ibmClientId: secrets.MOPARDOC_IBM_CLIENT_ID,
      ibmClientSecret: secrets.MOPARDOC_IBM_CLIENT_SECRET,
    },

    // MoparDocs Services API — getJobCardList, associateJobCard, getJobCardAndDocumentList,
    // getDocumentsInfo, associateDocument, getDocuments, DeleteDocuments, DeleteJobcard
    // Endpoint: tramite API Gateway IBM (api-oidc-preprod.groupe-psa.com) — stessa infrastruttura di jobDocs
    // Il server diretto (mopardocs.stellantis.com:4443) richiede mutual TLS non supportato da Lambda
    // Override possibile via variabili d'ambiente
    moparDocsServices: {
      baseUrl: process.env.MOPARDOCS_SERVICES_BASE_URL || 'https://api-oidc-preprod.groupe-psa.com', // API Gateway IBM preprod
      basePath: process.env.MOPARDOCS_SERVICES_PATH || '/job-docs/connector/v1', // Path base comune (da collection Postman)
      ibmClientId: secrets.MOPARDOC_IBM_CLIENT_ID, // Credenziale IBM API Connect (condivisa)
      ibmClientSecret: secrets.MOPARDOC_IBM_CLIENT_SECRET, // Credenziale IBM API Connect (condivisa)
    },
  };
}

/**
 * Restituisce l'oggetto di configurazione completo.
 * In ambiente Lambda: carica le credenziali da SSM → Secrets Manager (con cache).
 * In locale: carica le credenziali dalle variabili d'ambiente (file .env).
 * @returns {Promise<object>} Oggetto config con sezioni auth, jobDocs, moparDocsApi, moparDocsServices
 * @throws {Error} Se le credenziali non sono recuperabili
 */
async function getConfig() {
  // Se la configurazione è già in cache, restituisce direttamente
  if (cachedConfig) {
    return cachedConfig;
  }

  // Carica il file .env locale (ha effetto solo in sviluppo locale)
  loadEnvFile();

  let secrets;

  // Determina la sorgente delle credenziali in base alla variabile d'ambiente
  if (process.env.MOPARDOC_PARAM_NAME) {
    // Ambiente Lambda: carica da SSM → Secrets Manager
    const { loadSecrets } = require('./secretsLoader');
    console.log('[config] Caricamento credenziali da SSM/Secrets Manager');
    secrets = await loadSecrets();
  } else {
    // Ambiente locale: usa le variabili d'ambiente (da .env o process.env)
    console.log('[config] Caricamento credenziali da variabili d\'ambiente locali');
    // Elenco delle variabili d'ambiente obbligatorie in locale
    const REQUIRED_ENV = [
      'MOPARDOC_IBM_CLIENT_ID',
      'MOPARDOC_IBM_CLIENT_SECRET',
      'MOPARDOC_PING_CLIENT_ID',
      'MOPARDOC_PING_CLIENT_SECRET',
    ];
    // Verifica che tutte le variabili obbligatorie siano presenti
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `[config] Variabili d'ambiente obbligatorie mancanti: ${missing.join(', ')}`
      );
    }
    // Costruisce l'oggetto secrets dalle variabili d'ambiente
    secrets = {
      MOPARDOC_IBM_CLIENT_ID: process.env.MOPARDOC_IBM_CLIENT_ID,
      MOPARDOC_IBM_CLIENT_SECRET: process.env.MOPARDOC_IBM_CLIENT_SECRET,
      MOPARDOC_PING_CLIENT_ID: process.env.MOPARDOC_PING_CLIENT_ID,
      MOPARDOC_PING_CLIENT_SECRET: process.env.MOPARDOC_PING_CLIENT_SECRET,
    };
  }

  // Costruisce l'oggetto di configurazione dalle credenziali recuperate
  cachedConfig = buildConfig(secrets);
  console.log('[config] Configurazione caricata con successo');

  // Restituisce l'oggetto di configurazione
  return cachedConfig;
}

/**
 * Invalida la cache della configurazione.
 * Utile per i test unitari e per forzare un refresh.
 */
function invalidateConfig() {
  cachedConfig = null;
}

// Esporta la funzione asincrona per ottenere la configurazione
module.exports = { getConfig, invalidateConfig };
