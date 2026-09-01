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

// Solo l'host è realmente obbligatorio: username/password possono arrivare da
// Secrets Manager (vedi db.js) invece che da env var dirette.
const REQUIRED_ENV = ['DMLCONFIGSYNC_DB_HOST'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`[config] Missing required environment variables: ${missing.join(', ')}`);
}

module.exports = {
  // Connessione al database Aurora PostgreSQL "wiadvisor" (tabelle
  // woc.dml_enabled_markets / woc.dml_configurations), tipicamente tramite
  // l'endpoint dell'RDS Proxy (non l'endpoint diretto del cluster).
  db: {
    host: process.env.DMLCONFIGSYNC_DB_HOST,
    // port/name/user/password: se assenti vengono ricavati dal secret (db.js).
    // Utili in locale/CI per bypassare Secrets Manager/l'estensione Lambda.
    port: process.env.DMLCONFIGSYNC_DB_PORT ? Number(process.env.DMLCONFIGSYNC_DB_PORT) : undefined,
    name: process.env.DMLCONFIGSYNC_DB_NAME,
    user: process.env.DMLCONFIGSYNC_DB_USER,
    password: process.env.DMLCONFIGSYNC_DB_PASSWORD,
    // Aurora richiede/accetta TLS; impostare DMLCONFIGSYNC_DB_SSL=false solo per
    // test locali contro un Postgres senza TLS.
    ssl: process.env.DMLCONFIGSYNC_DB_SSL !== 'false',
  },

  // Credenziali (username/password) dell'utente applicativo Aurora
  // (least-privilege, "wiadvisor_app"), lette da AWS Secrets Manager tramite la
  // AWS Parameters and Secrets Lambda Extension (http://localhost:<port>/secretsmanager/get),
  // stesso meccanismo già usato da pkFavorite/db.js e dbManager/db.js.
  secrets: {
    dbSecretId: process.env.DMLCONFIGSYNC_DB_SECRET_ID || 'sm-np-bsn0027990-dev-aurora-app',
    extensionPort: Number(process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT) || 2773,
  },
};
