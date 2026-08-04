'use strict';

// Modulo di configurazione per la Lambda srpV360Ota.
// Carica il file .env locale per lo sviluppo senza dipendenze npm esterne,
// valida le variabili d'ambiente obbligatorie e esporta l'oggetto di configurazione.

// Caricamento moduli nativi per leggere il file .env
const fs = require('fs');
const path = require('path');

// Percorso del file .env nella directory corrente
const envFile = path.join(__dirname, '.env');

// Caricamento del file .env se presente (solo per sviluppo locale)
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

// Elenco delle variabili d'ambiente obbligatorie
const REQUIRED_ENV = [
  'SRP_V360_OTA_PING_CLIENT_ID',
  'SRP_V360_OTA_PING_CLIENT_SECRET',
  'SRP_V360_OTA_IBM_CLIENT_ID',
  'SRP_V360_OTA_IBM_CLIENT_SECRET',
];

// Verifica che tutte le variabili obbligatorie siano presenti
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  // Lancia un errore con l'elenco delle variabili mancanti
  throw new Error(
    `[config] Variabili d'ambiente obbligatorie mancanti: ${missing.join(', ')}`
  );
}

// Esporta l'oggetto di configurazione con le sezioni auth, srp e otaDefaults
module.exports = {
  // Configurazione autenticazione PingFederate
  auth: {
    // URL endpoint PingFederate (default: preprod)
    url: process.env.SRP_V360_OTA_PING_URL || 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    // Tipo di grant OAuth2
    grantType: 'client_credentials',
    // Scope OAuth2 per il servizio ASV360
    scope: process.env.SRP_V360_OTA_PING_SCOPE || 'prd:asv',
    // Client ID PingFederate
    clientId: process.env.SRP_V360_OTA_PING_CLIENT_ID,
    // Client Secret PingFederate
    clientSecret: process.env.SRP_V360_OTA_PING_CLIENT_SECRET,
  },

  // Configurazione servizio upstream SRP-V360 (IBM API Connect)
  srp: {
    // URL base del servizio upstream (differente per dev/stage/prod)
    baseUrl: process.env.SRP_V360_OTA_BASE_URL || 'https://emea-aws.dev.np-api.stellantis.com',
    // Base path dell'API upstream
    basePath: process.env.SRP_V360_OTA_BASE_PATH || '/ps-dev/extra/srp/asv360/v1',
    // X-IBM-Client-Id per autenticazione IBM API Connect
    clientId: process.env.SRP_V360_OTA_IBM_CLIENT_ID,
    // X-IBM-Client-Secret per autenticazione IBM API Connect
    clientSecret: process.env.SRP_V360_OTA_IBM_CLIENT_SECRET,
  },

  // Valori di default per i parametri della richiesta OTA
  otaDefaults: {
    // Inclusione storico dati OTA (default: 'false')
    includeOtaHistoryData: 'false',
    // Locale per la risposta (default: 'en_US')
    locale: 'en_US',
  },
};
