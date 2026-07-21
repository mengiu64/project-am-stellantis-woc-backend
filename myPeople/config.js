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
  'MYPEOPLE_HOST',
  'MYPEOPLE_IBM_CLIENT_ID',
  'MYPEOPLE_USERNAME',
  'MYPEOPLE_PASSWORD',
  'MYPEOPLE_IDENTIFIER',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(`[config] Missing required environment variables: ${missing.join(', ')}`);
}

module.exports = {
  // myPeople / IURSMA API (IBM API Connect gateway)
  myPeople: {
    host: (process.env.MYPEOPLE_HOST || '').replace(/\/$/, ''),
    basePath: process.env.MYPEOPLE_BASE_PATH || '/applications/mypeople/iursma/v1',
    ibmClientId: process.env.MYPEOPLE_IBM_CLIENT_ID,
    username: process.env.MYPEOPLE_USERNAME,
    password: process.env.MYPEOPLE_PASSWORD,
    // Identifier costante della richiesta (non varia per utente): configurato una
    // volta come parametro/secret, non più passato dal chiamante.
    identifier: process.env.MYPEOPLE_IDENTIFIER,
  },

  // Secrets Manager (mTLS client certificate/key), read via the AWS Parameters
  // and Secrets Lambda Extension (http://localhost:<port>/secretsmanager/get)
  secrets: {
    certSecretId: process.env.MYPEOPLE_CERT_SECRET_ID || 'apicCert',
    keySecretId: process.env.MYPEOPLE_KEY_SECRET_ID || 'apicKey',
    extensionPort: Number(process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT) || 2773,
  },
};
