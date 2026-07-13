'use strict';

// Carica il file .env per lo sviluppo locale (nessuna dipendenza esterna richiesta).
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '..', '.env');
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

/**
 * Configurazione del modulo "session".
 *
 * `dataSource` determina quale provider viene usato per ottenere i dati di sessione:
 *  - "static" (default): valori predefiniti, utile per sviluppo/test/fallback.
 *  - "db": legge i dati da un database reale (da completare per l'ambiente AWS,
 *          vedi src/providers/dbSessionProvider.js).
 *
 * In AWS Lambda, queste variabili andrebbero impostate come variabili d'ambiente
 * della funzione (es. tramite template SAM/CloudFormation/Terraform), puntando
 * tipicamente a un RDS (Postgres/MySQL) o a una tabella DynamoDB.
 */
module.exports = {
  dataSource: process.env.SESSION_DATA_SOURCE || 'static',

  db: {
    // Parametri generici per un DB relazionale (es. RDS Postgres/MySQL su AWS).
    engine: process.env.SESSION_DB_ENGINE || 'postgres', // postgres | mysql | dynamodb
    host: process.env.SESSION_DB_HOST || '',
    port: process.env.SESSION_DB_PORT ? Number(process.env.SESSION_DB_PORT) : undefined,
    database: process.env.SESSION_DB_NAME || '',
    user: process.env.SESSION_DB_USER || '',
    password: process.env.SESSION_DB_PASSWORD || '',
    ssl: process.env.SESSION_DB_SSL === 'true',

    // Parametri per DynamoDB (alternativa "serverless friendly" su AWS).
    dynamoTableName: process.env.SESSION_DYNAMO_TABLE || 'SessionData',
    awsRegion: process.env.AWS_REGION || 'eu-west-1',
  },
};
